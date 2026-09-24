// Package plexauth implements Plex's strong-PIN sign-in without exposing Plex
// access tokens to the browser. Cookies contain random, revocable session IDs.
package plexauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie = "sparkle_plex_session"
	pendingCookie = "sparkle_plex_pending"
	clientCookie  = "sparkle_plex_client"
	sessionTTL    = 14 * 24 * time.Hour
	accessTTL     = 5 * time.Minute
)

type Options struct {
	// Identity returns the exact configured PMS machine identifier, never a URL.
	Identity func(context.Context) (string, error)
	Origins  string
	Secure   bool
	SameSite string
}

type session struct {
	mu                  sync.Mutex
	token, client, name string
	expires, checked    time.Time
	access              bool
	ctx                 context.Context
	cancel              context.CancelFunc
}
type pending struct {
	mu                sync.Mutex
	client, code      string
	id                int64
	expires, nextPoll time.Time
}
type rate struct {
	count int
	until time.Time
}
type Manager struct {
	identity func(context.Context) (string, error)
	origins  map[string]bool
	secure   bool
	sameSite http.SameSite
	http     *http.Client
	api      string
	mu       sync.Mutex
	sessions map[[32]byte]*session
	pins     map[[32]byte]*pending
	rates    map[string]rate
}
type status struct {
	Enabled       bool   `json:"enabled"`
	Authenticated bool   `json:"authenticated"`
	CanAccessRaw  bool   `json:"canAccessRaw"`
	Name          string `json:"name,omitempty"`
}
type contextKey struct{}

func New(opts Options) (*Manager, error) {
	m := &Manager{identity: opts.Identity, origins: map[string]bool{}, secure: opts.Secure, sameSite: http.SameSiteLaxMode,
		http: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		api:  "https://plex.tv/api/v2", sessions: map[[32]byte]*session{}, pins: map[[32]byte]*pending{}, rates: map[string]rate{}}
	if opts.SameSite == "none" {
		if !opts.Secure {
			return nil, errors.New("PLEX_AUTH_COOKIE_SAMESITE=none requires secure cookies")
		}
		m.sameSite = http.SameSiteNoneMode
	} else if opts.SameSite != "" && opts.SameSite != "lax" {
		return nil, errors.New("PLEX_AUTH_COOKIE_SAMESITE must be lax or none")
	}
	for _, origin := range strings.Split(opts.Origins, ",") {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || strings.Contains(u.Host, "*") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return nil, errors.New("PLEX_AUTH_ORIGINS must contain exact HTTP(S) app origins")
		}
		if !opts.Secure && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
			return nil, errors.New("insecure Plex cookies are only supported on loopback origins; use HTTPS")
		}
		m.origins[u.Scheme+"://"+u.Host] = true
	}
	return m, nil
}

func randomID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func cookieID(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil || len(c.Value) != 43 {
		return ""
	}
	if b, err := base64.RawURLEncoding.DecodeString(c.Value); err != nil || len(b) != 32 {
		return ""
	}
	return c.Value
}
func (m *Manager) cookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	age := int(ttl.Seconds())
	if value == "" {
		age = -1
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: m.secure, SameSite: m.sameSite,
		Partitioned: m.sameSite == http.SameSiteNoneMode, MaxAge: age, Expires: time.Now().Add(ttl)})
}
func reply(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(value)
}
func Required(w http.ResponseWriter) {
	reply(w, http.StatusUnauthorized, map[string]string{"code": "plex_sign_in_required", "error": "Sign in with a Plex account that has access to this server."})
}
func (m *Manager) OriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || m.origins[origin]
}
func (m *Manager) mutation(w http.ResponseWriter, r *http.Request) bool {
	if !m.origins[r.Header.Get("Origin")] || r.Header.Get("X-Sparkle-Auth") != "1" {
		reply(w, 403, map[string]string{"error": "Sign-in request origin is not allowed. Check PLEX_AUTH_ORIGINS."})
		return false
	}
	return true
}
func (m *Manager) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/plex/session", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, m.state(r.Context())) })
	mux.HandleFunc("POST /auth/plex/start", m.start)
	mux.HandleFunc("POST /auth/plex/poll", m.poll)
	mux.HandleFunc("POST /auth/plex/logout", m.logout)
}
func (m *Manager) state(ctx context.Context) status {
	v := status{Enabled: m.identity != nil}
	if s, ok := ctx.Value(contextKey{}).(*session); ok && time.Now().Before(s.expires) {
		s.mu.Lock()
		defer s.mu.Unlock()
		v.Authenticated, v.Name, v.CanAccessRaw = true, s.name, s.access && s.ctx.Err() == nil && time.Since(s.checked) < accessTTL
	}
	return v
}
func (m *Manager) CanAccess(ctx context.Context, mediaID string) bool {
	if strings.HasPrefix(mediaID, "plex-") {
		if s, ok := ctx.Value(contextKey{}).(*session); ok {
			m.refresh(ctx, s)
		}
	}
	return !strings.HasPrefix(mediaID, "plex-") || m.state(ctx).CanAccessRaw
}

