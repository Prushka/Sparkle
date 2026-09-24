package catalog

import (
	"crypto/sha256"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicArtworkCapabilitiesAreLimitedAndAuthenticated(t *testing.T) {
	s, mux, _, id := fixture(t)
	image := []byte("encoded title's cached artwork")
	s.artwork.write(fmt.Sprintf("%x", sha256.Sum256([]byte(id+":poster"))), image)
	path := s.publicArtworkURL("/media/" + id + "/artwork/poster")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 200 || w.Body.String() != string(image) {
		t.Fatal("public encoded cover failed", w.Code)
	}
	for _, target := range []string{
		path + "tampered",
		strings.Replace(path, ".", ".x", 1),
		s.publicArtworkURL("/media/" + id + "/parts/2/file"),
		s.publicArtworkURL("/media/" + id + "/artwork/../file"),
		"/library/artwork/not-signed",
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", target, nil))
		if w.Code != 404 {
			t.Fatal("invalid artwork capability admitted", w.Code)
		}
	}
	other, otherMux, _, _ := fixture(t)
	if other.publicArtworkURL("/media/"+id+"/artwork/poster") == path {
		t.Fatal("capability key was reused")
	}
	w = httptest.NewRecorder()
	otherMux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != 404 {
		t.Fatal("previous backend's capability accepted")
	}
}
