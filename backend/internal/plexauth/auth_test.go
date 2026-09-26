package plexauth

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fixture struct {
	m              *Manager
	h              http.Handler
	claimed        atomic.Bool
	member         atomic.Bool
	upstreamFailed atomic.Bool
	revoked        atomic.Bool
	checks         atomic.Int32
}

func TestLogoutCancelsActivePrivateStream(t *testing.T) {
	f := setup(t)
	cookie := f.login(t)
	started, stopped := make(chan struct{}), make(chan struct{})
	handler := f.m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		if n, err := w.Write([]byte("private bytes")); n != 0 || err == nil {
			t.Error("revoked stream wrote bytes")
		}
		close(stopped)
	}))
	go call(handler, "GET", "/media/plex-server-1-1/parts/1/file", cookie)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("private stream did not start")
	}
	if w := call(f.h, "POST", "/auth/plex/logout", cookie); w.Code != 200 {
		t.Fatal("logout failed", w.Code)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("logout did not cancel in-flight stream")
	}
}

func setup(t *testing.T, sessionDir ...string) *fixture {
	t.Helper()
	f := &fixture{}
	f.member.Store(true)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Client-Identifier") == "" || r.Header.Get("X-Plex-Product") != "Sparkle Watch Party" {
			t.Error("missing app identification")
		}
		if f.upstreamFailed.Load() {
			w.WriteHeader(503)
			return
		}
		switch r.URL.Path {
		case "/pins":
			if r.Method != "POST" || r.FormValue("strong") != "true" {
				t.Error("strong PIN required")
			}
			fmt.Fprint(w, `{"id":123,"code":"strong-random-pin-code"}`)
		case "/pins/123":
			if r.URL.Query().Get("code") != "strong-random-pin-code" {
				t.Error("missing PIN code")
			}
			if f.claimed.Load() {
				fmt.Fprint(w, `{"authToken":"account-secret"}`)
			} else {
				fmt.Fprint(w, `{"authToken":null}`)
			}
		case "/user":
			f.checks.Add(1)
			if f.revoked.Load() {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Header.Get("X-Plex-Token") != "account-secret" {
				t.Error("incorrect server-side account token")
			}
			fmt.Fprint(w, `{"id":42,"username":"member","title":"Test member","thumb":"https://plex.tv/users/test-member/avatar?c=123"}`)
		case "/resources":
			if f.member.Load() {
				fmt.Fprint(w, `[{"clientIdentifier":"configured-server","provides":"server","accessToken":"resource-secret"}]`)
			} else {
				fmt.Fprint(w, `[{"clientIdentifier":"another-server","provides":"server","accessToken":"resource-secret"}]`)
			}
		default:
			t.Errorf("unexpected Plex endpoint %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	opts := Options{Identity: func(context.Context) (string, error) { return "configured-server", nil }, Origins: "https://sparkle.test", Secure: true}
	if len(sessionDir) > 0 {
		opts.SessionDir = sessionDir[0]
	}
	m, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	m.api = upstream.URL
	f.useManager(t, m)
	return f
}

func (f *fixture) useManager(t *testing.T, m *Manager) {
	t.Helper()
	f.m = m
	mux := http.NewServeMux()
	m.Register(mux)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		reply(w, 200, map[string]string{"path": r.URL.Path, "source": r.URL.Query().Get("source"), "cursor": r.URL.Query().Get("cursor")})
	})
	f.h = m.Middleware(mux)
	t.Cleanup(m.Close)
}
func call(h http.Handler, method, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "https://sparkle.test"+path, nil)
	r.Header.Set("Origin", "https://sparkle.test")
	r.Header.Set("X-Sparkle-Auth", "1")
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func findCookie(t *testing.T, w *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("cookie %s missing", name)
	return nil
}
func (f *fixture) login(t *testing.T) *http.Cookie {
	t.Helper()
	f.claimed.Store(true)
	start := call(f.h, "POST", "/auth/plex/start")
	if start.Code != 200 {
		t.Fatalf("start: %d %s", start.Code, start.Body.String())
	}
	result := call(f.h, "POST", "/auth/plex/poll", findCookie(t, start, pendingCookie))
	if result.Code != 200 {
		t.Fatalf("poll: %d %s", result.Code, result.Body.String())
	}
	if strings.Contains(result.Body.String(), "secret") {
		t.Fatal("Plex tokens exposed in response")
	}
	return findCookie(t, result, sessionCookie)
}
func TestStrongPINSessionAndLogout(t *testing.T) {
	f := setup(t)
	start := call(f.h, "POST", "/auth/plex/start")
	var data map[string]any
	json.Unmarshal(start.Body.Bytes(), &data)
	authURL, err := url.Parse(data["url"].(string))
	if err != nil || authURL.Host != "app.plex.tv" || authURL.Path != "/auth" {
		t.Fatal("invalid hosted sign-in URL")
	}
	client := findCookie(t, start, clientCookie)
	if !strings.Contains(authURL.Fragment, client.Value) {
		t.Fatal("client identity not bound to flow")
	}
	pending := findCookie(t, start, pendingCookie)
	if w := call(f.h, "POST", "/auth/plex/poll", pending); w.Code != 202 {
		t.Fatal("unclaimed PIN completed")
	}
	f.claimed.Store(true)
	f.m.pins[sha256.Sum256([]byte(pending.Value))].nextPoll = time.Time{}
	complete := call(f.h, "POST", "/auth/plex/poll", pending)
	if complete.Code != 200 {
		t.Fatal(complete.Body.String())
	}
	cookie := findCookie(t, complete, sessionCookie)
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Domain != "" || cookie.MaxAge != int(sessionTTL.Seconds()) {
		t.Fatalf("unsafe cookie attributes: %+v", cookie)
	}
	if len(cookie.Value) != 43 || strings.Contains(complete.Body.String(), "secret") {
		t.Fatal("credentials leaked")
	}
	for _, path := range []string{"/media/plex-example", "/media/plex-example/parts/1/file", "/media/plex-example/parts/1/encoded/av1/manifest"} {
		if w := call(f.h, "GET", path, cookie); w.Code != 200 {
			t.Fatal("member denied", path)
		}
	}
	if w := call(f.h, "POST", "/auth/plex/poll", pending); w.Code != 410 {
		t.Fatal("PIN was reusable")
	}
	state := call(f.h, "GET", "/auth/plex/session", cookie)
	if !strings.Contains(state.Body.String(), `"canAccessRaw":true`) {
		t.Fatal(state.Body.String())
	}
	if f.checks.Load() != 1 {
		t.Fatal("membership checks are not cached")
	}
	if w := call(f.h, "POST", "/auth/plex/logout", cookie); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := call(f.h, "GET", "/media/plex-example/parts/1/file", cookie); w.Code != 401 {
		t.Fatal("logout did not revoke session")
	}
}

