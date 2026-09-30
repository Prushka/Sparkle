package plex

import (
	"context"
	"fmt"
	"net/http"
	"testing"
)

func TestArtworkPathOnlyReadsMetadataAndRejectsExternalPaths(t *testing.T) {
	for _, path := range []string{
		"/library/metadata/7/thumb/123", "/library/metadata/7/art",
		"https://other.example/image", "//other.example/image",
		"/library/metadata/7/thumb/../file", "/library/metadata/7/thumb?X-Plex-Token=secret",
	} {
		t.Run(path, func(t *testing.T) {
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/identity":
					fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"artwork-test"}}`)
				case "/library/sections":
					fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"}]}}`)
				case "/library/metadata/7":
					fmt.Fprintf(w, `{"MediaContainer":{"Metadata":[{"ratingKey":"7","librarySectionID":1,"type":"movie","thumb":%q,"Media":[{"id":1}]}]}}`, path)
				default:
					t.Error("artwork path lookup requested bytes or unrelated metadata", r.URL.Path)
					http.NotFound(w, r)
				}
			}, []Mapping{{"/media", t.TempDir()}})
			id, err := c.ID(context.Background(), "7", 1)
			if err != nil {
				t.Fatal(err)
			}
			got, err := c.ArtworkPath(context.Background(), id, "poster")
			valid := path == "/library/metadata/7/thumb/123" || path == "/library/metadata/7/art"
			if valid && (err != nil || got != path) {
				t.Fatal("valid artwork path rejected")
			}
			if !valid && (err == nil || got != "") {
				t.Fatal("untrusted artwork path accepted")
			}
		})
	}
}
