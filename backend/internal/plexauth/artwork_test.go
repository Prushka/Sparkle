package plexauth

import (
	"context"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func artworkHandler(m *Manager) http.Handler {
	return m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token := m.ArtworkToken(w, r, "plex-server-1-1"); token != "" {
			reply(w, 200, map[string]string{"token": token})
		}
	}))
}

func TestArtworkTokenRequiresOptInSessionOriginAndLibrary(t *testing.T) {
	f := setup(t)
	cookie := f.login(t)
	path := "/library/artwork/signed/direct"
	h := artworkHandler(f.m)
	if call(h, "POST", path, cookie).Code != 404 {
		t.Fatal("disabled artwork exposed token")
	}
	f.m.directArtwork = true
	if call(h, "POST", path).Code != 401 {
		t.Fatal("anonymous artwork exposed token")
	}
	for _, field := range []string{"Origin", "X-Sparkle-Auth"} {
		r := httptest.NewRequest("POST", "https://sparkle.test"+path, nil)
		r.AddCookie(cookie)
		r.Header.Set("Origin", "https://sparkle.test")
		r.Header.Set("X-Sparkle-Auth", "1")
		r.Header.Del(field)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("missing CSRF check", field)
		}
	}
	w := call(h, "POST", path, cookie)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "resource-secret") || strings.Contains(w.Body.String(), "account-secret") || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("incorrect viewer credential")
	}
	if !sessionStatus(t, f, cookie).DirectArtwork {
		t.Fatal("direct artwork not advertised")
	}
	f.m.mediaLibrary = func(context.Context, string) (string, error) { return "2", nil }
	if call(h, "POST", path, cookie).Code != 403 {
		t.Fatal("unshared library exposed token")
	}
	f.member.Store(false)
	f.m.sessions[sha256.Sum256([]byte(cookie.Value))].checked = time.Time{}
	if call(h, "POST", path, cookie).Code != 401 || sessionStatus(t, f, cookie).DirectArtwork {
		t.Fatal("revoked grant exposed token")
	}
}

func TestArtworkTokenReacquiredAfterRestart(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	f.m.directArtwork = true
	cookie := f.login(t)
	key := sha256.Sum256([]byte(cookie.Value))
	expires := f.m.sessions[key].expires
	f.restart(t, dir)
	f.m.directArtwork = true
	if f.m.sessions[key].serverToken != "" {
		t.Fatal("resource token persisted")
	}
	if !sessionStatus(t, f, cookie).DirectArtwork || !f.m.sessions[key].expires.Equal(expires) || f.checks.Load() != 2 {
		t.Fatal("restart did not verify resource token with original expiry")
	}
	if call(artworkHandler(f.m), "POST", "/library/artwork/signed/direct", cookie).Code != 200 {
		t.Fatal("restored session cannot resolve artwork")
	}
	call(f.h, "POST", "/auth/plex/logout", cookie)
	if call(artworkHandler(f.m), "POST", "/library/artwork/signed/direct", cookie).Code != 401 {
		t.Fatal("signed-out session exposed token")
	}
}

func TestLogoutCancelsMatchedArtworkResponse(t *testing.T) {
	f := setup(t)
	f.m.directArtwork = true
	cookie := f.login(t)
	started, stopped := make(chan struct{}), make(chan struct{})
	h := f.m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := f.m.ArtworkToken(w, r, "plex-server-1-1")
		close(started)
		<-r.Context().Done()
		if n, err := w.Write([]byte(token)); n != 0 || err == nil {
			t.Error("revoked artwork wrote credentials")
		}
		close(stopped)
	}))
	go call(h, "POST", "/library/artwork/signed/direct", cookie)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("lookup did not start")
	}
	call(f.h, "POST", "/auth/plex/logout", cookie)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("logout did not cancel lookup")
	}
}
