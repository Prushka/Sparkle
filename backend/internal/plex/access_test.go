package plex

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

func TestUserLibrariesIsolatedFromOwnerCacheAndOtherUsers(t *testing.T) {
	var calls atomic.Int32
	var revoked atomic.Bool
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.Path != "/library/sections" || r.URL.RawQuery != "" {
			t.Errorf("unexpected library request: %s %s", r.Method, r.URL.Path)
		}
		switch r.Header.Get("X-Plex-Token") {
		case "secret-test-token", "member-a":
			if revoked.Load() && r.Header.Get("X-Plex-Token") == "member-a" {
				fmt.Fprint(w, `{"MediaContainer":{"Directory":[]}}`)
				return
			}
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"},{"key":"2","type":"show"},{"key":"3","type":"artist"}]}}`)
		case "member-b":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"2","type":"show"}]}}`)
		default:
			w.WriteHeader(401)
		}
	}, []Mapping{{"/media", t.TempDir()}})
	if _, err := c.Sections(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		token string
		want  []string
	}{{"member-a", []string{"1"}}, {"member-b", []string{}}, {"member-a", []string{"1"}}} {
		got, err := c.UserLibraries(context.Background(), tc.token)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("user libraries = %v, %v; want %v", got, err, tc.want)
		}
	}
	revoked.Store(true)
	if got, err := c.UserLibraries(context.Background(), "member-a"); err != nil || len(got) != 0 || calls.Load() != 5 {
		t.Fatalf("library grant was cached: %v, %v, %d calls", got, err, calls.Load())
	}
	// An empty configuration means all server libraries, still intersected with
	// the user's own sections and the supported video library types.
	c.allowed = map[string]bool{}
	if got, err := c.UserLibraries(context.Background(), "member-b"); err != nil || !reflect.DeepEqual(got, []string{"2"}) {
		t.Fatalf("unconfigured library filter: %v, %v", got, err)
	}
}

func TestUserLibrariesFailsClosedAndDoesNotFollowRedirects(t *testing.T) {
	var redirects atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirects.Add(1)
	}))
	defer destination.Close()
	for _, mode := range []string{"unauthorized", "outage", "redirect", "malformed", "missing-container", "bad-id", "oversize", "cancelled", "empty-token"} {
		t.Run(mode, func(t *testing.T) {
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "unauthorized":
					w.WriteHeader(401)
				case "outage":
					w.WriteHeader(503)
				case "redirect":
					http.Redirect(w, r, destination.URL, 302)
				case "malformed":
					fmt.Fprint(w, "private-token /private/path")
				case "missing-container":
					fmt.Fprint(w, `{}`)
				case "bad-id":
					fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"../1","type":"movie"}]}}`)
				case "oversize":
					fmt.Fprint(w, strings.Repeat(" ", 2*1024*1024+1))
				default:
					t.Error("invalid request reached server")
				}
			}, []Mapping{{"/media", t.TempDir()}})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancelled" {
				cancel()
			}
			token := "private-token"
			if mode == "empty-token" {
				token = ""
			}
			ids, err := c.UserLibraries(ctx, token)
			if err != ErrUnavailable || len(ids) != 0 || strings.Contains(err.Error(), "private") {
				t.Fatalf("failed open or exposed upstream details: %v %v", ids, err)
			}
		})
	}
	if redirects.Load() != 0 {
		t.Fatal("forwarded a member token to a redirect")
	}
}
