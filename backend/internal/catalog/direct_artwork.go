package catalog

import (
	"net/http"
	"net/url"
	"strings"
)

// RegisterDirectArtwork keeps credentials out of public metadata and GET routes.
// tokenFor must authorize the resolved media and return this viewer's PMS token.
func (s *Service) RegisterDirectArtwork(mux *http.ServeMux, publicURL string, tokenFor func(http.ResponseWriter, *http.Request, string) string) {
	base, err := url.Parse(publicURL)
	enabled := err == nil && base.Scheme == "https" && base.Hostname() != "" && base.User == nil && base.RawQuery == "" && !base.ForceQuery && base.Fragment == "" && base.Opaque == ""
	handler := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !enabled || s.plex == nil || tokenFor == nil {
			http.NotFound(w, r)
			return
		}
		if r.PathValue("token") != "" && !s.resolvePublicArt(w, r) {
			return
		}
		id, kind := r.PathValue("id"), r.PathValue("kind")
		if !strings.HasPrefix(id, "plex-") || (kind != "poster" && kind != "backdrop") {
			http.NotFound(w, r)
			return
		}
		token := tokenFor(w, r, id)
		if token == "" {
			return
		}
		path, err := s.plex.ArtworkPath(r.Context(), id, kind)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		target := *base
		target.Path = strings.TrimRight(target.Path, "/") + path
		target.RawPath = ""
		target.RawQuery = url.Values{"X-Plex-Token": {token}}.Encode()
		if r.Context().Err() == nil {
			jsonResponse(w, http.StatusOK, map[string]string{"url": target.String()})
		}
	}
	mux.HandleFunc("POST /media/{id}/artwork/{kind}/direct", handler)
	mux.HandleFunc("POST /library/artwork/{token}/direct", handler)
}
