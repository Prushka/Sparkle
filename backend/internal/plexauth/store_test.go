package plexauth

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func (f *fixture) restart(t *testing.T, dir string) {
	t.Helper()
	api, identity := f.m.api, f.m.identity
	f.m.Close()
	m, err := New(Options{SessionDir: dir, Identity: identity, Origins: "https://sparkle.test", Secure: true})
	if err != nil {
		t.Fatal(err)
	}
	m.api = api
	f.useManager(t, m)
}

func sessionStatus(t *testing.T, f *fixture, c *http.Cookie) status {
	t.Helper()
	w := call(f.h, "GET", "/auth/plex/session", c)
	var state status
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &state) != nil {
		t.Fatalf("session response = %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "secret") || strings.Contains(w.Body.String(), c.Value) {
		t.Fatal("credentials exposed by session response")
	}
	return state
}

func TestPersistentSessionRestartAndLogout(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	cookie := f.login(t)
	key := sha256.Sum256([]byte(cookie.Value))
	expires := f.m.sessions[key].expires
	// The cookie is not stored; possession of a database session key alone is
	// insufficient to authenticate a browser.
	if err := f.m.store.db.View(func(tx *bolt.Tx) error {
		data := tx.Bucket(sessionBucket).Get(key[:])
		if len(data) == 0 || strings.Contains(string(data), cookie.Value) {
			t.Fatal("sign-in was not durably stored under its cookie hash")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.restart(t, dir)
	if !f.m.sessions[key].expires.Equal(expires) || !f.m.sessions[key].checked.IsZero() || f.m.sessions[key].access {
		t.Fatal("restart extended expiry or restored a cached authorization decision")
	}
	state := sessionStatus(t, f, cookie)
	if !state.Authenticated || !state.CanAccessRaw || state.Name != "Test member" || state.ProfileID != profileID(42) || f.checks.Load() != 2 {
		t.Fatalf("restored session = %+v, checks = %d", state, f.checks.Load())
	}
	if w := call(f.h, "POST", "/auth/plex/logout", cookie); w.Code != 200 {
		t.Fatal("logout failed", w.Code)
	}
	f.restart(t, dir)
	if sessionStatus(t, f, cookie).Authenticated || call(f.h, "GET", "/media/plex-test/parts/1/file", cookie).Code != 401 {
		t.Fatal("logged-out cookie became valid after restart")
	}
}

func TestRestoredSessionRechecksAccessAndRecoversAfterOutage(t *testing.T) {
	for _, mode := range []string{"removed-member", "different-server", "revoked-token", "outage"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			f := setup(t, dir)
			cookie := f.login(t)
			switch mode {
			case "removed-member":
				f.member.Store(false)
			case "different-server":
				f.m.identity = func(context.Context) (string, error) { return "new-server", nil }
			case "outage":
				f.upstreamFailed.Store(true)
			case "revoked-token":
				f.revoked.Store(true)
			}
			f.restart(t, dir)
			if w := call(f.h, "GET", "/media/plex-test/parts/1/file", cookie); w.Code != 401 {
				t.Fatal("unverified restored session read private media", w.Code)
			}
			state := sessionStatus(t, f, cookie)
			if !state.Authenticated || state.CanAccessRaw {
				t.Fatalf("failed check discarded login or granted access: %+v", state)
			}
			if mode == "outage" {
				f.upstreamFailed.Store(false)
				s := f.m.sessions[sha256.Sum256([]byte(cookie.Value))]
				s.checked = time.Now().Add(-accessTTL)
				if state := sessionStatus(t, f, cookie); !state.Authenticated || !state.CanAccessRaw {
					t.Fatalf("outage forced a new sign-in: %+v", state)
				}
			}
		})
	}
}

func TestReplacementSessionRevokesOldCookieAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	old := f.login(t)
	start := call(f.h, "POST", "/auth/plex/start", old)
	complete := call(f.h, "POST", "/auth/plex/poll", findCookie(t, start, pendingCookie), old)
	if complete.Code != 200 {
		t.Fatal(complete.Body.String())
	}
	current := findCookie(t, complete, sessionCookie)
	f.restart(t, dir)
	if sessionStatus(t, f, old).Authenticated || !sessionStatus(t, f, current).CanAccessRaw {
		t.Fatal("session replacement was not durable")
	}
}

