package catalog

import (
	"Sparkle/internal/jobs"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLogTitlesReuseRequestedDetailsAndStayBounded(t *testing.T) {
	output := t.TempDir()
	dir := filepath.Join(output, "movie")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "job.json"), []byte(`{"id":"movie","input":"C:/private/media/A Movie.mkv","state":"complete"}`), 0600); err != nil {
		t.Fatal(err)
	}
	s := New(jobs.NewStore(output, time.Hour), nil, t.TempDir(), nil)
	if title := s.LogMediaTitle("movie"); title != "" {
		t.Fatal("logging loaded unrequested metadata")
	}
	if _, err := s.Details(context.Background(), "movie"); err != nil {
		t.Fatal(err)
	}
	if title := s.LogMediaTitle("movie"); title != "A Movie" {
		t.Fatalf("unsafe or missing log title: %q", title)
	}
	s.rememberLogTitle("alias", "episode", map[string]any{"Title": map[string]any{"title": "A Show", "episode": map[string]any{"se": "S01E02", "title": "Next"}}})
	for _, id := range []string{"alias", "episode"} {
		if title := s.LogMediaTitle(id); title != "A Show - S01E02 - Next" {
			t.Fatalf("missing episode context: %q", title)
		}
	}
	for i := 0; i < maxLogTitles+10; i++ {
		id := fmt.Sprint(i)
		s.rememberLogTitle(id, id, map[string]any{"Input": strings.Repeat("枯", 1000)})
	}
	if len(s.logTitles) != maxLogTitles {
		t.Fatalf("unbounded title count: %d", len(s.logTitles))
	}
	for _, entry := range s.logTitles {
		if len([]rune(entry.title)) > 300 {
			t.Fatal("unbounded title bytes")
		}
	}
}