func (m *Manager) refresh(ctx context.Context, s *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.checked) < accessTTL || s.ctx.Err() != nil {
		return
	}
	name, access, err := m.verify(ctx, s.token, s.client)
	s.checked = time.Now()
	s.access = err == nil && access
	if err == nil {
		s.name = name
	}
	if !s.access {
		s.cancel()
	}
}
func (m *Manager) RequireMedia(w http.ResponseWriter, r *http.Request, mediaID string) bool {
	if m.CanAccess(r.Context(), mediaID) {
		return true
	}
	Required(w)
	return false
}

func (m *Manager) request(ctx context.Context, method, endpoint, client, token string, form url.Values, out any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, m.api+endpoint, body)
	if err != nil {
		return errors.New("Plex sign-in is unavailable")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Plex-Product", "Sparkle Watch Party")
	req.Header.Set("X-Plex-Client-Identifier", client)
	if token != "" {
		req.Header.Set("X-Plex-Token", token)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, err := m.http.Do(req)
	if err != nil {
		return errors.New("Plex sign-in is unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 201 {
		return errors.New("Plex sign-in is unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 || json.Unmarshal(data, out) != nil {
		return errors.New("Plex sign-in is unavailable")
	}
	return nil
}
func (m *Manager) verify(ctx context.Context, token, client string) (string, bool, error) {
	var user struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
		Title    string `json:"title"`
	}
	if err := m.request(ctx, "GET", "/user", client, token, nil, &user); err != nil || user.ID == 0 {
		return "", false, errors.New("Unable to verify the Plex account")
	}
	var resources []struct {
		ClientIdentifier string `json:"clientIdentifier"`
		Provides         string `json:"provides"`
		AccessToken      string `json:"accessToken"`
	}
	if err := m.request(ctx, "GET", "/resources?includeHttps=1", client, token, nil, &resources); err != nil {
		return "", false, err
	}
	server, err := m.identity(ctx)
	if err != nil {
		return "", false, errors.New("Unable to verify access to the configured Plex server")
	}
	name := user.Title
	if name == "" {
		name = user.Username
	}
	if len(name) > 128 {
		name = string([]rune(name)[:min(128, len([]rune(name)))])
	}
	for _, resource := range resources {
		if resource.ClientIdentifier == server && resource.AccessToken != "" {
			for _, provided := range strings.Split(resource.Provides, ",") {
				if provided == "server" {
					return name, true, nil
				}
			}
		}
	}
	return name, false, nil
}

// Pruning and hard caps keep unauthenticated PIN creation and sessions bounded.
func (m *Manager) pruneLocked() {
	now := time.Now()
	for k, s := range m.sessions {
		if now.After(s.expires) {
			s.cancel()
			delete(m.sessions, k)
		}
	}
	for k, p := range m.pins {
		if now.After(p.expires) {
			delete(m.pins, k)
		}
	}
	for k, r := range m.rates {
		if now.After(r.until) {
			delete(m.rates, k)
		}
	}
}
func (m *Manager) start(w http.ResponseWriter, r *http.Request) {
	if !m.mutation(w, r) {
		return
	}
	if m.identity == nil {
		reply(w, 503, map[string]string{"error": "Plex is not configured"})
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	m.mu.Lock()
	m.pruneLocked()
	limit := m.rates[host]
	if limit.until.IsZero() && len(m.rates) >= 1024 {
		m.mu.Unlock()
		reply(w, 429, map[string]string{"error": "Too many sign-in attempts"})
		return
	}
	if limit.until.IsZero() {
		limit.until = time.Now().Add(10 * time.Minute)
	}
	limit.count++
	m.rates[host] = limit
	full := len(m.pins) >= 128 || len(m.sessions) >= 2048 || len(m.rates) > 1024 || limit.count > 10
	m.mu.Unlock()
	if full {
		reply(w, 429, map[string]string{"error": "Too many sign-in attempts. Try again later."})
		return
	}
	client := cookieID(r, clientCookie)
	if client == "" {
		client = randomID()
		m.cookie(w, clientCookie, client, 365*24*time.Hour)
	}
	var pin struct {
		ID   int64  `json:"id"`
		Code string `json:"code"`
	}
	if err := m.request(r.Context(), "POST", "/pins", client, "", url.Values{"strong": {"true"}}, &pin); err != nil || pin.ID <= 0 || len(pin.Code) < 8 || len(pin.Code) > 256 {
		reply(w, 502, map[string]string{"error": "Unable to start Plex sign-in. Please try again."})
		return
	}
	id := randomID()
	m.mu.Lock()
	delete(m.pins, sha256.Sum256([]byte(cookieID(r, pendingCookie))))
	if len(m.pins) >= 128 {
		m.mu.Unlock()
		reply(w, 429, map[string]string{"error": "Too many sign-in attempts"})
		return
	}
	m.pins[sha256.Sum256([]byte(id))] = &pending{client: client, code: pin.Code, id: pin.ID, expires: time.Now().Add(10 * time.Minute)}
	m.mu.Unlock()
	m.cookie(w, pendingCookie, id, 10*time.Minute)
	params := url.Values{"clientID": {client}, "code": {pin.Code}, "context[device][product]": {"Sparkle Watch Party"}}
	reply(w, 200, map[string]any{"url": "https://app.plex.tv/auth#?" + params.Encode(), "expiresIn": 600})
}
func (m *Manager) poll(w http.ResponseWriter, r *http.Request) {
	if !m.mutation(w, r) {
		return
	}
	ctx, cancelRequest := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancelRequest()
	r = r.WithContext(ctx)
	key := sha256.Sum256([]byte(cookieID(r, pendingCookie)))
	m.mu.Lock()
	m.pruneLocked()
	p := m.pins[key]
	m.mu.Unlock()
	if p == nil {
		reply(w, 410, map[string]string{"error": "Sign-in expired. Please try again."})
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	m.mu.Lock()
	active := m.pins[key] == p
	m.mu.Unlock()
	if !active {
		reply(w, 410, map[string]string{"error": "Sign-in expired"})
		return
	}
	if time.Now().Before(p.nextPoll) {
		reply(w, 202, map[string]bool{"pending": true})
		return
	}
	p.nextPoll = time.Now().Add(2 * time.Second)
	var pin struct {
		AuthToken string `json:"authToken"`
	}
	endpoint := "/pins/" + strconv.FormatInt(p.id, 10) + "?" + url.Values{"code": {p.code}}.Encode()
	if err := m.request(r.Context(), "GET", endpoint, p.client, "", nil, &pin); err != nil {
		reply(w, 502, map[string]string{"error": "Unable to check Plex sign-in. Please try again."})
		return
	}
	if pin.AuthToken == "" {
		reply(w, 202, map[string]bool{"pending": true})
		return
	}
	if len(pin.AuthToken) > 16384 {
		reply(w, 502, map[string]string{"error": "Invalid Plex sign-in response"})
		return
	}
	name, access, err := m.verify(r.Context(), pin.AuthToken, p.client)
	if err != nil {
		reply(w, 502, map[string]string{"error": err.Error()})
		return
	}
	id := randomID()
	expires := time.Now().Add(sessionTTL)
	sessionContext, cancel := context.WithDeadline(context.Background(), expires)
	s := &session{token: pin.AuthToken, client: p.client, name: name, access: access, checked: time.Now(), expires: expires, ctx: sessionContext, cancel: cancel}
	m.mu.Lock()
	if m.pins[key] != p || len(m.sessions) >= 2048 {
		m.mu.Unlock()
		cancel()
		reply(w, 409, map[string]string{"error": "Sign-in changed. Please try again."})
		return
	}
	delete(m.pins, key)
	old := sha256.Sum256([]byte(cookieID(r, sessionCookie)))
	if previous := m.sessions[old]; previous != nil {
		previous.cancel()
		delete(m.sessions, old)
	}
	m.sessions[sha256.Sum256([]byte(id))] = s
	m.mu.Unlock()
	m.cookie(w, pendingCookie, "", -time.Hour)
	m.cookie(w, sessionCookie, id, sessionTTL)
	reply(w, 200, status{Enabled: true, Authenticated: true, CanAccessRaw: access, Name: name})
}
func (m *Manager) logout(w http.ResponseWriter, r *http.Request) {
	if !m.mutation(w, r) {
		return
	}
	m.mu.Lock()
	key := sha256.Sum256([]byte(cookieID(r, sessionCookie)))
	if s := m.sessions[key]; s != nil {
		s.cancel()
		delete(m.sessions, key)
	}
	delete(m.pins, sha256.Sum256([]byte(cookieID(r, pendingCookie))))
	m.mu.Unlock()
	m.cookie(w, sessionCookie, "", -time.Hour)
	m.cookie(w, pendingCookie, "", -time.Hour)
	reply(w, 200, status{Enabled: m.identity != nil})
}

func (m *Manager) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Cookie")
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if !m.origins[origin] {
				reply(w, 403, map[string]string{"error": "Request origin is not allowed"})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match, If-Modified-Since, Range, If-Range, X-Sparkle-Auth")
		w.Header().Set("Access-Control-Expose-Headers", "ETag, Retry-After, Accept-Ranges, Content-Range, Content-Length, Last-Modified")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		m.mu.Lock()
		m.pruneLocked()
		s := m.sessions[sha256.Sum256([]byte(cookieID(r, sessionCookie)))]
		m.mu.Unlock()
		if s != nil && m.identity != nil {
			if r.URL.Path != "/auth/plex/logout" {
				m.refresh(r.Context(), s)
			}
			r = r.WithContext(context.WithValue(r.Context(), contextKey{}, s))
		}
		allowed := m.state(r.Context()).CanAccessRaw
		path := r.URL.Path
		protected := strings.HasPrefix(path, "/media/plex-") || strings.HasPrefix(path, "/library/items/plex-")
		if protected && !allowed {
			Required(w)
			return
		}
		if !allowed && path == "/library/sources" {
			reply(w, 200, map[string]any{"sources": []map[string]string{{"id": "processed", "source": "processed", "title": "Encoded"}}})
			return
		}
		if !allowed && path == "/library/items" {
			q := r.URL.Query()
			if q.Get("source") == "plex" || q.Get("libraryId") != "" {
				Required(w)
				return
			}
			if q.Get("source") == "" || q.Get("source") == "all" {
				clone := *r.URL
				q.Set("source", "processed")
				clone.RawQuery = q.Encode()
				r = r.Clone(r.Context())
				r.URL = &clone
			}
		}
		if protected && s != nil {
			ctx, cancel := context.WithCancel(r.Context())
			stop := context.AfterFunc(s.ctx, cancel)
			defer cancel()
			defer stop()
			r = r.WithContext(ctx)
			w = &privateWriter{ResponseWriter: w, ctx: ctx}
		}
		next.ServeHTTP(w, r)
	})
}

// Stop buffered file/encode writes too; cancelling a request context alone does
// not make http.ServeContent stop copying bytes from an already-open file.
type privateWriter struct {
	http.ResponseWriter
	ctx context.Context
}

func (w *privateWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *privateWriter) Write(data []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	return w.ResponseWriter.Write(data)
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		s.cancel()
	}
	m.sessions = map[[32]byte]*session{}
	m.pins = map[[32]byte]*pending{}
}

// String deliberately avoids any credentials when inspected by diagnostics.
func (m *Manager) String() string {
	return fmt.Sprintf("Plex sign-in (configured=%t)", m.identity != nil)
}
