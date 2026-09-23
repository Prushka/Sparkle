package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"Sparkle/internal/jobs"
	"Sparkle/internal/plex"
)

func matchingFixture(t *testing.T, candidates []plex.Metadata, total int) (*Service, *atomic.Int32) {
	t.Helper()
	calls := new(atomic.Int32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("Plex write attempted")
		}
		switch r.URL.Path {
		case "/identity":
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"matching"}}`)
		case "/library/sections":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"},{"key":"2","type":"show"},{"key":"3","type":"movie"}]}}`)
		case "/library/sections/1/all", "/library/sections/2/all":
			calls.Add(1)
			if r.URL.Query().Get("title") == "" || r.URL.Query().Get("X-Plex-Container-Size") != "32" || r.URL.Query().Get("X-Plex-Container-Start") != "0" {
				t.Errorf("unbounded matching query: %v", r.URL.Query())
			}
			json.NewEncoder(w).Encode(plex.Response{Container: plex.Container{TotalSize: total, Metadata: candidates}})
		case "/library/metadata/10", "/library/metadata/11":
			kind, key, parent := "show", "10", ""
			if strings.HasSuffix(r.URL.Path, "11") {
				kind, key, parent = "season", "11", "10"
			}
			json.NewEncoder(w).Encode(plex.Response{Container: plex.Container{Metadata: []plex.Metadata{{Key: key, Type: kind, SectionID: "2", ParentKey: parent}}}})
		case "/library/metadata/10/children", "/library/metadata/11/children":
			calls.Add(1)
			if r.URL.Query().Get("index") == "" || r.URL.Query().Get("X-Plex-Container-Size") != "100" {
				t.Error("unbounded hierarchy lookup")
			}
			kind, key, index, parent, parentIndex, title := "season", "11", 2, "10", 0, "Season 2"
			if strings.Contains(r.URL.Path, "/11/") {
				kind, key, index, parent, parentIndex, title = "episode", "12", 3, "11", 2, "Third Episode"
			}
			json.NewEncoder(w).Encode(plex.Response{Container: plex.Container{TotalSize: 1, Metadata: []plex.Metadata{{Key: key, Type: kind, Index: index, ParentKey: parent, ParentIndex: parentIndex, Title: title, Thumb: "/library/metadata/" + key + "/thumb/1", Summary: "Matched " + kind}}}})
		default:
			t.Errorf("unexpected/forbidden endpoint %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	mappings, _ := json.Marshal([]plex.Mapping{{Plex: "/media", Local: t.TempDir()}})
	p, err := plex.New(plex.Options{URL: server.URL, Token: "secret-must-stay-private", LibraryIDs: "1,2", Mappings: string(mappings)})
	if err != nil {
		t.Fatal(err)
	}
	return New(nil, p, t.TempDir()), calls
}

func TestMatchingRejectsRemakesAmbiguityAndTruncation(t *testing.T) {
	base := plex.Metadata{Key: "10", Type: "movie", Title: "The Thing", Year: 1982, Thumb: "/library/metadata/10/thumb/1", Summary: "1982 description", GUID: "plex://movie/1982"}
	for _, tc := range []struct {
		name  string
		rows  []plex.Metadata
		total int
		want  bool
	}{
		{"exact", []plex.Metadata{base}, 1, true},
		{"wrong year", []plex.Metadata{func() plex.Metadata { m := base; m.Year = 2011; return m }()}, 1, false},
		{"similar title", []plex.Metadata{func() plex.Metadata { m := base; m.Title = "The Thing Returns"; return m }()}, 1, false},
		{"ambiguous identity", []plex.Metadata{base, func() plex.Metadata { m := base; m.Key = "20"; m.GUID = "plex://movie/other"; return m }()}, 2, false},
		{"same canonical work", []plex.Metadata{base, func() plex.Metadata { m := base; m.Key = "20"; return m }()}, 2, true},
		{"incomplete candidates", []plex.Metadata{base}, 1000000, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, calls := matchingFixture(t, tc.rows, tc.total)
			id := identityFromTitle("The Thing (1982) WEBDL-2160p.mkv")
			value := s.matchingArtwork(context.Background(), id)
			if (value.Poster != "") != tc.want {
				t.Fatalf("incorrect match: %+v", value)
			}
			if tc.want && value.Summary != "1982 description" {
				t.Fatal("wrong description")
			}
			before := calls.Load()
			s.matchingArtwork(context.Background(), id)
			if calls.Load() != before {
				t.Fatal("positive/negative match not cached")
			}
		})
	}
}

