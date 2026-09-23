package plex

import (
	"encoding/json"
	"testing"
)

func TestCanonicalGUIDAndExternalGUIDs(t *testing.T) {
	for _, fields := range []string{
		`"guid":"plex://show/canonical","Guid":[{"id":"tvdb://123"}]`,
		`"Guid":[{"id":"tvdb://123"}],"guid":"plex://show/canonical"`,
	} {
		var response Response
		data := `{"MediaContainer":{"librarySectionID":1,"Metadata":[{"ratingKey":"10","librarySectionID":"1",` + fields + `}]}}`
		if err := json.Unmarshal([]byte(data), &response); err != nil {
			t.Fatal(err)
		}
		if response.Container.SectionID != "1" || response.Container.Metadata[0].SectionID != "1" || response.Container.Metadata[0].GUID != "plex://show/canonical" {
			t.Fatalf("canonical identity lost: %+v", response.Container)
		}
	}
}
