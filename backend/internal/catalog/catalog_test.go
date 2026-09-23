package catalog

import (
	"Sparkle/internal/plex"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func fixture(t *testing.T) (*Service, *http.ServeMux, *atomic.Int32, string) {
	t.Helper()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "movie.mkv"), []byte("0123456789"), 0600)
	calls := new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/identity":
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"catalog-test"}}`)
		case "/library/sections":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie","title":"Movies"}]}}`)
		case "/library/sections/1/all", "/library/metadata/8/children":
			calls.Add(1)
			n, _ := strconv.Atoi(r.URL.Query().Get("X-Plex-Container-Size"))
			off, _ := strconv.Atoi(r.URL.Query().Get("X-Plex-Container-Start"))
			if n < 1 || n > 100 {
				t.Errorf("unbounded request: %d", n)
			}
			rows := []map[string]any{}
			for i := 0; i < n; i++ {
				rows = append(rows, map[string]any{"ratingKey": fmt.Sprint(off + i + 10), "librarySectionID": 1, "title": fmt.Sprintf("Movie %08d", off+i), "type": "movie", "addedAt": 1000000 - off - i, "Media": []any{map[string]any{"id": 1}}})
				if r.URL.Query().Get("title") == "natural" {
					rows[i]["title"] = fmt.Sprintf("Natural %d", 20-i)
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"Metadata": rows, "offset": off, "totalSize": 1000000}})
		case "/library/metadata/7", "/library/metadata/8":
			fmt.Fprintf(w, `{"MediaContainer":{"Metadata":[{"ratingKey":%q,"librarySectionID":1,"type":"movie","title":"Sample","duration":10000,"Media":[{"id":1,"duration":10000,"Part":[{"id":2,"file":"/media/movie.mkv","size":10}]}]}]}}`, strings.TrimPrefix(r.URL.Path, "/library/metadata/"))
		default:
			t.Errorf("unexpected Plex endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	mapping, _ := json.Marshal([]plex.Mapping{{Plex: "/media", Local: root}})
	p, err := plex.New(plex.Options{URL: server.URL, Token: "test-secret", LibraryIDs: "1", Mappings: string(mapping)})
	if err != nil {
		t.Fatal(err)
	}
	s := New(nil, p, t.TempDir())
	mux := http.NewServeMux()
	s.Register(mux)
	id, _ := p.ID(context.Background(), "7", 1)
	return s, mux, calls, id
}
func TestMillionItemCatalogIsPaged(t *testing.T) {
	s, mux, calls, id := fixture(t)
	get := func(path string) Page {
		t.Helper()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var p Page
		json.Unmarshal(w.Body.Bytes(), &p)
		return p
	}
	p := get("/library/items?source=plex&limit=48")
	if len(p.Items) != 48 || p.Total != 1000000 || p.NextCursor == "" || calls.Load() != 1 {
		t.Fatalf("unbounded first page: %+v calls %d", p, calls.Load())
	}
	p2 := get("/library/items?source=plex&limit=48&cursor=" + p.NextCursor)
	if len(p2.Items) != 48 || p2.Items[0].ID == p.Items[0].ID || calls.Load() != 2 {
		t.Fatal("incorrect continuation")
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/library/items?source=plex&query=changed&cursor="+p.NextCursor, nil))
	if w.Code != 400 {
		t.Fatal("cursor accepted changed filters")
	}
	before := calls.Load()
	job, err := s.RawJob(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(job)
	if strings.Contains(string(b), "/media/movie.mkv") || strings.Contains(string(b), "test-secret") {
		t.Fatal("private metadata leaked")
	}
	if calls.Load() != before {
		t.Fatal("direct lookup scanned catalog")
	}
}
func TestRawRangesAndValidators(t *testing.T) {
	_, mux, _, id := fixture(t)
	path := "/media/" + id + "/parts/2/file"
	request := func(method, rangeHeader, validator string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, nil)
		if rangeHeader != "" {
			r.Header.Set("Range", rangeHeader)
		}
		if validator != "" {
			r.Header.Set("If-None-Match", validator)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	r := request("GET", "bytes=2-5", "")
	if r.Code != 206 || r.Body.String() != "2345" || r.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range: %d %s", r.Code, r.Body.String())
	}
	if request("GET", "", r.Header().Get("ETag")).Code != 304 {
		t.Fatal("validator ignored")
	}
	if request("GET", "bytes=30-", "").Code != 416 {
		t.Fatal("invalid range accepted")
	}
	if r := request("GET", "bytes=-3", ""); r.Code != 206 || r.Body.String() != "789" {
		t.Fatal("suffix range incorrect")
	}
	if r := request("HEAD", "", ""); r.Body.Len() != 0 || r.Header().Get("Content-Length") != "10" {
		t.Fatal("HEAD returned bytes or incorrect size")
	}
	req := httptest.NewRequest("GET", path, nil)
	req.Header.Set("Range", "bytes=1-2")
	req.Header.Set("If-Range", `"old"`)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatal("If-Range not honored")
	}
}
func TestStreamCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	response := httptest.NewRecorder()
	writer := &streamWriter{ResponseWriter: response, request: httptest.NewRequest("GET", "/", nil).WithContext(ctx)}
	if _, err := writer.Write([]byte("never")); err == nil || response.Body.Len() != 0 {
		t.Fatal("write continued after cancellation")
	}
}

func TestArtworkCacheBounded(t *testing.T) {
	cache := newArtCache(t.TempDir())
	cache.maxBytes = 24
	cache.write("first", []byte("1234567890123456"))
	cache.write("second", []byte("abcdefghijklmnop"))
	cache.write("too-large", make([]byte, 25))
	entries, err := os.ReadDir(cache.dir)
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, entry := range entries {
		info, _ := entry.Info()
		total += info.Size()
	}
	if total > 24 || cache.read("first") != nil || string(cache.read("second")) != "abcdefghijklmnop" {
		t.Fatal("artwork cache exceeded budget or evicted the wrong item")
	}
}

func TestHierarchyAndSearchRemainPaged(t *testing.T) {
	s, mux, calls, _ := fixture(t)
	id, _ := s.plex.ID(context.Background(), "8", 0)
	for _, path := range []string{"/library/items?source=plex&query=" + url.QueryEscape("a specific title") + "&sort=title-desc&limit=48", "/library/items/" + id + "/children?source=plex&limit=48"} {
		before := calls.Load()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		var page Page
		json.Unmarshal(w.Body.Bytes(), &page)
		if w.Code != 200 || len(page.Items) != 48 || calls.Load() != before+1 {
			t.Fatal("hierarchy/search scanned beyond requested page")
		}
	}
}

func TestNormalizedDetailsPreserveLegacyIdentity(t *testing.T) {
	s, _, calls, id := fixture(t)
	details, err := s.Details(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if details["id"] != id || details["Id"] != id || details["source"] != "plex" || details["Raw"] == nil || details["duration"] != float64(10) || calls.Load() != 0 {
		t.Fatal("details lost identity or scanned the catalog")
	}
	if number(map[string]any{"time": int64(123)}, "time") != 123 {
		t.Fatal("integer timestamp lost")
	}
}

func TestPreserveUpstreamPageOrder(t *testing.T) {
	_, mux, _, _ := fixture(t)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/library/items?source=plex&query=natural&sort=title-asc&limit=2", nil))
	var page Page
	json.Unmarshal(w.Body.Bytes(), &page)
	if w.Code != 200 || len(page.Items) != 2 || !strings.HasSuffix(page.Items[0].ID, "-10-1") {
		t.Fatal("merging changed upstream collation and could skip a source prefix")
	}
}
