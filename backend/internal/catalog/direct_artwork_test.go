package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestDirectArtworkUsesViewerAndPreservesPublicRoutes(t *testing.T) {
	s, mux, calls, id := fixture(t)
	var authorized []string
	s.RegisterDirectArtwork(mux, "https://public.example/plex/", func(w http.ResponseWriter, r *http.Request, media string) string {
		authorized = append(authorized, media)
		return "viewer+secret&value"
	})
	for _, kind := range []string{"poster", "backdrop"} {
		path := "/media/" + id + "/artwork/" + kind
		for _, route := range []string{path, s.publicArtworkURL(path)} {
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, httptest.NewRequest("POST", route+"/direct", nil))
			var body map[string]string
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &body) != nil {
				t.Fatalf("direct: %d %s", w.Code, w.Body.String())
			}
			u, err := url.Parse(body["url"])
			part := "thumb"
			if kind == "backdrop" {
				part = "art"
			}
			if err != nil || u.Scheme != "https" || u.Host != "public.example" || u.Path != "/plex/library/metadata/7/"+part+"/1" || u.Query().Get("X-Plex-Token") != "viewer+secret&value" || strings.Contains(body["url"], "test-secret") {
				t.Fatal("incorrect direct URL")
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
				t.Fatal("credential response may be cached")
			}
		}
	}
	if calls.Load() != 0 || len(authorized) != 4 {
		t.Fatal("direct lookup enumerated library or skipped authorization")
	}
	for _, media := range authorized {
		if media != id {
			t.Fatal("signed artwork authorized wrong media")
		}
	}
	entries, err := os.ReadDir(s.artwork.dir)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatal("direct lookup populated artwork disk cache")
	}
	job, err := s.RawJob(context.Background(), id)
	encoded, _ := json.Marshal(job)
	if err != nil || strings.Contains(string(encoded), "X-Plex-Token") || strings.Contains(string(encoded), "public.example") {
		t.Fatal("public metadata exposed private artwork")
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/media/"+id+"/artwork/poster", nil))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "private, max-age=300" || w.Header().Get("ETag") == "" {
		t.Fatal("proxy contract changed")
	}
}

func TestDirectArtworkRejectsInvalidTargets(t *testing.T) {
	s, mux, _, id := fixture(t)
	count := 0
	s.RegisterDirectArtwork(mux, "https://public.example", func(w http.ResponseWriter, r *http.Request, id string) string {
		count++
		http.Error(w, "denied", 403)
		return ""
	})
	for _, route := range []string{"/media/" + id + "/artwork/file/direct", s.publicArtworkURL("/media/"+id+"/artwork/poster") + "tampered/direct"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", route, nil))
		if w.Code != 404 {
			t.Fatalf("invalid route accepted: %d", w.Code)
		}
	}
	if count != 0 {
		t.Fatal("invalid path reached credential provider")
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/media/"+id+"/artwork/poster/direct", nil))
	if w.Code != 403 || strings.Contains(w.Body.String(), "X-Plex-Token") {
		t.Fatal("denied viewer received artwork")
	}
	for _, base := range []string{"", "http://public.example", "https://secret@public.example", "https://public.example?secret"} {
		m := http.NewServeMux()
		s.RegisterDirectArtwork(m, base, func(http.ResponseWriter, *http.Request, string) string {
			t.Fatal("disabled feature requested credentials")
			return ""
		})
		w := httptest.NewRecorder()
		m.ServeHTTP(w, httptest.NewRequest("POST", "/media/"+id+"/artwork/poster/direct", nil))
		if w.Code != 404 {
			t.Fatal("invalid base enabled artwork")
		}
	}
}
