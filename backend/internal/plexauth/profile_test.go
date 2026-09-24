package plexauth

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type avatarTransport func(*http.Request) (*http.Response, error)

func (f avatarTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPlexProfileAndBoundedAvatarProxy(t *testing.T) {
	f := setup(t)
	cookie := f.login(t)
	state := call(f.h, "GET", "/auth/plex/session", cookie)
	if !strings.Contains(state.Body.String(), `"profileId":"`+profileID(42)+`"`) || strings.Contains(state.Body.String(), "plex.tv/users") {
		t.Fatal("missing safe public profile ID or exposed upstream avatar")
	}
	inspect := f.m.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, name, ok := f.m.Profile(r.Context())
		if !ok || id != profileID(42) || name != "Test member" {
			t.Error("verified profile missing")
		}
	}))
	call(inspect, "GET", "/profile", cookie)
	if _, _, ok := f.m.Profile(context.Background()); ok {
		t.Fatal("anonymous profile authenticated")
	}
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=")
	var requests atomic.Int32
	f.m.http.Transport = avatarTransport(func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		if r.URL.String() != "https://plex.tv/users/test-member/avatar?c=123" || r.Header.Get("X-Plex-Token") != "" || r.Header.Get("Cookie") != "" {
			t.Error("unsafe avatar request")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(png))}, nil
	})
	var fallbacks int
	h := f.m.ProfileImages(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fallbacks++; w.WriteHeader(204) }))
	path := "/static/pfp/" + profileID(42) + ".png"
	for _, method := range []string{"GET", "HEAD", "GET"} {
		w := call(h, method, path)
		if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" {
			t.Fatal("avatar missing", w.Code)
		}
		if method == "HEAD" && w.Body.Len() != 0 {
			t.Fatal("HEAD wrote image")
		}
	}
	if requests.Load() != 1 {
		t.Fatal("avatar requests not coalesced/cached")
	}
	if w := call(h, "GET", "/static/pfp/guest.png"); w.Code != 204 || fallbacks != 1 {
		t.Fatal("guest avatars changed")
	}
	if w := call(h, "GET", "/static/pfp/plex-invalid.png"); w.Code != 404 {
		t.Fatal("invalid profile accepted")
	}
	for i := range avatarEntries + 1 {
		id := profileID(int64(i + 100))
		ctx, cancel := context.WithCancel(context.Background())
		t.Cleanup(cancel)
		f.m.sessions[[32]byte{byte(i + 1)}] = &session{profileID: id, avatar: "https://plex.tv/users/test-member/avatar?c=123", expires: time.Now().Add(time.Hour), ctx: ctx, cancel: cancel}
		call(h, "GET", "/static/pfp/"+id+".png")
	}
	if len(f.m.avatars) != avatarEntries {
		t.Fatal("avatar cache is not bounded")
	}
	call(f.h, "POST", "/auth/plex/logout", cookie)
	if w := call(h, "GET", path); w.Code != 404 {
		t.Fatal("signed-out account avatar remains addressable")
	}
}

func TestAvatarRejectsUnsafeURLsAndResponses(t *testing.T) {
	for _, raw := range []string{"https://evil.test/avatar", "http://plex.tv/users/a/avatar", "https://plex.tv:443/users/a/avatar", "https://user:secret@plex.tv/users/a/avatar", "https://plex.tv/users/a/avatar?X-Plex-Token=secret", "https://plex.tv/users/a/avatar?c=1&c=2", "https://plex.tv/users/a/avatar?c=bad", "https://plex.tv/users/../avatar", "https://plex.tv/users/a/avatar#secret", "https://plex.tv/api/v2/user"} {
		if safeAvatarURL(raw) != "" {
			t.Errorf("unsafe avatar allowed: %s", raw)
		}
	}
	for _, code := range []int{200, 302, 503} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			f := setup(t)
			f.login(t)
			var calls atomic.Int32
			f.m.http.Transport = avatarTransport(func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				return &http.Response{StatusCode: code, Header: http.Header{"Location": {"https://evil.test/"}}, Body: io.NopCloser(strings.NewReader(strings.Repeat("x", avatarLimit+1)))}, nil
			})
			h := f.m.ProfileImages(http.NotFoundHandler())
			for range 2 {
				if w := call(h, "GET", "/static/pfp/"+profileID(42)+".png"); w.Code != 404 {
					t.Fatal("invalid image served")
				}
			}
			if calls.Load() != 1 {
				t.Fatal("redirect followed or failed image repeatedly fetched")
			}
		})
	}
}

func TestAvatarAllowsOnlyBoundedPlexAssetRedirects(t *testing.T) {
	f := setup(t)
	f.login(t)
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=")
	var calls atomic.Int32
	f.m.http.Transport = avatarTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.Host == "plex.tv" {
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://assets.plex.tv/avatars/test-image.?cache=1"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		if r.URL.Host != "assets.plex.tv" || len(r.Header) != 0 {
			t.Error("unsafe avatar redirect")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(png))}, nil
	})
	w := call(f.m.ProfileImages(http.NotFoundHandler()), "GET", "/static/pfp/"+profileID(42)+".png")
	if w.Code != 200 || calls.Load() != 2 {
		t.Fatal("Plex CDN avatar did not load", w.Code)
	}
	for _, raw := range []string{"http://assets.plex.tv/avatars/a.png", "https://assets.plex.tv.evil.test/avatars/a.png", "https://assets.plex.tv/private", "https://user:secret@assets.plex.tv/avatars/a.png", "https://assets.plex.tv:444/avatars/a.png"} {
		req, _ := http.NewRequest("GET", raw, nil)
		if avatarRedirect(req, []*http.Request{{}}) == nil {
			t.Error("unsafe redirect allowed")
		}
	}
	req, _ := http.NewRequest("GET", "https://assets.plex.tv/avatars/a.png", nil)
	if avatarRedirect(req, []*http.Request{{}, {}, {}}) == nil {
		t.Fatal("unbounded avatar redirect")
	}
}
