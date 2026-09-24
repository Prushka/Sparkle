package plexauth

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const avatarLimit = 512 << 10
const avatarEntries = 64

var avatarPath = regexp.MustCompile(`^/users/[A-Za-z0-9_-]{1,128}/avatar$`)
var avatarFile = regexp.MustCompile(`^plex-[a-f0-9]{32}\.png$`)
var avatarAssetPath = regexp.MustCompile(`^/avatars/[A-Za-z0-9_.-]{1,128}$`)

type accountProfile struct{ id, name, avatar string }
type avatarEntry struct {
	mu               sync.Mutex
	url, contentType string
	data             []byte
	expires          time.Time
}

func profileID(id int64) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("sparkle:plex-profile:%d", id)))
	return fmt.Sprintf("plex-%x", sum[:16])
}

// Return only the verified account identity, never a browser-supplied name/ID.
func (m *Manager) Profile(ctx context.Context) (id, name string, ok bool) {
	s, ok := ctx.Value(contextKey{}).(*session)
	if !ok {
		return "", "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Now().After(s.expires) || s.ctx.Err() != nil {
		return "", "", false
	}
	return s.profileID, s.name, s.profileID != ""
}

// Plex's documented account thumbnail is a public /users/<id>/avatar URL.
// Keep that URL server-side; allow no arbitrary hosts or credentials.
func safeAvatarURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "plex.tv" || u.User != nil || u.Fragment != "" || !avatarPath.MatchString(u.Path) || u.RawPath != "" {
		return ""
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return ""
	}
	for k, values := range q {
		if k != "c" || len(values) != 1 || len(values[0]) > 32 {
			return ""
		}
		for _, c := range values[0] {
			if c < '0' || c > '9' {
				return ""
			}
		}
	}
	return u.String()
}

func avatarRedirect(req *http.Request, via []*http.Request) error {
	u := req.URL
	if len(via) > 2 || u.Scheme != "https" || u.Host != "assets.plex.tv" || u.User != nil || u.Fragment != "" || u.RawPath != "" || !avatarAssetPath.MatchString(u.Path) {
		return http.ErrUseLastResponse
	}
	// Avatar delivery never needs an account token, cookie or referer.
	req.Header = make(http.Header)
	return nil
}

// Use the existing public room-avatar URL space so chat/history and other
// participants see the same picture. No account tokens or media access are shared.
func (m *Manager) ProfileImages(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		file := strings.TrimPrefix(r.URL.Path, "/static/pfp/")
		if !strings.HasPrefix(file, "plex-") {
			next.ServeHTTP(w, r)
			return
		}
		if !avatarFile.MatchString(file) {
			http.NotFound(w, r)
			return
		}
		id := strings.TrimSuffix(file, ".png")
		m.mu.Lock()
		sessions := make([]*session, 0, len(m.sessions))
		for _, s := range m.sessions {
			sessions = append(sessions, s)
		}
		m.mu.Unlock()
		avatar := ""
		for _, s := range sessions {
			s.mu.Lock()
			if s.profileID == id && time.Now().Before(s.expires) && s.ctx.Err() == nil {
				avatar = s.avatar
			}
			s.mu.Unlock()
			if avatar != "" {
				break
			}
		}
		if avatar == "" {
			http.NotFound(w, r)
			return
		}
		m.mu.Lock()
		entry := m.avatars[id]
		if entry == nil {
			if len(m.avatars) >= avatarEntries {
				for key := range m.avatars {
					delete(m.avatars, key)
					break
				}
			}
			entry = &avatarEntry{}
			m.avatars[id] = entry
		}
		m.mu.Unlock()
		entry.mu.Lock()
		defer entry.mu.Unlock()
		if entry.url != avatar || time.Now().After(entry.expires) {
			// Cache failures briefly too so a missing avatar cannot flood Plex.
			entry.url, entry.data, entry.expires = avatar, nil, time.Now().Add(time.Minute)
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, "GET", avatar, nil)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			client := *m.http
			client.CheckRedirect = avatarRedirect
			res, err := client.Do(req)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				log.Printf("Plex avatar unavailable: upstream status %d", res.StatusCode)
				http.NotFound(w, r)
				return
			}
			data, err := io.ReadAll(io.LimitReader(res.Body, avatarLimit+1))
			if err != nil || len(data) > avatarLimit {
				log.Print("Plex avatar unavailable: response exceeds image limit or could not be read")
				http.NotFound(w, r)
				return
			}
			kind := http.DetectContentType(data)
			switch kind {
			case "image/png", "image/jpeg", "image/gif", "image/webp":
			default:
				log.Printf("Plex avatar unavailable: unsupported image type %q", kind)
				http.NotFound(w, r)
				return
			}
			entry.data, entry.contentType, entry.expires = data, kind, time.Now().Add(15*time.Minute)
		}
		if len(entry.data) == 0 {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", entry.contentType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "private, max-age=300")
		w.Header().Set("Content-Length", fmt.Sprint(len(entry.data)))
		if r.Method != "HEAD" {
			_, _ = w.Write(entry.data)
		}
	})
}