func TestAnonymousProtectionAndEncodedPaging(t *testing.T) {
	f := setup(t)
	for _, method := range []string{"GET", "HEAD"} {
		for _, path := range []string{"/media/plex-test/parts/1/file", "/media/plex-test/parts/1/encoded/hevc/video-0.m4s", "/media/plex-test/parts/1/encoded/av1/fonts.json", "/media/plex-test/artwork/poster/file", "/media/plex-test/artwork/unknown", "/media/plex-test/other", "/library/items/plex-test/children", "/library/items?source=plex", "/library/items?libraryId=1"} {
			w := call(f.h, method, path)
			if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("unprotected %s %s: %d", method, path, w.Code)
			}
		}
	}
	for _, path := range []string{"/library/items", "/library/items?source=all&cursor=bounded", "/library/items?source=processed"} {
		w := call(f.h, "GET", path)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"source":"processed"`) {
			t.Error(w.Body.String())
		}
	}
	sources := call(f.h, "GET", "/library/sources")
	if strings.Contains(sources.Body.String(), `"source":"plex"`) {
		t.Fatal("raw libraries leaked")
	}
	for _, path := range []string{"/all", "/media/encoded-item", "/static/encoded-item/h264-8bit.mp4"} {
		if w := call(f.h, "GET", path); w.Code != 200 {
			t.Fatal("public encoded media blocked")
		}
	}
}

func TestPublicMetadataAndArtworkRequireNoSession(t *testing.T) {
	f := setup(t)
	f.member.Store(false)
	nonmember := f.login(t)
	for _, cookie := range []*http.Cookie{nil, nonmember, {Name: sessionCookie, Value: randomID()}} {
		for _, path := range []string{"/media/plex-test", "/media/plex-test/artwork/poster", "/media/plex-test/artwork/backdrop"} {
			for _, method := range []string{"GET", "HEAD"} {
				r := httptest.NewRequest(method, path, nil)
				// Link-preview crawlers have neither Origin nor a login cookie.
				if cookie != nil {
					r.AddCookie(cookie)
				}
				w := httptest.NewRecorder()
				f.h.ServeHTTP(w, r)
				if w.Code != 200 || len(w.Result().Cookies()) != 0 {
					t.Fatalf("public preview denied or issued credentials: %s %s: %d", method, path, w.Code)
				}
			}
			for _, method := range []string{"POST", "PUT", "DELETE"} {
				if w := call(f.h, method, path); w.Code != 401 {
					t.Fatalf("metadata exception allowed mutation: %s %s", method, path)
				}
			}
		}
	}
}

func TestPollDistinguishesMissingCookieFromExpiredPIN(t *testing.T) {
	f := setup(t)
	start := call(f.h, "POST", "/auth/plex/start")
	pending := findCookie(t, start, pendingCookie)
	for _, cookies := range [][]*http.Cookie{nil, {{Name: pendingCookie, Value: "invalid"}}} {
		w := call(f.h, "POST", "/auth/plex/poll", cookies...)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"code":"plex_sign_in_cookie_required"`) {
			t.Fatalf("missing cookie reported as expiration: %d %s", w.Code, w.Body.String())
		}
		if len(w.Result().Cookies()) != 0 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing cookie must not issue credentials or cache its response")
		}
	}
	if w := call(f.h, "POST", "/auth/plex/poll", pending); w.Code != http.StatusAccepted {
		t.Fatal("valid pending cookie rejected", w.Code)
	}
	f.m.pins[sha256.Sum256([]byte(pending.Value))].expires = time.Now().Add(-time.Second)
	if w := call(f.h, "POST", "/auth/plex/poll", pending); w.Code != http.StatusGone {
		t.Fatal("expired PIN not rejected", w.Code)
	}
	if len(f.m.sessions) != 0 || f.checks.Load() != 0 {
		t.Fatal("unclaimed PIN authenticated")
	}
}

