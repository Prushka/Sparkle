package plexauth

import (
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestArtworkCredentialsOnlyInPrivateSessionRefresh(t *testing.T) {
	f := setup(t)
	cookie := f.login(t)
	path := "/auth/plex/session"
	assertNoToken := func(w *httptest.ResponseRecorder) {
		t.Helper()
		if strings.Contains(w.Body.String(), "secret") {
			t.Fatal("credentials exposed")
		}
	}
	assertNoToken(call(f.h, "POST", path, cookie)) // Feature disabled.
	f.m.artworkURL = "https://public.example/prefix"
	assertNoToken(call(f.h, "POST", path))
	assertNoToken(call(f.h, "GET", path, cookie))
	for _, field := range []string{"Origin", "X-Sparkle-Auth"} {
		r := httptest.NewRequest("POST", "https://sparkle.test"+path, nil)
		r.AddCookie(cookie)
		r.Header.Set("Origin", "https://sparkle.test")
		r.Header.Set("X-Sparkle-Auth", "1")
		r.Header.Del(field)
		w := httptest.NewRecorder()
		f.h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("missing CSRF check", field)
		}
		assertNoToken(w)
	}
	w := call(f.h, "POST", path, cookie)
	var response status
	if json.Unmarshal(w.Body.Bytes(), &response) != nil || w.Code != 200 || response.Artwork == nil {
		t.Fatal("private session missing artwork")
	}
	s := f.m.sessions[sha256.Sum256([]byte(cookie.Value))]
	if response.Artwork.BaseURL != f.m.artworkURL || response.Artwork.Token != "resource-secret" || response.Artwork.ExpiresAt != s.checked.Add(accessTTL).UnixMilli() || len(response.LibraryIDs) != 1 || response.LibraryIDs[0] != "1" {
		t.Fatal("incorrect viewer credentials or grant")
	}
	if strings.Contains(w.Body.String(), "account-secret") || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("unsafe session response")
	}
	f.member.Store(false)
	s.checked = time.Time{}
	w = call(f.h, "POST", path, cookie)
	assertNoToken(w)
	if sessionStatus(t, f, cookie).DirectArtwork {
		t.Fatal("revoked grant advertised artwork")
	}
}

func TestArtworkCredentialsReacquiredAfterRestart(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	f.m.artworkURL = "https://public.example"
	cookie := f.login(t)
	key := sha256.Sum256([]byte(cookie.Value))
	expires := f.m.sessions[key].expires
	f.restart(t, dir)
	f.m.artworkURL = "https://public.example"
	if f.m.sessions[key].serverToken != "" {
		t.Fatal("resource token persisted")
	}
	w := call(f.h, "POST", "/auth/plex/session", cookie)
	if !strings.Contains(w.Body.String(), "resource-secret") || !f.m.sessions[key].expires.Equal(expires) || f.checks.Load() != 2 {
		t.Fatal("restart failed to reverify with original expiry")
	}
	call(f.h, "POST", "/auth/plex/logout", cookie)
	if strings.Contains(call(f.h, "POST", "/auth/plex/session", cookie).Body.String(), "secret") {
		t.Fatal("signed-out session exposed token")
	}
}

func TestLogoutCancelsPrivateSessionResponse(t *testing.T) {
	f := setup(t)
	f.m.artworkURL = "https://public.example"
	cookie := f.login(t)
	started, stopped := make(chan struct{}), make(chan struct{})
	h := f.m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state := f.m.sessionState(r.Context(), true)
		if state.Artwork == nil {
			t.Error("missing credentials")
		}
		close(started)
		<-r.Context().Done()
		if n, err := w.Write([]byte("private credentials")); n != 0 || err == nil {
			t.Error("revoked response wrote credentials")
		}
		close(stopped)
	}))
	go call(h, "POST", "/auth/plex/session", cookie)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("refresh did not start")
	}
	call(f.h, "POST", "/auth/plex/logout", cookie)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("logout did not cancel refresh")
	}
}
