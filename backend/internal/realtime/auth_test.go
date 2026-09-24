package realtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAccountProfileOverridesRoomEdits(t *testing.T) {
	r := newRoom("profiles", "encoded")
	p := newPlayer(nil, "participant")
	p.accountProfile = func() (string, string, bool) { return "plex-verified", "Plex member", true }
	r.players[p.state.Id] = p
	r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: "Forged name", ProfileId: "custom-avatar", DiscordUser: &DiscordUser{ID: "123", Username: "fake"}})
	if p.state.Name != "Plex member" || p.state.ProfileId != "plex-verified" || p.state.DiscordUser != nil {
		t.Fatal("client overrode Plex account identity")
	}
	p.accountProfile = nil
	r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: "Guest name", ProfileId: "plex-verified"})
	if p.state.Name != "Guest name" || p.state.ProfileId != "participant" {
		t.Fatal("guest impersonated Plex avatar")
	}
	r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: "Custom guest", ProfileId: "custom-avatar"})
	if p.state.Name != "Custom guest" || p.state.ProfileId != "custom-avatar" {
		t.Fatal("guest customization lost")
	}
	if isValidSocketPlayerID("plex-verified") || isValidSocketPlayerID("media_plex-verified") {
		t.Fatal("Plex avatar namespace available as guest ID")
	}
	for _, signedIn := range []bool{false, true} {
		h := NewHub(Options{AccountProfile: func(context.Context) (string, string, bool) { return "plex-verified", "Member", signedIn }})
		defer h.Close()
		for _, id := range []string{"plex-verified", "custom-avatar"} {
			w := httptest.NewRecorder()
			req := httptest.NewRequest("POST", "/pfp/"+id, nil)
			req.SetPathValue("id", id)
			h.HandlePFP(w, req)
			if (signedIn || strings.HasPrefix(id, "plex-")) && w.Code != 403 {
				t.Fatal("Plex avatar upload allowed")
			}
		}
	}
}

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
