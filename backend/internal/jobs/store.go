package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

var jobFieldAliases = map[string]string{
	"id":             "Id",
	"inputParent":    "InputParent",
	"input":          "Input",
	"state":          "State",
	"encodedCodecs":  "EncodedCodecs",
	"mappedAudio":    "MappedAudio",
	"streams":        "Streams",
	"duration":       "Duration",
	"width":          "Width",
	"height":         "Height",
	"encodedExt":     "EncodedExt",
	"chapters":       "Chapters",
	"dominantColors": "DominantColors",
	"oriSize":        "OriSize",
	"oriModTime":     "OriModTime",
}

var streamFieldAliases = map[string]string{
	"bitrate":    "Bitrate",
	"codecName":  "CodecName",
	"codecType":  "CodecType",
	"index":      "Index",
	"location":   "Location",
	"language":   "Language",
	"title":      "Title",
	"filename":   "Filename",
	"mimeType":   "MimeType",
	"channels":   "Channels",
	"sampleRate": "SampleRate",
}

type Store struct {
	outputDir string
	ttl       time.Duration

	mu         sync.RWMutex
	expiresAt  time.Time
	cached     []byte
	etag       string
	refreshing *refreshCall
}

type refreshCall struct {
	done chan struct{}
	err  error // Published by closing done.
}

func NewStore(outputDir string, ttl time.Duration) *Store {
	// A nil cache means no scan has succeeded yet; a scanned empty library is [].
	return &Store{outputDir: outputDir, ttl: ttl}
}

func (s *Store) Prune() {
	s.mu.Lock()
	defer s.mu.Unlock()

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
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}

	s.mu.Lock()
	cached := append([]byte(nil), s.cached...)
	etag := s.etag
	var pending *refreshCall
	if cached == nil || !time.Now().Before(s.expiresAt) {
		pending = s.refreshLocked(ctx)
	}
	s.mu.Unlock()

	// Only an actual scan result can be served while revalidating. Cold readers
	// join the startup scan (or start it) instead of returning a placeholder [].
	if cached != nil {
		return cached, etag, nil
	}
	select {
	case <-ctx.Done():
		return nil, "", ctx.Err()
	case <-pending.done:
		if pending.err != nil {
			return nil, "", pending.err
		}
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]byte(nil), s.cached...), s.etag, nil
}

func (s *Store) RefreshAsync(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked(ctx)
}

// refreshLocked coalesces startup, cold reads and background refreshes. The
// caller must hold mu; canceling a reader must not cancel the shared scan.
func (s *Store) refreshLocked(ctx context.Context) *refreshCall {
	if s.refreshing == nil {
		s.refreshing = &refreshCall{done: make(chan struct{})}
		go s.refresh(context.WithoutCancel(ctx), s.refreshing)
	}
	return s.refreshing
}

func (s *Store) refresh(ctx context.Context, pending *refreshCall) {
	jobs, err := s.scan(ctx)
	if err == nil {
		err = s.setPayload(jobs, time.Now())
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		// Payload errors also reach /all; never expose local filesystem paths.
		log.Print("job scan failed; catalog cache unchanged")
		pending.err = errors.New("processed library is unavailable")
	}
	s.refreshing = nil
	close(pending.done)
}

func (s *Store) setPayload(jobs []map[string]any, now time.Time) error {
	payload, err := json.Marshal(jobs)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(payload)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.cached = payload
	s.etag = fmt.Sprintf(`"%x"`, sum)
	s.expiresAt = now.Add(s.ttl)
	return nil
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
			log.Printf("skipping unreadable processed job: directory=%q", entry.Name())
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
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, `/\:`) {
		return nil, ErrJobNotFound
	}
	dir := filepath.Join(s.outputDir, id)
	root, err := os.OpenRoot(s.outputDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.Open(filepath.Join(id, jobFile))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	content, err := io.ReadAll(io.LimitReader(f, 8*1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(content) > 8*1024*1024 {
		return nil, ErrJobNotFound
	}

	job := make(map[string]any)
	if err := json.Unmarshal(content, &job); err != nil {
		return nil, err
	}
	normalizeJob(job)
	sanitizePublicMetadata(job)
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
	filterEncodedCodecsByFiles(job, files)
	ensureObject(job, "MappedAudio")
	ensureArray(job, "EncodedCodecs")
	ensureArray(job, "Streams")
	ensureArray(job, "Chapters")
	ensureArray(job, "DominantColors")
	return job, nil
}

// Job files can contain source paths and encoder diagnostics. Only descriptive
// names and relative asset names belong in browser metadata.
func sanitizePublicMetadata(value any) {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "token") || strings.Contains(lower, "password") || strings.HasSuffix(lower, "path") || strings.HasSuffix(lower, "dir") || lower == "inputparent" || lower == "command" || lower == "error" {
				delete(v, key)
				continue
			}
			if lower == "input" || lower == "filename" || lower == "location" {
				if name, ok := child.(string); ok {
					name = strings.ReplaceAll(name, "\\", "/")
					v[key] = name[strings.LastIndex(name, "/")+1:]
				}
			} else {
				sanitizePublicMetadata(child)
			}
		}
	case []any:
		for _, child := range v {
			sanitizePublicMetadata(child)
		}
	}
}

func normalizeJob(job map[string]any) {
	copyAliasedFields(job, jobFieldAliases)
	normalizeStreamList(job["Streams"])
	if mappedAudio, ok := job["MappedAudio"].(map[string]any); ok {
		for _, streams := range mappedAudio {
			normalizeStreamList(streams)
		}
	}
}

func filterEncodedCodecsByFiles(job map[string]any, files map[string]int64) {
	switch codecs := job["EncodedCodecs"].(type) {
	case []any:
		filtered := codecs[:0]
		for _, value := range codecs {
			codec, ok := value.(string)
			if !ok || !codecFileExists(files, codec) {
				continue
			}
			filtered = append(filtered, value)
		}
		job["EncodedCodecs"] = filtered
	case []string:
		filtered := codecs[:0]
		for _, codec := range codecs {
			if !codecFileExists(files, codec) {
				continue
			}
			filtered = append(filtered, codec)
		}
		job["EncodedCodecs"] = filtered
	}
}

func codecFileExists(files map[string]int64, codec string) bool {
	if _, ok := files[codec+".mp4"]; ok {
		return true
	}
	prefix := codec + "-"
	for name := range files {
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".mp4") {
			return true
		}
	}
	return false
}

func normalizeStreamList(value any) {
	streams, ok := value.([]any)
	if !ok {
		return
	}
	for _, value := range streams {
		stream, ok := value.(map[string]any)
		if !ok {
			continue
		}
		copyAliasedFields(stream, streamFieldAliases)
	}
}

func copyAliasedFields(target map[string]any, aliases map[string]string) {
	for sourceKey, targetKey := range aliases {
		if hasUsableField(target, targetKey) {
			continue
		}
		if value, ok := target[sourceKey]; ok && value != nil {
			target[targetKey] = value
		}
	}
}

func hasUsableField(target map[string]any, key string) bool {
	value, ok := target[key]
	if !ok || value == nil {
		return false
	}
	if text, ok := value.(string); ok {
		return text != ""
	}
	if values, ok := value.([]any); ok {
		return len(values) > 0
	}
	if values, ok := value.(map[string]any); ok {
		return len(values) > 0
	}
	if value == 0 || value == int64(0) || value == float64(0) {
		return false
	}
	return true
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
			log.Print("skipping unreadable processed file")
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
