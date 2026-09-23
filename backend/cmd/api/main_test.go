package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type deadlineRecorder struct {
	*httptest.ResponseRecorder
	deadline time.Time
}

func (r *deadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	r.deadline = deadline
	return nil
}

func TestStaticFilesClearsWriteDeadlineAndSupportsRanges(t *testing.T) {
	outputDir := t.TempDir()
	mediaDir := filepath.Join(outputDir, "media-1")
	if err := os.Mkdir(mediaDir, 0o755); err != nil {
		t.Fatalf("mkdir media directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(mediaDir, "h264.mp4"), []byte("0123456789"), 0o644); err != nil {
		t.Fatalf("write media file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/static/media-1/h264.mp4", nil)
	req.Header.Set("Range", "bytes=2-5")
	response := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}

	staticFiles(outputDir).ServeHTTP(response, req)

	if !response.deadline.IsZero() {
		t.Fatalf("static response write deadline = %v, want no deadline", response.deadline)
	}
	if response.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusPartialContent)
	}
	if got := response.Body.String(); got != "2345" {
		t.Fatalf("body = %q, want %q", got, "2345")
	}
	if got := response.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Fatalf("Content-Range = %q, want %q", got, "bytes 2-5/10")
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=3600" {
		t.Fatalf("Cache-Control = %q, want %q", got, "public, max-age=3600")
	}
}

func TestStaticFilesHidePrivateMetadataAndConfineAssets(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "job.json"), []byte(`{"Input":"private-source"}`), 0600)
	os.WriteFile(filepath.Join(dir, "error.log"), []byte("private-source"), 0600)
	for _, name := range []string{"job.json", "error.log", "../secret.mp4", "file.mp4:private"} {
		w := httptest.NewRecorder()
		staticFiles(dir).ServeHTTP(w, httptest.NewRequest("GET", "/static/"+name, nil))
		if w.Code != 404 || strings.Contains(w.Body.String(), "private-source") {
			t.Fatalf("private asset exposed: %s", name)
		}
	}
}
