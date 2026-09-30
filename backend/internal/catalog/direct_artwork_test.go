package catalog

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"Sparkle/internal/plex"
)

func TestArtworkPathsReuseCatalogMetadataAndKeepPublicProxy(t *testing.T) {
	s, mux, calls, id := fixture(t)
	// This synthetic row is already in a Plex page; resolving artwork must not
	// fetch its individual metadata or any artwork bytes.
	item, err := s.plexItem(context.Background(), plex.Metadata{Key: "123", SectionID: "1", Type: "movie", Thumb: "/library/metadata/123/thumb/456", Art: "/library/metadata/123/art/456", Media: []plex.Media{{ID: 1}}})
	if err != nil || item.PlexArtwork == nil || item.PlexArtwork.Poster != "/library/metadata/123/thumb/456" {
		t.Fatal("missing page artwork")
	}
	if calls.Load() != 0 {
		t.Fatal("artwork enumerated catalog")
	}
	job, err := s.Details(context.Background(), id)
	if err != nil || job["plexArtwork"] == nil {
		t.Fatal("title metadata missing artwork paths")
	}
	encoded, _ := json.Marshal(job)
	if strings.Contains(string(encoded), "X-Plex-Token") || strings.Contains(string(encoded), "test-secret") || !strings.HasPrefix(str(job, "Poster"), "/media/") {
		t.Fatal("metadata exposed credentials or lost proxy")
	}
	entries, _ := os.ReadDir(s.artwork.dir)
	if len(entries) != 0 {
		t.Fatal("metadata fetched image bytes")
	}
	s.canAccessLibrary = func(context.Context, string) bool { return false }
	job, err = s.Details(context.Background(), id)
	if err != nil || job["plexArtwork"] != nil {
		t.Fatal("public or unshared metadata exposed direct paths")
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/media/"+id+"/artwork/poster", nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "private, max-age=300" || w.Header().Get("ETag") == "" {
		t.Fatal("public proxy contract changed")
	}
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/media/"+id+"/artwork/poster/direct", nil))
	if w.Code == 200 {
		t.Fatal("obsolete per-cover route remains")
	}
}

func TestMatchedArtworkPathsRespectEachViewersGrant(t *testing.T) {
	s, calls := matchingFixture(t, []plex.Metadata{{Key: "10", SectionID: "1", Type: "movie", Title: "Film", Year: 2020, Thumb: "/library/metadata/10/thumb/1"}}, 1)
	identity := identityFromTitle("Film (2020).mkv")
	allowed := true
	s.canAccessLibrary = func(_ context.Context, library string) bool { return allowed && library == "1" }
	for _, grant := range []bool{true, false, true} {
		allowed = grant
		items := []Item{{Source: "processed", match: identity}}
		s.enrichPage(context.Background(), items)
		if (items[0].PlexArtwork != nil) != grant || !strings.HasPrefix(items[0].Poster, "/library/artwork/") {
			t.Fatal("cached match bypassed viewer grant or lost public proxy")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("artwork paths repeated metadata lookup")
	}
}