func TestLogoutDoesNotWaitForPlexRevalidation(t *testing.T) {
	f := setup(t, t.TempDir())
	cookie := f.login(t)
	s := f.m.sessions[sha256.Sum256([]byte(cookie.Value))]
	s.checked = time.Now().Add(-accessTTL)
	started, release := make(chan struct{}), make(chan struct{})
	f.m.identity = func(context.Context) (string, error) {
		close(started)
		<-release
		return "configured-server", nil
	}
	checked := make(chan status, 1)
	go func() {
		w := call(f.h, "GET", "/auth/plex/session", cookie)
		var state status
		json.Unmarshal(w.Body.Bytes(), &state)
		checked <- state
	}()
	defer func() {
		close(release)
		select {
		case state := <-checked:
			if state.Authenticated {
				t.Error("late Plex verification revived a logged-out session")
			}
		case <-time.After(time.Second):
			t.Error("revalidation did not finish")
		}
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("revalidation did not start")
	}
	loggedOut := make(chan int, 1)
	go func() { loggedOut <- call(f.h, "POST", "/auth/plex/logout", cookie).Code }()
	select {
	case code := <-loggedOut:
		if code != 200 || s.ctx.Err() == nil {
			t.Fatal("logout did not revoke the session", code)
		}
	case <-time.After(time.Second):
		t.Fatal("logout waited for Plex revalidation")
	}
}

func TestFailedRevalidationCancelsOldStreamsAndAllowsRecovery(t *testing.T) {
	f := setup(t)
	cookie := f.login(t)
	s := f.m.sessions[sha256.Sum256([]byte(cookie.Value))]
	old := s.privateContext()
	f.member.Store(false)
	s.checked = time.Now().Add(-accessTTL)
	if sessionStatus(t, f, cookie).CanAccessRaw || old.Err() == nil || s.ctx.Err() != nil {
		t.Fatal("failed membership check did not cancel old streams while retaining login")
	}
	f.member.Store(true)
	s.checked = time.Now().Add(-accessTTL)
	if !sessionStatus(t, f, cookie).CanAccessRaw || s.privateContext().Err() != nil || old.Err() == nil {
		t.Fatal("recovery failed or revived a previously canceled stream")
	}
}

func TestConcurrentPersistentSessionChanges(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	f.claimed.Store(true)
	const count = 8
	results := make(chan *http.Cookie, count)
	for range count {
		go func() {
			start := call(f.h, "POST", "/auth/plex/start")
			var cookies []*http.Cookie
			for _, c := range start.Result().Cookies() {
				if c.Name == pendingCookie {
					cookies = append(cookies, c)
				}
			}
			complete := call(f.h, "POST", "/auth/plex/poll", cookies...)
			for _, c := range complete.Result().Cookies() {
				if c.Name == sessionCookie {
					results <- c
					return
				}
			}
			results <- nil
		}()
	}
	var cookies []*http.Cookie
	for range count {
		cookie := <-results
		if cookie == nil {
			t.Fatal("concurrent login failed")
		}
		cookies = append(cookies, cookie)
	}
	f.restart(t, dir)
	for _, cookie := range cookies {
		if !sessionStatus(t, f, cookie).CanAccessRaw {
			t.Fatal("concurrent login was lost")
		}
	}
	codes := make(chan int, count)
	for _, cookie := range cookies {
		go func() { codes <- call(f.h, "POST", "/auth/plex/logout", cookie).Code }()
	}
	for range count {
		if code := <-codes; code != 200 {
			t.Fatal("concurrent logout failed", code)
		}
	}
	f.restart(t, dir)
	if len(f.m.sessions) != 0 {
		t.Fatal("concurrent logout was lost")
	}
}

