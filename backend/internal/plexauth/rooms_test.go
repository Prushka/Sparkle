package plexauth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"Sparkle/internal/realtime"
	"github.com/gorilla/websocket"
)

func TestRoomHTTPAndWebSocketAuthorization(t *testing.T) {
	f := setup(t)
	hub := realtime.NewHub(realtime.Options{AuthorizeMedia: f.m.RequireMedia, CanAccessMedia: f.m.CanAccess, CheckOrigin: f.m.OriginAllowed})
	t.Cleanup(hub.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /rooms", hub.HandleCreateRoom)
	mux.HandleFunc("GET /rooms/{room}", hub.HandleGetRoom)
	mux.HandleFunc("PUT /rooms/{room}", hub.HandleUpdateRoom)
	mux.HandleFunc("GET /sync/{room}/{id}", hub.HandleWebSocket)
	f.m.Register(mux)
	handler := f.m.Middleware(mux)
	server := httptest.NewServer(handler)
	defer server.Close()
	member := f.login(t)
	roomRequest := func(method, path, media string, cookie *http.Cookie) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"mediaId": media})
		if path == "/rooms" {
			body, _ = json.Marshal(map[string]string{"roomId": "auth-room", "mediaId": media})
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Origin", "https://sparkle.test")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, method := range []string{"POST", "PUT"} {
		path := "/rooms"
		if method == "PUT" {
			path = "/rooms/auth-room"
		}
		if method == "PUT" {
			if w := roomRequest("POST", "/rooms", "encoded", nil); w.Code != 200 {
				t.Fatal(w.Code)
			}
		}
		if w := roomRequest(method, path, "plex-server-1-1", nil); w.Code != 401 {
			t.Fatalf("anonymous %s allowed: %d", method, w.Code)
		}
	}
	if w := roomRequest("PUT", "/rooms/auth-room", "encoded", nil); w.Code != 200 {
		t.Fatal(w.Code)
	}
	dial := func(player string, cookie *http.Cookie, origin string) (*websocket.Conn, *http.Response, error) {
		headers := http.Header{"Origin": {origin}}
		if cookie != nil {
			headers.Set("Cookie", cookie.String())
		}
		return websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/sync/auth-room/"+player, headers)
	}
	guest, _, err := dial("media_guest", nil, "https://sparkle.test")
	if err != nil {
		t.Fatal(err)
	}
	defer guest.Close()
	owner, _, err := dial("media_owner", member, "https://sparkle.test")
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	if w := roomRequest("PUT", "/rooms/auth-room", "plex-server-1-1", member); w.Code != 200 {
		t.Fatal(w.Code)
	}
	guest.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err = guest.ReadMessage()
	if !websocket.IsCloseError(err, 4003) {
		t.Fatalf("guest received a raw-room message or was not denied: %v", err)
	}
	owner.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, message, err := owner.ReadMessage()
	if err != nil || !bytes.Contains(message, []byte("plex-server-1-1")) {
		t.Fatal("member did not receive room switch", err)
	}
	for _, method := range []string{"GET", "PUT", "POST"} {
		path := "/rooms/auth-room"
		if method == "POST" {
			path = "/rooms"
		}
		w := roomRequest(method, path, "", nil)
		if w.Code != 401 || strings.Contains(w.Body.String(), "plex-server-") {
			t.Fatal("raw room readable/mutable by guest", method, w.Code)
		}
	}
	conn, response, err := dial("media_denied", nil, "https://sparkle.test")
	if conn != nil {
		conn.Close()
	}
	if err == nil || response.StatusCode != 401 {
		t.Fatal("guest handshake admitted")
	}
	conn, response, err = dial("media_bad_origin", member, "https://evil.test")
	if conn != nil {
		conn.Close()
	}
	if err == nil || response.StatusCode != 403 {
		t.Fatal("cross-site WebSocket admitted")
	}
	call(f.h, "POST", "/auth/plex/logout", member)
	owner.WriteJSON(map[string]any{"type": "broadcast", "broadcast": map[string]string{"type": "moveTo", "moveTo": "encoded"}})
	owner.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err = owner.ReadMessage()
		if err != nil {
			break
		}
	}
	if !websocket.IsCloseError(err, 4003) {
		t.Fatal("signed-out member kept Raw-room socket access", err)
	}
	if w := roomRequest("GET", "/rooms/auth-room", "", member); w.Code != 401 {
		t.Fatal("revoked cookie joined room")
	}
}

func TestAnonymousWebSocketCannotSelectPlexMedia(t *testing.T) {
	f := setup(t)
	hub := realtime.NewHub(realtime.Options{AuthorizeMedia: f.m.RequireMedia, CanAccessMedia: f.m.CanAccess, CheckOrigin: f.m.OriginAllowed})
	defer hub.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sync/{room}/{id}", hub.HandleWebSocket)
	mux.HandleFunc("GET /rooms/{room}", hub.HandleGetRoom)
	server := httptest.NewServer(f.m.Middleware(mux))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/sync/encoded-room/guest", http.Header{"Origin": {"https://sparkle.test"}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.WriteJSON(map[string]any{"type": "broadcast", "broadcast": map[string]string{"type": "moveTo", "moveTo": "plex-server-1-1"}})
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err = conn.ReadMessage()
		if err != nil {
			break
		}
	}
	if !websocket.IsCloseError(err, 4003) {
		t.Fatal("unauthorized media change was not refused", err)
	}
	w := call(f.m.Middleware(mux), "GET", "/rooms/encoded-room")
	if w.Code != 200 || strings.Contains(w.Body.String(), "plex-server-") {
		t.Fatal("guest changed room media")
	}
}
