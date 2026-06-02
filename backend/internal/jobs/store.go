package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const jobFile = "job.json"

var ErrJobNotFound = errors.New("job not found")

type Store struct {
	outputDir string
	ttl       time.Duration

	mu        sync.RWMutex
	expiresAt time.Time
	cached    []byte
	etag      string
}

func NewStore(outputDir string, ttl time.Duration) *Store {
	return &Store{outputDir: outputDir, ttl: ttl}
}

func (s *Store) Prune() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cached = nil
	s.etag = ""
	s.expiresAt = time.Time{}
}

func (s *Store) JSON(ctx context.Context) ([]byte, error) {
	payload, _, err := s.Payload(ctx)
	return payload, err
}

func (s *Store) Job(ctx context.Context, target string) ([]byte, string, error) {
	job, err := s.loadJob(target)
	if err == nil {
		return marshalJob(job)
	}
	if !errors.Is(err, os.ErrNotExist) || len(target) < 4 {
		return nil, "", ErrJobNotFound
	}

	entries, err := os.ReadDir(s.outputDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", ErrJobNotFound
		}
		return nil, "", err
	}

	var match string
	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return nil, "", ctx.Err()
		default:
		}

		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), target) {
			continue
		}
		if match != "" {
			return nil, "", ErrJobNotFound
		}
		match = entry.Name()
	}
	if match == "" {
		return nil, "", ErrJobNotFound
	}

	job, err = s.loadJob(match)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", ErrJobNotFound
		}
		return nil, "", err
	}
	return marshalJob(job)
}

func (s *Store) Payload(ctx context.Context) ([]byte, string, error) {
	now := time.Now()

	s.mu.RLock()
	if len(s.cached) > 0 && now.Before(s.expiresAt) {
		payload := append([]byte(nil), s.cached...)
		etag := s.etag
		s.mu.RUnlock()
		return payload, etag, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.cached) > 0 && time.Now().Before(s.expiresAt) {
		return append([]byte(nil), s.cached...), s.etag, nil
	}

	jobs, err := s.scan(ctx)
	if err != nil {
		if len(s.cached) > 0 {
			log.Printf("job scan failed; serving stale cache: %v", err)
			return append([]byte(nil), s.cached...), s.etag, nil
		}
		return nil, "", err
	}

	payload, err := json.Marshal(jobs)
	if err != nil {
		return nil, "", err
	}
	s.cached = payload
	sum := sha256.Sum256(payload)
	s.etag = fmt.Sprintf(`"%x"`, sum)
	s.expiresAt = time.Now().Add(s.ttl)
	return append([]byte(nil), payload...), s.etag, nil
}

func marshalJob(job map[string]any) ([]byte, string, error) {
	payload, err := json.Marshal(job)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(payload)
	return payload, fmt.Sprintf(`"%x"`, sum), nil
}

func (s *Store) scan(ctx context.Context) ([]map[string]any, error) {
	entries, err := os.ReadDir(s.outputDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []map[string]any{}, nil
		}
		return nil, err
	}

	result := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if !entry.IsDir() {
			continue
		}

		job, err := s.loadJob(entry.Name())
		if err != nil {
			log.Printf("skipping job %q: %v", entry.Name(), err)
			continue
		}
		result = append(result, compactJob(job))
	}

	sort.Slice(result, func(i, j int) bool {
		return stringField(result[i], "Id") < stringField(result[j], "Id")
	})
	return result, nil
}

func compactJob(job map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{
		"Id",
		"Input",
		"State",
		"EncodedCodecs",
		"Duration",
		"DominantColors",
		"ExtractedQuality",
		"JobModTime",
		"Title",
	} {
		if value, ok := job[key]; ok {
			result[key] = value
		}
	}
	if files, ok := job["Files"].(map[string]int64); ok {
		if posterSize, ok := files["poster.jpg"]; ok {
			result["Files"] = map[string]int64{"poster.jpg": posterSize}
		} else {
			result["Files"] = map[string]int64{}
		}
	} else {
		result["Files"] = map[string]any{}
	}
	return result
}

func (s *Store) loadJob(id string) (map[string]any, error) {
	dir := filepath.Join(s.outputDir, id)
	content, err := os.ReadFile(filepath.Join(dir, jobFile))
	if err != nil {
		return nil, err
	}

	job := make(map[string]any)
	if err := json.Unmarshal(content, &job); err != nil {
		return nil, err
	}
	if stringField(job, "Id") == "" {
		job["Id"] = id
	}

	files, latestModTime, err := fileSizes(dir)
	if err != nil {
		return nil, err
	}
	job["Files"] = files

	if latestModTime > int64Field(job, "JobModTime") {
		job["JobModTime"] = latestModTime
	}
	ensureObject(job, "MappedAudio")
	ensureArray(job, "EncodedCodecs")
	ensureArray(job, "Streams")
	ensureArray(job, "Chapters")
	ensureArray(job, "DominantColors")
	return job, nil
}

func fileSizes(dir string) (map[string]int64, int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, 0, err
	}

	files := make(map[string]int64, len(entries))
	var latest int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			log.Printf("skipping file %q: %v", filepath.Join(dir, entry.Name()), err)
			continue
		}
		if info.IsDir() {
			continue
		}
		files[entry.Name()] = info.Size()
		if modTime := info.ModTime().Unix(); modTime > latest {
			latest = modTime
		}
	}
	return files, latest, nil
}

func stringField(job map[string]any, key string) string {
	value, _ := job[key].(string)
	return value
}

func int64Field(job map[string]any, key string) int64 {
	switch value := job[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	case json.Number:
		n, _ := value.Int64()
		return n
	default:
		return 0
	}
}

func ensureArray(job map[string]any, key string) {
	if value, ok := job[key]; !ok || value == nil {
		job[key] = []any{}
	}
}

func ensureObject(job map[string]any, key string) {
	if value, ok := job[key]; !ok || value == nil {
		job[key] = map[string]any{}
	}
}
