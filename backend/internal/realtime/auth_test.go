package realtime

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAnonymousUpdateCannotRacePastRawRoomAuthorization(t *testing.T) {
	checking, release := make(chan struct{}), make(chan struct{})
	h := NewHub(Options{AuthorizeMedia: func(w http.ResponseWriter, r *http.Request, id string) bool {
		if r.Header.Get("X-Test-Member") == "yes" {
			return true
		}
		if id == "encoded" {
			close(checking)
			<-release
		}
		if strings.HasPrefix(id, "plex-") {
			w.WriteHeader(401)
			return false
		}
		return true
	}})
	defer h.Close()
	h.upsertRoom("race", "encoded", nil)
	update := func(media string, member bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("PUT", "/rooms/race", strings.NewReader(`{"mediaId":"`+media+`"}`))
		r.SetPathValue("room", "race")
		if member {
			r.Header.Set("X-Test-Member", "yes")
		}
		w := httptest.NewRecorder()
		h.HandleUpdateRoom(w, r)
		return w
	}
	guestDone := make(chan *httptest.ResponseRecorder, 1)
	go func() { guestDone <- update("", false) }()
	<-checking
	memberDone := make(chan *httptest.ResponseRecorder, 1)
	go func() { memberDone <- update("plex-server-item-version", true) }()
	select {
	case <-memberDone:
		close(release)
		<-guestDone
		t.Fatal("Raw room switch bypassed an in-flight authorization decision")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if (<-guestDone).Code != 200 || (<-memberDone).Code != 200 {
		t.Fatal("ordered updates failed")
	}
	if w := update("", false); w.Code != 401 {
		t.Fatal("guest cleared the private room", w.Code)
	}
	room, _ := h.roomSnapshot("race")
	if room.MediaID != "plex-server-item-version" {
		t.Fatal("unauthorized update overwrote Raw media")
	}
}
