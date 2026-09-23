package encode

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Sparkle/internal/plex"
)

func TestEncodingRequiresAllowedPlexSectionAndHidesPaths(t *testing.T) {
	mediaRoot := t.TempDir()
	_ = os.WriteFile(filepath.Join(mediaRoot, "sample.mkv"), []byte("read-only"), 0644)
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/identity":
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"fixture"}}`)
		case "/library/sections":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"},{"key":"2","type":"movie"}]}}`)
		case "/library/metadata/1", "/library/metadata/2":
			section := strings.TrimPrefix(r.URL.Path, "/library/metadata/")
			fmt.Fprintf(w, `{"MediaContainer":{"Metadata":[{"ratingKey":"%s","librarySectionID":"%s","type":"movie","Media":[{"id":10,"Part":[{"id":20,"file":"/media/sample.mkv"}]}]}]}}`, section, section)
		default:
			t.Errorf("unexpected catalog scan: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	mappings, _ := json.Marshal([]plex.Mapping{{Plex: "/media", Local: mediaRoot}})
	p, err := plex.New(plex.Options{URL: server.URL, Token: "hidden-test-token", LibraryIDs: "1", Mappings: string(mappings)})
	if err != nil {
		t.Fatal(err)
	}
	c := testCache(t)
	s := &Service{plex: p, cache: c, codecs: []string{"av1"}, sources: map[string]*source{}, probes: make(chan struct{}, 2), options: Options{Profile: Profile{22, "p7", 144}}}
	id, err := p.ID(context.Background(), "1", 10)
	if err != nil {
		t.Fatal(err)
	}
	f, _ := p.File(context.Background(), id, "20")
	info, _ := f.Stat()
	f.Close()
	fingerprint := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:20:%d:%d", id, info.Size(), info.ModTime().UnixNano()))))
	s.sources[fingerprint] = &source{probe: Probe{Streams: []Stream{
		{Type: "video", Codec: "hevc", Transfer: "smpte2084"},
		{Type: "attachment", Codec: "ttf", Extra: "00000000: 666f 6e74  font"},
	}}, duration: 7200, key: fingerprint, used: time.Now()}
	mux := http.NewServeMux()
	s.Register(mux)
	allowed := httptest.NewRecorder()
	mux.ServeHTTP(allowed, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/manifest", nil))
	if allowed.Code != 200 {
		t.Fatalf("manifest %d %s", allowed.Code, allowed.Body)
	}
	if strings.Contains(allowed.Body.String(), mediaRoot) || strings.Contains(allowed.Body.String(), "hidden-test-token") || strings.Contains(allowed.Body.String(), server.URL) {
		t.Fatal("private configuration leaked")
	}
	if !strings.Contains(allowed.Body.String(), `"hasFonts":true`) || strings.Contains(allowed.Body.String(), `"fonts":`) {
		t.Fatal("manifest must announce fonts without downloading attachments")
	}
	fontURL := "/media/" + id + "/parts/20/encoded/av1/fonts.json?v=" + fingerprint
	fonts := httptest.NewRecorder()
	mux.ServeHTTP(fonts, httptest.NewRequest("GET", fontURL, nil))
	if fonts.Code != 200 || strings.TrimSpace(fonts.Body.String()) != `["Zm9udA=="]` {
		t.Fatalf("fonts %d %s", fonts.Code, fonts.Body)
	}
	fontCheck := httptest.NewRequest("GET", fontURL, nil)
	fontCheck.Header.Set("If-None-Match", fonts.Header().Get("ETag"))
	unmodified := httptest.NewRecorder()
	mux.ServeHTTP(unmodified, fontCheck)
	if unmodified.Code != http.StatusNotModified || unmodified.Body.Len() != 0 {
		t.Fatal("font validator not respected")
	}
	blockedID, _ := p.ID(context.Background(), "2", 10)
	blocked := httptest.NewRecorder()
	mux.ServeHTTP(blocked, httptest.NewRequest("GET", "/media/"+blockedID+"/parts/20/encoded/av1/manifest", nil))
	if blocked.Code != 404 {
		t.Fatalf("disallowed section status %d", blocked.Code)
	}
	stale := httptest.NewRecorder()
	mux.ServeHTTP(stale, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/video.m3u8?v=old-file", nil))
	if stale.Code != 409 {
		t.Fatalf("stale file status %d", stale.Code)
	}
	if len(requests) > 5 {
		t.Fatalf("unbounded metadata work: %v", requests)
	}
}
