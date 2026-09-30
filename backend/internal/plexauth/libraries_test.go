package plexauth

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
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
	"time"

	"Sparkle/internal/catalog"
	"Sparkle/internal/jobs"
	"Sparkle/internal/plex"
	"Sparkle/internal/realtime"
	"github.com/gorilla/websocket"
)

// Uses the real catalog, confined original-file reader, auth middleware and
// room hub. Only Plex's two upstream services and encoded bytes are fixtures.
func libraryFixture(t *testing.T) (*fixture, http.Handler, *plex.Client, *http.Cookie, *http.Cookie) {
	t.Helper()
	f := setup(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "video.mkv"), []byte("original fixture bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	var limited atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("Plex access was not read-only")
		}
		if r.URL.Path == "/library/sections" {
			ids := []string{"1", "2", "3"}
			if r.Header.Get("X-Plex-Token") == "resource-secret" && limited.Load() {
				ids = []string{"1", "3"}
			}
			sections := []plex.Section{}
			for _, id := range ids {
				sections = append(sections, plex.Section{Key: id, Type: "movie", Title: "Library " + id})
			}
			json.NewEncoder(w).Encode(plex.Response{Container: plex.Container{Sections: sections}})
			return
		}
		if r.Header.Get("X-Plex-Token") != "owner-secret" {
			t.Error("unexpected catalog credential")
		}
		if r.URL.Path == "/identity" {
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"configured-server"}}`)
			return
		}
		metadata := func(key string) plex.Metadata {
			return plex.Metadata{Key: key, SectionID: key[:1], Type: "movie", Title: "Movie " + key, Duration: 10000,
				Media: []plex.Media{{ID: 1, Duration: 10000, Parts: []plex.Part{{ID: 100, File: "/media/video.mkv"}}},
					{ID: 2, Duration: 10000, Parts: []plex.Part{{ID: 200, File: "/media/video.mkv"}}}}}
		}
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) == 4 && parts[2] == "metadata" && len(parts[3]) == 2 {
			json.NewEncoder(w).Encode(plex.Response{Container: plex.Container{Metadata: []plex.Metadata{metadata(parts[3])}}})
			return
		}
		if len(parts) == 5 && parts[2] == "sections" && parts[4] == "all" {
			offset, _ := strconv.Atoi(r.URL.Query().Get("X-Plex-Container-Start"))
			size, _ := strconv.Atoi(r.URL.Query().Get("X-Plex-Container-Size"))
			items := []plex.Metadata{metadata(parts[3] + "1"), metadata(parts[3] + "2")}
			offset = min(offset, len(items))
			json.NewEncoder(w).Encode(plex.Response{Container: plex.Container{Offset: offset, TotalSize: 2, Metadata: items[offset:min(offset+size, len(items))]}})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)
	mappings, _ := json.Marshal([]plex.Mapping{{Plex: "/media", Local: root}})
	p, err := plex.New(plex.Options{URL: upstream.URL, Token: "owner-secret", LibraryIDs: "1,2", Mappings: string(mappings)})
	if err != nil {
		t.Fatal(err)
	}
	f.m.identity, f.m.libraries, f.m.mediaLibrary = p.MachineIdentifier, p.UserLibraries, p.MediaLibrary
	full := f.login(t)
	limited.Store(true)
	restricted := f.login(t)
	s := catalog.New(jobs.NewStore(t.TempDir(), time.Hour), p, t.TempDir(), f.m.CanAccessLibrary)
	hub := realtime.NewHub(realtime.Options{AuthorizeMedia: f.m.RequireMedia, CanAccessMedia: f.m.CanAccess, CheckOrigin: f.m.OriginAllowed})
	t.Cleanup(hub.Close)
	mux := http.NewServeMux()
	f.m.Register(mux)
	s.Register(mux)
	mux.HandleFunc("GET /media/{id}", s.Media)
	mux.HandleFunc("GET /media/{id}/parts/{partId}/encoded/{codec}/{resource}", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "cached encoded fixture bytes")
	})
	mux.HandleFunc("POST /rooms", hub.HandleCreateRoom)
	mux.HandleFunc("GET /rooms/{room}", hub.HandleGetRoom)
	mux.HandleFunc("PUT /rooms/{room}", hub.HandleUpdateRoom)
	mux.HandleFunc("GET /sync/{room}/{id}", hub.HandleWebSocket)
	return f, f.m.Middleware(mux), p, full, restricted
}

func TestLibraryPermissionsAcrossCatalogFilesAndEncodedResources(t *testing.T) {
	_, h, p, full, restricted := libraryFixture(t)
	allowed, _ := p.ID(context.Background(), "11", 1)
	denied, _ := p.ID(context.Background(), "21", 1)
	outside, _ := p.ID(context.Background(), "31", 1)
	// Warm the catalog with the wider session, then alternate sessions. Shared
	// owner metadata must never become an authorization decision.
	for _, c := range []*http.Cookie{full, restricted, full, restricted} {
		w := call(h, "GET", "/library/sources", c)
		if w.Code != 200 || strings.Contains(w.Body.String(), "Library 3") || strings.Contains(w.Body.String(), "Library 2") != (c == full) {
			t.Fatalf("incorrect sources: %d %s", w.Code, w.Body.String())
		}
		w = call(h, "GET", "/library/items?source=plex", c)
		var page catalog.Page
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil {
			t.Fatalf("browse failed: %d %s", w.Code, w.Body.String())
		}
		want := 2
		if c == full {
			want = 4
		}
		if page.Total != want || len(page.Items) != want {
			t.Fatalf("unauthorized totals/items: %+v", page)
		}
		for _, item := range page.Items {
			if item.LibraryID == "3" || (c == restricted && item.LibraryID != "1") {
				t.Fatalf("unauthorized item: %+v", item)
			}
		}
	}
	var page catalog.Page
	json.Unmarshal(call(h, "GET", "/library/items?source=plex&limit=1", full).Body.Bytes(), &page)
	for page.NextCursor != "" {
		w := call(h, "GET", "/library/items?source=plex&limit=1&cursor="+url.QueryEscape(page.NextCursor), restricted)
		page = catalog.Page{}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || page.Total != 2 {
			t.Fatalf("copied cursor bypassed scope: %d %s", w.Code, w.Body.String())
		}
		for _, item := range page.Items {
			if item.LibraryID != "1" {
				t.Fatal("copied cursor listed another user's library")
			}
		}
	}
	for _, path := range []string{"/library/items?source=plex&libraryId=2", "/library/items?libraryId=3", "/library/items/" + denied + "/children"} {
		if w := call(h, "GET", path, restricted); w.Code != 403 {
			t.Fatalf("denied library query passed: %s %d", path, w.Code)
		}
	}
	resources := []string{"file", "encoded/av1/manifest", "encoded/hevc/master.m3u8", "encoded/av1/video-init.mp4", "encoded/av1/video-0.m4s", "encoded/hevc/audio-0.m4s", "encoded/av1/subtitles-0.json", "encoded/av1/fonts.json", "encoded/av1/manifest?aiHDR=1"}
	for _, method := range []string{"GET", "HEAD"} {
		for _, resource := range resources {
			for _, id := range []string{allowed, denied, outside} {
				path := "/media/" + id + "/parts/100/" + resource
				// Prime the same route with the full member before the restricted one.
				call(h, method, path, full)
				w := call(h, method, path, restricted)
				want := 403
				if id == allowed {
					want = 200
				}
				if w.Code != want {
					t.Errorf("%s %s = %d, want %d", method, path, w.Code, want)
				}
				if want == 403 && (strings.Contains(w.Body.String(), "fixture bytes") || !strings.Contains(w.Body.String(), "plex_library_access_denied")) {
					t.Fatal("unauthorized response leaked bytes or lost its access error")
				}
			}
		}
	}
	for _, key := range []string{"11", "21"} {
		id, _ := p.ID(context.Background(), key, 2)
		req := httptest.NewRequest("GET", "/media/"+id+"/parts/200/file?libraryId=1", nil)
		req.AddCookie(restricted)
		req.Header.Set("Range", "bytes=0-3")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if key == "11" && (w.Code != 206 || w.Body.String() != "orig") || key == "21" && w.Code != 403 {
			t.Fatalf("alternate version/range bypass: %d %s", w.Code, w.Body.String())
		}
	}
	if w := call(h, "GET", "/media/"+allowed+"/parts/200/file", restricted); w.Code != 404 {
		t.Fatal("part from another version was accepted")
	}
	// The documented single-title link-preview exception stays public.
	if w := call(h, "GET", "/media/"+denied); w.Code != 200 || strings.Contains(w.Body.String(), rootSecretMarker) {
		t.Fatalf("public preview changed or leaked paths: %d", w.Code)
	}
}

const rootSecretMarker = "/media/video.mkv"

func expireGrant(f *fixture, cookie *http.Cookie) *session {
	s := f.m.sessions[sha256.Sum256([]byte(cookie.Value))]
	s.mu.Lock()
	s.checked = time.Now().Add(-accessTTL)
	s.mu.Unlock()
	return s
}

func TestLibraryRevocationCancelsStreamsAndSurvivesRestart(t *testing.T) {
	for _, mode := range []string{"shrink", "empty", "outage", "missing-checker"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			f := setup(t, dir)
			f.m.libraries = func(context.Context, string) ([]string, error) { return []string{"1", "2"}, nil }
			cookie := f.login(t)
			s := f.m.sessions[sha256.Sum256([]byte(cookie.Value))]
			old := s.privateContext()
			started, stopped := make(chan struct{}), make(chan struct{})
			h := f.m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				<-r.Context().Done()
				if n, err := w.Write([]byte("private bytes")); n != 0 || err == nil {
					t.Error("revoked library stream wrote bytes")
				}
				close(stopped)
			}))
			go call(h, "GET", "/media/plex-test/parts/1/file", cookie)
			<-started
			f.m.libraries = func(context.Context, string) ([]string, error) {
				switch mode {
				case "shrink":
					return []string{"2"}, nil
				case "outage":
					return nil, errors.New("secret upstream error")
				default:
					return nil, nil
				}
			}
			if mode == "missing-checker" {
				f.m.libraries = nil
			}
			expireGrant(f, cookie)
			state := sessionStatus(t, f, cookie)
			if !state.Authenticated || state.CanAccessRaw != (mode == "shrink") || old.Err() == nil {
				t.Fatalf("revocation state: %+v", state)
			}
			if mode == "shrink" && (len(state.LibraryIDs) != 1 || state.LibraryIDs[0] != "2") || mode != "shrink" && len(state.LibraryIDs) != 0 {
				t.Fatalf("session did not publish the changed library scope: %v", state.LibraryIDs)
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("library revocation did not cancel the stream")
			}
			if w := call(f.h, "GET", "/media/plex-test/parts/1/file", cookie); w.Code == 200 {
				t.Fatal("revoked library remains accessible")
			}
			f.restart(t, dir)
			if w := call(f.h, "GET", "/media/plex-test/parts/1/file", cookie); w.Code == 200 {
				t.Fatal("restart restored an obsolete library grant")
			}
			f.m.libraries = func(context.Context, string) ([]string, error) { return []string{"1"}, nil }
			expireGrant(f, cookie)
			if w := call(f.h, "GET", "/media/plex-test/parts/1/file", cookie); w.Code != 200 {
				t.Fatal("restored sharing did not recover the existing sign-in")
			}
		})
	}
}

func TestLibraryPermissionsOnRoomChangesAndSockets(t *testing.T) {
	_, h, p, full, restricted := libraryFixture(t)
	allowed, _ := p.ID(context.Background(), "11", 1)
	denied, _ := p.ID(context.Background(), "21", 1)
	request := func(method, path, media string, cookie *http.Cookie) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"roomId": "libraries", "mediaId": media})
		r := httptest.NewRequest(method, path, strings.NewReader(string(body)))
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("POST", "/rooms", denied, restricted); w.Code != 403 {
		t.Fatal("restricted user created a denied-library room", w.Code)
	}
	if w := request("POST", "/rooms", allowed, full); w.Code != 200 {
		t.Fatal(w.Code)
	}
	server := httptest.NewServer(h)
	defer server.Close()
	dial := func(id string, cookie *http.Cookie) (*websocket.Conn, *http.Response, error) {
		return websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/sync/libraries/media_"+id,
			http.Header{"Cookie": {cookie.String()}, "Origin": {"https://sparkle.test"}})
	}
	member, _, err := dial("restricted", restricted)
	if err != nil {
		t.Fatal(err)
	}
	defer member.Close()
	owner, _, err := dial("full", full)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	if w := request("PUT", "/rooms/libraries", denied, restricted); w.Code != 403 {
		t.Fatal("restricted user switched room into a denied library", w.Code)
	}
	if w := request("PUT", "/rooms/libraries", denied, full); w.Code != 200 {
		t.Fatal(w.Code)
	}
	member.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := member.ReadMessage(); !websocket.IsCloseError(err, 4003) {
		t.Fatal("restricted socket received denied-library room state", err)
	}
	owner.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, msg, err := owner.ReadMessage(); err != nil || !strings.Contains(string(msg), denied) {
		t.Fatal("authorized socket did not receive the room change", err)
	}
	for _, method := range []string{"GET", "PUT", "POST"} {
		path := "/rooms/libraries"
		if method == "POST" {
			path = "/rooms"
		}
		if w := request(method, path, allowed, restricted); w.Code != 403 {
			t.Fatal("restricted user read or overwrote an inaccessible room", method, w.Code)
		}
	}
	if conn, res, err := dial("denied", restricted); err == nil || res == nil || res.StatusCode != 403 {
		if conn != nil {
			conn.Close()
		}
		t.Fatal("restricted socket joined a denied library")
	}
	if w := request("PUT", "/rooms/libraries", allowed, full); w.Code != 200 {
		t.Fatal(w.Code)
	}
	attacker, _, err := dial("attacker", restricted)
	if err != nil {
		t.Fatal(err)
	}
	defer attacker.Close()
	attacker.WriteJSON(map[string]any{"type": "broadcast", "broadcast": map[string]string{"type": "moveTo", "moveTo": denied}})
	attacker.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := attacker.ReadMessage(); !websocket.IsCloseError(err, 4003) {
		t.Fatal("socket media change bypassed library authorization", err)
	}
	if w := request("GET", "/rooms/libraries", "", restricted); w.Code != 200 || !strings.Contains(w.Body.String(), allowed) {
		t.Fatal("unauthorized socket changed room state")
	}
}
