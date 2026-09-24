package catalog

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"Sparkle/internal/plexauth"
)

func TestAnonymousShareMetadataArtworkAndPlaybackBoundary(t *testing.T) {
	s, mux, scans, id := fixture(t)
	mux.HandleFunc("GET /media/{id}", s.Media)
	auth, err := plexauth.New(plexauth.Options{Identity: s.plex.Identity})
	if err != nil {
		t.Fatal(err)
	}
	defer auth.Close()
	handler := auth.Middleware(mux)
	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	res := get("/media/" + id)
	var data map[string]any
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &data) != nil || data["title"] != "Sample" || data["Summary"] != "A shared movie description." || data["year"] != float64(2026) {
		t.Fatal("public preview lost metadata", res.Code, res.Body.String())
	}
	for _, secret := range []string{"test-secret", "/media/movie.mkv", "127.0.0.1", "X-Plex-Token"} {
		if strings.Contains(res.Body.String(), secret) {
			t.Fatalf("preview leaked %q", secret)
		}
	}
	for _, kind := range []string{"poster", "backdrop"} {
		image := get("/media/" + id + "/artwork/" + kind)
		if image.Code != 200 || image.Header().Get("Content-Type") != "image/png" {
			t.Fatal("crawler cannot fetch artwork", kind, image.Code)
		}
	}
	for _, path := range []string{
		"/media/" + id + "/parts/2/file",
		"/media/" + id + "/parts/2/encoded/av1/manifest",
		"/media/" + id + "/parts/2/encoded/hevc/video-0.m4s",
		"/library/items/" + id + "/children",
		"/library/items?source=plex",
	} {
		if res := get(path); res.Code != 401 {
			t.Fatal("preview exposed playback or browsing", path, res.Code)
		}
	}
	blockedID, _ := s.plex.ID(context.Background(), "9", 1)
	for _, suffix := range []string{"", "/artwork/poster", "/artwork/backdrop"} {
		if res := get("/media/" + blockedID + suffix); res.Code != 404 {
			t.Fatal("preview bypassed configured library restrictions", res.Code)
		}
	}
	if scans.Load() != 0 {
		t.Fatal("sharing enumerated the Plex library")
	}
}
