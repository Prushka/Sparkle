package realtime

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestTabConnectionsSendOnlyRelevantInitialState(t *testing.T) {
	for _, kind := range []string{YouTubeSync, ChessSync, WordleSync, CottageSync} {
		t.Run(kind, func(t *testing.T) {
			room := newRoom(kind+":room", "")
			player := testPlayer("viewer-"+kind, "Viewer", 32)
			room.players[player.state.Id] = player
			room.newPlayer(player, false)
			if message := readQueuedPayload(t, player); message.Type != kind {
				t.Fatalf("initial message = %q, want %q", message.Type, kind)
			}
			assertNoQueuedPayload(t, player)
			for second := range 60 {
				room.syncPlayerState(time.Now().Add(time.Duration(second) * time.Second))
			}
			assertNoQueuedPayload(t, player)
			if !room.state.Paused {
				t.Fatal("tab subscription started playback")
			}
		})
	}
}

func TestOpeningSocketCanSupplyCurrentRoomWithoutHTTPRead(t *testing.T) {
	h := NewHub(Options{})
	h.upsertRoom("network-room", "movie", nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sync/{room}/{id}", h.HandleWebSocket)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	t.Cleanup(h.Close)
	for _, id := range []string{"viewer", "media_observer"} {
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/sync/network-room/"+id+"?roomSnapshot=1", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var payload SendPayload
		if err := conn.ReadJSON(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Type != RoomSync || payload.MediaID != "movie" || payload.MediaUpdated == 0 || payload.Time != nil || payload.Paused != nil {
			t.Fatalf("room snapshot changed playback or omitted media: %#v", payload)
		}
	}
}

func TestStatusDeltaPreservesUnchangedPlayersAndPresenceChanges(t *testing.T) {
	room := newRoom("room", "movie")
	alice, bob := testPlayer("alice", "Alice", 32), testPlayer("bob", "Bob", 32)
	room.players["alice"], room.players["bob"] = alice, bob
	now := time.Now()
	room.syncPlayerState(now)
	readQueuedPayload(t, alice)
	readQueuedPayload(t, bob)
	bob.state.InBg = true
	room.syncPlayerState(now.Add(time.Second))
	delta := readQueuedPayload(t, alice)
	readQueuedPayload(t, bob)
	if delta.Type != PlayerStatusSync || len(delta.PlayerStatuses) != 1 || delta.PlayerStatuses[0].Id != "bob" || !delta.PlayerStatuses[0].InBg || delta.PlayersCount != 2 {
		t.Fatalf("invalid background delta: %#v", delta)
	}
	delete(room.players, "bob")
	room.syncPlayerState(now.Add(2 * time.Second))
	full := readQueuedPayload(t, alice)
	if full.Type != PlayersStatusSync || len(full.Players) != 1 || full.Players[0].Id != "alice" {
		t.Fatalf("departure did not send complete roster: %#v", full)
	}
}
