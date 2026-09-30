package plexauth

import (
	"net/http"
	"time"
)

// ArtworkToken authorizes a private artwork lookup using the viewer's grant.
// This token is not artwork-scoped; enabling direct artwork is an explicit opt-in.
func (m *Manager) ArtworkToken(w http.ResponseWriter, r *http.Request, id string) string {
	if !m.directArtwork {
		http.NotFound(w, r)
		return ""
	}
	if !m.mutation(w, r) || !m.RequireMedia(w, r, id) {
		return ""
	}
	s, ok := r.Context().Value(contextKey{}).(*session)
	if !ok {
		Required(w)
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Context().Err() != nil || s.ctx.Err() != nil || !s.access || !time.Now().Before(s.expires) || time.Since(s.checked) >= accessTTL || s.serverToken == "" {
		Required(w)
		return ""
	}
	return s.serverToken
}
