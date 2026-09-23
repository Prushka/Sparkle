package realtime

import "testing"

func TestPlaybackRejectsPreviousMediaGeneration(t *testing.T) {
	room := newRoom("party", "plex-abcdef012345-7-1")
	player := &Player{}
	player.state.Id = "viewer"
	room.players["viewer"] = player
	position := 42.0
	paused := false
	for _, identity := range []ClientPayload{{}, {MediaID: room.mediaID, MediaUpdated: room.mediaUpdatedAt - 1}, {MediaID: "previous", MediaUpdated: room.mediaUpdatedAt}} {
		room.syncTime(player, &position, identity)
		room.syncPause(player, &paused, identity)
		if room.state.Time != 0 || !room.state.Paused {
			t.Fatal("stale playback changed room state")
		}
	}
	current := ClientPayload{MediaID: room.mediaID, MediaUpdated: room.mediaUpdatedAt}
	room.syncTime(player, &position, current)
	room.syncPause(player, &paused, current)
	if room.state.Time != 42 || room.state.Paused {
		t.Fatal("current generation rejected")
	}
}
