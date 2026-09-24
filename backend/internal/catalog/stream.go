package catalog

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"Sparkle/internal/plex"
)

func (s *Service) file(w http.ResponseWriter, r *http.Request) {
	if s.plex == nil {
		http.NotFound(w, r)
		return
	}
	f, err := s.plex.File(r.Context(), r.PathValue("id"), r.PathValue("partId"))
	if err != nil {
		status := 404
		if errors.Is(err, plex.ErrUnavailable) {
			status = 503
		}
		fail(w, status, err.Error())
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// Each write renews the idle deadline; a multi-hour file is not constrained
	// by the API's ordinary response timeout.
	stream := &streamWriter{ResponseWriter: w, request: r}
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", fmt.Sprintf(`"%x-%x"`, info.Size(), info.ModTime().UnixNano()))
	http.ServeContent(stream, r, "media", info.ModTime(), f)
}

type streamWriter struct {
	http.ResponseWriter
	request *http.Request
}

func (w *streamWriter) Write(p []byte) (int, error) {
	if err := w.request.Context().Err(); err != nil {
		return 0, err
	}
	_ = http.NewResponseController(w.ResponseWriter).SetWriteDeadline(time.Now().Add(60 * time.Second))
	return w.ResponseWriter.Write(p)
}

type artCache struct {
	dir      string
	mu       sync.Mutex
	maxBytes int64
}

func newArtCache(dir string) *artCache { return &artCache{dir: dir, maxBytes: maxArtBytes} }

const maxArtBytes int64 = 512 * 1024 * 1024

func (s *Service) art(w http.ResponseWriter, r *http.Request) {
	if s.plex == nil {
		http.NotFound(w, r)
		return
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(r.PathValue("id")+":"+r.PathValue("kind"))))
	if _, _, err := s.plex.Item(r.Context(), r.PathValue("id")); err != nil {
		fail(w, 404, "Artwork unavailable")
		return
	}
	data := s.artwork.read(key)
	if data == nil {
		var err error
		data, _, err = s.plex.Artwork(r.Context(), r.PathValue("id"), r.PathValue("kind"))
		if err != nil {
			fail(w, 404, "Artwork unavailable")
			return
		}
		s.artwork.write(key, data)
	}
	w.Header().Set("Content-Type", http.DetectContentType(data))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache")
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(data))
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(304)
		return
	}
	_, _ = w.Write(data)
}
func (c *artCache) read(key string) []byte {
	if c.dir == "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	name := filepath.Join(c.dir, key+".art")
	info, err := os.Stat(name)
	if err != nil || info.Size() > 12*1024*1024 || time.Since(info.ModTime()) > 24*time.Hour {
		return nil
	}
	data, _ := os.ReadFile(name)
	return data
}
func (c *artCache) write(key string, data []byte) {
	if c.dir == "" || int64(len(data)) > c.maxBytes || len(data) > 12*1024*1024 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if os.MkdirAll(c.dir, 0755) != nil {
		return
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return
	}
	type entry struct {
		name string
		size int64
		time time.Time
	}
	files := []entry{}
	var total int64
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".art") {
			continue
		}
		i, err := e.Info()
		if err != nil {
			continue
		}
		total += i.Size()
		files = append(files, entry{e.Name(), i.Size(), i.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].time.Before(files[j].time) })
	for _, e := range files {
		if total+int64(len(data)) <= c.maxBytes {
			break
		}
		if os.Remove(filepath.Join(c.dir, e.name)) == nil {
			total -= e.size
		}
	}
	if total+int64(len(data)) > c.maxBytes {
		return
	}
	tmp, err := os.CreateTemp(c.dir, "art-*.tmp")
	if err != nil {
		return
	}
	name := tmp.Name()
	defer os.Remove(name)
	_, err = tmp.Write(data)
	closeErr := tmp.Close()
	if err == nil && closeErr == nil {
		_ = os.Rename(name, filepath.Join(c.dir, key+".art"))
	}
}