func TestNonMemberExpiryRevocationAndUpstreamFailure(t *testing.T) {
	for _, mode := range []string{"nonmember", "expiry", "revoked", "outage"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			if mode == "nonmember" {
				f.member.Store(false)
			}
			c := f.login(t)
			s := f.m.sessions[sha256.Sum256([]byte(c.Value))]
			switch mode {
			case "expiry":
				s.expires = time.Now().Add(-time.Second)
			case "revoked":
				f.member.Store(false)
				s.checked = time.Now().Add(-accessTTL)
			case "outage":
				f.upstreamFailed.Store(true)
				s.checked = time.Now().Add(-accessTTL)
			}
			if w := call(f.h, "GET", "/media/plex-test/parts/1/file", c); w.Code != 401 {
				t.Fatal("unauthorized bytes allowed", w.Code)
			}
			if s.privateContext().Err() == nil {
				t.Fatal("private access context was not cancelled")
			}
			if w := call(f.h, "GET", "/media/public", c); w.Code != 200 {
				t.Fatal("encoded access blocked")
			}
		})
	}
}

func TestForgeryCSRFAndOriginChecks(t *testing.T) {
	f := setup(t)
	for _, path := range []string{"/auth/plex/start", "/auth/plex/poll", "/auth/plex/logout"} {
		for _, origin := range []string{"", "https://evil.test", "null"} {
			r := httptest.NewRequest("POST", path, nil)
			r.Header.Set("Origin", origin)
			r.Header.Set("X-Sparkle-Auth", "1")
			w := httptest.NewRecorder()
			f.h.ServeHTTP(w, r)
			if w.Code != 403 {
				t.Fatal("CSRF request accepted")
			}
		}
		r := httptest.NewRequest("POST", path, nil)
		r.Header.Set("Origin", "https://sparkle.test")
		w := httptest.NewRecorder()
		f.h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("missing CSRF header accepted")
		}
	}
	if w := call(f.h, "POST", "/auth/plex/poll", &http.Cookie{Name: pendingCookie, Value: randomID()}); w.Code != 410 {
		t.Fatal("forged flow accepted")
	}
	if w := call(f.h, "GET", "/media/plex-test/parts/1/file", &http.Cookie{Name: sessionCookie, Value: randomID()}); w.Code != 401 {
		t.Fatal("forged session accepted")
	}
	valid := f.login(t)
	r := httptest.NewRequest("GET", "/media/plex-test", nil)
	r.AddCookie(valid)
	r.Header.Set("Origin", "https://evil.test")
	w := httptest.NewRecorder()
	f.h.ServeHTTP(w, r)
	if w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("cross-origin credential access allowed")
	}
}

func TestFlowAndSessionBounds(t *testing.T) {
	f := setup(t)
	for i := 0; i < 10; i++ {
		if w := call(f.h, "POST", "/auth/plex/start"); w.Code != 200 {
			t.Fatal(w.Code)
		}
	}
	if w := call(f.h, "POST", "/auth/plex/start"); w.Code != 429 {
		t.Fatal("PIN creation not rate limited")
	}
	for i := 0; i < 140; i++ {
		f.m.pins[sha256.Sum256([]byte(fmt.Sprint(i)))] = &pending{expires: time.Now().Add(-time.Second)}
	}
	f.m.mu.Lock()
	f.m.pruneLocked()
	count := len(f.m.pins)
	f.m.mu.Unlock()
	if count != 10 {
		t.Fatal("expired flows not pruned", count)
	}
}

func TestCookieConfiguration(t *testing.T) {
	for _, opts := range []Options{{Origins: "*"}, {Origins: "https://*.example.com", Secure: true}, {Origins: "https://example.com", Secure: false}, {SameSite: "none", Secure: false}, {Origins: "https://example.com/path", Secure: true}, {SameSite: "invalid", Secure: true}} {
		if m, err := New(opts); err == nil {
			m.Close()
			t.Fatal("unsafe configuration accepted")
		}
	}
	m, err := New(Options{Secure: true, SameSite: "none", Origins: "https://example.com"})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	w := httptest.NewRecorder()
	m.cookie(w, sessionCookie, randomID(), sessionTTL)
	c := w.Result().Cookies()[0]
	if !c.Partitioned || c.SameSite != http.SameSiteNoneMode || !c.Secure {
		t.Fatal("embedded cookies not partitioned")
	}
}
