package realtime

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

func TestSocketLogsIncludeIdentityMediaAndRole(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	h := NewHub(Options{MediaTitle: func(id string) string {
		if id == "movie" {
			return "A Movie"
		}
		if id == "episode" {
			return "A Show - S01E02 - Next"
		}
		return ""
	}})
	h.upsertRoom("room", "movie", nil)
	p := newPlayer(nil, "viewer")
	p.state.Name, p.state.ProfileId = "Plex member", "plex-verified"
	h.addPlayerToRoom("room", p)
	for _, role := range []string{"playback", "media watcher", "youtube", "chess", "wordle", "cottage"} {
		output.Reset()
		roomID, player := "room", p.state
		if role == "media watcher" {
			player.Id = "media_watcher"
		} else if role != "playback" {
			roomID, player.Id = role+":room", "viewer-"+role
		}
		h.logRoomEvent(roomID, player, "connected", "connection", "")
		for _, fragment := range []string{`user="Plex member"`, `identity=plex`, `media="A Movie"`, `room="room"`, `sync="` + role + `"`, `event="connected"`} {
			if !strings.Contains(output.String(), fragment) {
				t.Fatalf("missing %s: %s", fragment, output.String())
			}
		}
	}
	h.upsertRoom("room", "episode", nil)
	output.Reset()
	player := p.state
	player.Name = "line\nbreak"
	h.logRoomEvent("room", player, "disconnected", "connection", "")
	if !strings.Contains(output.String(), `media="A Show - S01E02 - Next"`) || !strings.Contains(output.String(), `user="line\nbreak"`) || strings.Count(output.String(), "\n") != 1 {
		t.Fatalf("stale title or log injection: %s", output.String())
	}
}

func TestPlaybackLogsOnlyAcceptedMeaningfulEvents(t *testing.T) {
	r := newRoom("room", "movie")
	p := newPlayer(nil, "viewer")
	r.players[p.state.Id] = p
	var events []string
	r.logEvent = func(_ PlayerSnapshot, event, syncType, _ string) { events = append(events, syncType+":"+event) }
	position, paused := 1.0, true
	r.syncTime(p, &position)
	r.syncPause(p, &paused)
	if len(events) != 0 {
		t.Fatal("periodic/duplicate updates were logged")
	}
	position = 30
	r.syncTime(p, &position)
	paused = false
	r.syncPause(p, &paused)
	r.syncPause(p, &paused)
	position = 100
	r.syncTime(p, &position, ClientPayload{MediaID: "old-title", MediaUpdated: r.mediaUpdatedAt})
	if strings.Join(events, ",") != "time:seek,pause:play" {
		t.Fatalf("events = %v", events)
	}
	// Voice payloads must never appear in the event log.
	r.handlePayload(p, ClientPayload{Type: BroadcastSync, Broadcast: map[string]any{"type": "voiceSignal", "targetId": "other", "signal": map[string]any{"secret": "private SDP"}}})
	if len(events) != 2 {
		t.Fatal("voice signaling was logged")
	}
}