func TestMatchingSeriesAndEpisodes(t *testing.T) {
	s, calls := matchingFixture(t, []plex.Metadata{{Key: "10", Type: "show", Title: "Example: The Series", Year: 2020, Thumb: "/library/metadata/10/thumb/1", Summary: "Show description"}}, 1)
	for _, tc := range []struct {
		id   matchIdentity
		want string
	}{
		{matchIdentity{Kind: "show", Title: "Example - The Series"}, "Show description"},
		{matchIdentity{Kind: "season", Title: "Example - The Series", Season: 2}, "Matched season"},
		{identityFromTitle("Example - The Series - S02E03 - Third Episode WEBDL-1080p.mkv"), "Matched episode"},
		{identityFromTitle("Example - The Series - S02E03 - Different Ordering.mkv"), ""},
		{identityFromTitle("Example - The Series - S02E04 - Third Episode.mkv"), ""},
	} {
		if got := s.matchingArtwork(context.Background(), tc.id); got.Summary != tc.want {
			t.Fatalf("%+v: %+v", tc.id, got)
		}
	}
	if calls.Load() > 7 {
		t.Fatalf("hierarchy was enumerated: %d", calls.Load())
	}
	for _, name := range []string{"The Thing.mkv", "Series (2020) - S01E01E02 - Combined.mkv"} {
		if identityFromTitle(name).Kind != "" {
			t.Fatalf("unsafe filename accepted: %s", name)
		}
	}
}

func TestProcessedDetailsKeepIdentityAndAssets(t *testing.T) {
	s, _ := matchingFixture(t, []plex.Metadata{{Key: "10", Type: "movie", Title: "Film", Year: 2020, Thumb: "/library/metadata/10/thumb/1", Summary: "Plex description"}}, 1)
	output := t.TempDir()
	dir := filepath.Join(output, "stable-id")
	os.Mkdir(dir, 0700)
	os.WriteFile(filepath.Join(dir, "job.json"), []byte(`{"Id":"stable-id","Input":"Film (2020).mkv","State":"complete","Duration":120,"EncodedCodecs":["h264-8bit"]}`), 0600)
	os.WriteFile(filepath.Join(dir, "h264-8bit.mp4"), []byte("original processed bytes"), 0600)
	s.jobs = jobs.NewStore(output, time.Minute)
	job, err := s.Details(context.Background(), "stable-id")
	if err != nil {
		t.Fatal(err)
	}
	if job["Id"] != "stable-id" || job["source"] != "processed" || job["Raw"] != nil || job["Summary"] != "Plex description" || !strings.HasPrefix(str(job, "Poster"), "/media/plex-") {
		t.Fatalf("wrong processed enrichment: %+v", job)
	}
	data, _ := json.Marshal(job)
	if strings.Contains(string(data), output) || strings.Contains(string(data), "secret-must-stay-private") {
		t.Fatal("private data leaked")
	}
}

func TestMatchingBoundsAndSingleFlight(t *testing.T) {
	s, calls := matchingFixture(t, []plex.Metadata{}, 0)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.matchingArtwork(context.Background(), matchIdentity{Kind: "movie", Title: "Missing", Year: 2020})
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("duplicate lookup storm: %d", calls.Load())
	}
	for i := range 260 {
		s.matchingArtwork(context.Background(), matchIdentity{Kind: "movie", Title: "Missing " + strconv.Itoa(i), Year: 2020})
	}
	if len(s.matches) > 256 {
		t.Fatal("unbounded cache")
	}
}

func TestMatchingOnlyEnrichesRequestedPage(t *testing.T) {
	s, calls := matchingFixture(t, nil, 0)
	output := t.TempDir()
	for i := range 120 {
		dir := filepath.Join(output, fmt.Sprintf("film-%03d", i))
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		data := fmt.Sprintf(`{"Id":"film-%03d","Input":"Film %03d (2020).mkv","State":"complete"}`, i, i)
		if err := os.WriteFile(filepath.Join(dir, "job.json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s.jobs = jobs.NewStore(output, time.Minute)
	deadline := time.Now().Add(3 * time.Second)
	for {
		data, err := s.jobs.JSON(context.Background())
		var records []map[string]any
		if err == nil && json.Unmarshal(data, &records) == nil && len(records) == 120 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("processed fixture did not load")
		}
		time.Sleep(10 * time.Millisecond)
	}
	request := httptest.NewRequest("GET", "/library/items?source=processed&limit=3", nil)
	response := httptest.NewRecorder()
	s.browse(response, request)
	var page Page
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 || page.Total != 120 || calls.Load() != 3 {
		t.Fatalf("lookups exceeded requested page: items=%d total=%d calls=%d", len(page.Items), page.Total, calls.Load())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.matchingArtwork(ctx, matchIdentity{Kind: "movie", Title: "Cancelled", Year: 2020})
	if calls.Load() != 3 {
		t.Fatal("cancelled request reached Plex")
	}
}