func TestExpiredPersistentSessionsArePruned(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	expired := []*http.Cookie{f.login(t), f.login(t)}
	live := f.login(t)
	for _, cookie := range expired {
		key := sha256.Sum256([]byte(cookie.Value))
		s := f.m.sessions[key]
		s.expires = time.Now().Add(-time.Second)
		if err := f.m.store.replace(key, key, s); err != nil {
			t.Fatal(err)
		}
	}
	f.restart(t, dir)
	if len(f.m.sessions) != 1 || !sessionStatus(t, f, live).CanAccessRaw {
		t.Fatal("pruning skipped a valid or expired session")
	}
	for _, cookie := range expired {
		if sessionStatus(t, f, cookie).Authenticated {
			t.Fatal("expired session restored")
		}
	}
	if err := f.m.store.db.View(func(tx *bolt.Tx) error {
		for _, cookie := range expired {
			key := sha256.Sum256([]byte(cookie.Value))
			if tx.Bucket(sessionBucket).Get(key[:]) != nil {
				t.Fatal("expired credentials retained on disk")
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPersistenceFailuresDoNotAcknowledgeLoginOrLogout(t *testing.T) {
	for _, action := range []string{"login", "logout"} {
		t.Run(action, func(t *testing.T) {
			dir := t.TempDir()
			f := setup(t, dir)
			var cookie *http.Cookie
			if action == "logout" {
				cookie = f.login(t)
			}
			// A closed DB deterministically simulates an unavailable writer.
			if err := f.m.store.db.Close(); err != nil {
				t.Fatal(err)
			}
			var wStatus int
			if action == "login" {
				f.claimed.Store(true)
				start := call(f.h, "POST", "/auth/plex/start")
				w := call(f.h, "POST", "/auth/plex/poll", findCookie(t, start, pendingCookie))
				wStatus = w.Code
				if len(f.m.sessions) != 0 || len(w.Result().Cookies()) != 0 {
					t.Fatal("failed persistence issued a session")
				}
			} else {
				w := call(f.h, "POST", "/auth/plex/logout", cookie)
				wStatus = w.Code
				if len(w.Result().Cookies()) != 0 || call(f.h, "GET", "/media/plex-test/parts/1/file", cookie).Code != 401 {
					t.Fatal("failed logout cleared the retry cookie or left active access")
				}
			}
			if wStatus != 503 {
				t.Fatalf("persistence failure returned %d", wStatus)
			}
		})
	}
}

func TestSessionStoreRejectsUnsafeOrUnavailableStorage(t *testing.T) {
	dir := t.TempDir()
	f := setup(t, dir)
	if m, err := New(Options{SessionDir: dir}); err == nil {
		m.Close()
		t.Fatal("two managers opened the same session store")
	}
	f.m.Close()
	for _, path := range []string{dir, filepath.Join(dir, "nested")} {
		if m, err := New(Options{SessionDir: path, PublicDirs: []string{dir}}); err == nil {
			m.Close()
			t.Fatal("credentials allowed in a public directory")
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "sessions.db"), []byte("corrupt session storage"), 0o600); err != nil {
		t.Fatal(err)
	}
	if m, err := New(Options{SessionDir: dir}); err == nil {
		m.Close()
		t.Fatal("corrupt store silently replaced with empty sessions")
	}
}

func TestSessionSurvivesAbruptProcessExit(t *testing.T) {
	dir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestSessionCrashHelper$")
	cmd.Env = append(os.Environ(), "SPARKLE_AUTH_STORE_FIXTURE="+dir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("fixture process failed: %v: %s", err, output)
	}
	cookie := &http.Cookie{Name: sessionCookie, Value: strings.TrimSpace(string(output))}
	f := setup(t, dir)
	if state := sessionStatus(t, f, cookie); !state.Authenticated || !state.CanAccessRaw {
		t.Fatal("sign-in depended on a graceful shutdown")
	}
}

func TestSessionCrashHelper(t *testing.T) {
	dir := os.Getenv("SPARKLE_AUTH_STORE_FIXTURE")
	if dir == "" {
		t.Skip("subprocess fixture only")
	}
	f := setup(t, dir)
	cookie := f.login(t)
	fmt.Print(cookie.Value)
	os.Exit(0) // Deliberately bypass Manager.Close and all test cleanup.
}
