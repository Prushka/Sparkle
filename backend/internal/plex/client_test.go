package plex

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testClient(t *testing.T, handler http.HandlerFunc, mappings []Mapping) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	data, _ := json.Marshal(mappings)
	client, err := New(Options{URL: server.URL, Token: "secret-test-token", LibraryIDs: "1", Mappings: string(data)})
	if err != nil {
		t.Fatal(err)
	}
	return client
}
func TestMappingConfinementAndLongestPrefix(t *testing.T) {
	root, other, outside := t.TempDir(), t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(root, "same.mkv"), []byte("root"), 0600)
	os.WriteFile(filepath.Join(other, "same.mkv"), []byte("nested"), 0600)
	os.WriteFile(filepath.Join(outside, "escape.mkv"), []byte("outside"), 0600)
	c := testClient(t, func(http.ResponseWriter, *http.Request) {}, []Mapping{{"/media", root}, {"/media/special", other}})
	f, err := c.Open("/media/special/same.mkv")
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	f.Read(b)
	f.Close()
	if string(b) != "nested" {
		t.Fatalf("wrong mapping: %s", b)
	}
	for _, path := range []string{"/media/../escape.mkv", "/media/special/../same.mkv", "/media-other/same.mkv", "/media/same.mkv:secret", "/media/./same.mkv", "/media/special"} {
		if f, err := c.Open(path); err == nil {
			f.Close()
			t.Errorf("accepted %q", path)
		}
	}
	if c.ValidateWritable(filepath.Join(root, "new", "cache")) == nil {
		t.Fatal("writable media destination accepted")
	}
	if c.ValidateWritable(outside) != nil {
		t.Fatal("external cache rejected")
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err == nil {
		if f, err := c.Open("/media/escape/escape.mkv"); err == nil {
			f.Close()
			t.Fatal("symlink escape accepted")
		}
	} else {
		t.Log("OS does not grant symlink creation; path confinement tests still ran")
	}
}
func TestAllowlistRedactionAndNumericSections(t *testing.T) {
	var requests atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "GET" || r.Header.Get("X-Plex-Token") != "secret-test-token" || strings.Contains(r.URL.RawQuery, "secret") {
			t.Error("unsafe Plex request")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/identity":
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"server"}}`)
		case "/library/sections":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"},{"key":"2","type":"movie"}]}}`)
		case "/library/metadata/7":
			fmt.Fprint(w, `{"MediaContainer":{"Metadata":[{"ratingKey":"7","librarySectionID":2,"type":"movie"}]}}`)
		default:
			w.WriteHeader(500)
			fmt.Fprint(w, "secret-test-token /private/media")
		}
	}, []Mapping{{"/media", t.TempDir()}})
	sections, err := c.Sections(context.Background())
	if err != nil || len(sections) != 1 {
		t.Fatalf("sections: %v %v", sections, err)
	}
	id, _ := c.ID(context.Background(), "7", 1)
	if _, _, err := c.Item(context.Background(), id); err == nil {
		t.Fatal("disallowed section accepted")
	}
	before := requests.Load()
	var response Response
	if c.get(context.Background(), "/:/scrobble", nil, &response) == nil {
		t.Fatal("write-like GET accepted")
	}
	if requests.Load() != before {
		t.Fatal("disallowed endpoint contacted")
	}
	err = c.get(context.Background(), "/library/metadata/8", nil, &response)
	if err == nil || strings.Contains(err.Error(), "secret-test-token") || strings.Contains(err.Error(), "/private") {
		t.Fatalf("unsafe error: %v", err)
	}
}
func TestMetadataCacheBoundAndCancellation(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("slow") == "1" {
			<-r.Context().Done()
			return
		}
		fmt.Fprintf(w, `{"MediaContainer":{"machineIdentifier":%q}}`, strings.Repeat("a", 150000))
	}, []Mapping{{"/media", t.TempDir()}})
	for i := 0; i < 300; i++ {
		var v Response
		if err := c.get(context.Background(), "/identity", url.Values{"page": {fmt.Sprint(i)}}, &v); err != nil {
			t.Fatal(err)
		}
	}
	if len(c.cache) > 256 || c.cacheBytes > 32*1024*1024 {
		t.Fatalf("cache unbounded: %d %d", len(c.cache), c.cacheBytes)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	var v Response
	if c.get(ctx, "/identity", url.Values{"slow": {"1"}}, &v) == nil || time.Since(start) > time.Second {
		t.Fatal("Plex request did not cancel promptly")
	}
}
