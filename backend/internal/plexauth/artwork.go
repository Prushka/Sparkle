package plexauth

import "net/http"

type artworkCredentials struct {
	BaseURL   string `json:"baseUrl"`
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expiresAt"`
}

// Only the origin-checked session refresh returns the viewer's resource token.
// It is not artwork-scoped; direct artwork remains an explicit deployment opt-in.
func (m *Manager) privateSession(w http.ResponseWriter, r *http.Request) {
	if !m.mutation(w, r) {
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	reply(w, http.StatusOK, m.sessionState(r.Context(), true))
}
