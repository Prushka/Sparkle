package catalog

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
)

// Public Encoded titles retain matched Plex artwork. Only the conservative
// matching code mints these capabilities; they cannot be used for media bytes
// or for arbitrary Plex metadata. The key rotates on backend restart.
func (s *Service) publicArtworkURL(path string) string {
	if path == "" {
		return ""
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("encoded-artwork:" + path))
	return "/library/artwork/" + base64.RawURLEncoding.EncodeToString([]byte(path)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Service) publicArt(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	parts := strings.Split(token, ".")
	if len(parts) != 2 || len(token) > 512 {
		http.NotFound(w, r)
		return
	}
	path, err := base64.RawURLEncoding.DecodeString(parts[0])
	sig, sigErr := base64.RawURLEncoding.DecodeString(parts[1])
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("encoded-artwork:" + string(path)))
	if err != nil || sigErr != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		http.NotFound(w, r)
		return
	}
	segments := strings.Split(string(path), "/")
	if len(segments) != 5 || segments[1] != "media" || segments[3] != "artwork" || (segments[4] != "poster" && segments[4] != "backdrop") {
		http.NotFound(w, r)
		return
	}
	r.SetPathValue("id", segments[2])
	r.SetPathValue("kind", segments[4])
	s.art(w, r)
}
