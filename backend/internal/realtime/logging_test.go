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

func TestTabLogsPreserveVerifiedAccount(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	for _, role := range []string{YouTubeSync, ChessSync, WordleSync, CottageSync} {
		for _, tc := range []struct {
			name, parentProfile, tabProfile, tabName, wantName, wantIdentity string
			discord                                                          bool
		}{
			{"anonymous", "plex-alice", "", "", "Guest", "guest", false},
			{"different account", "plex-alice", "plex-bob", "Bob", "Bob", "plex", false},
			{"same account keeps session name", "plex-alice", "plex-alice", "Alice", "Alice", "plex", false},
			{"guest cannot replace account", "guest-avatar", "plex-bob", "Bob", "Bob", "plex", false},
			{"guest inheritance", "guest-avatar", "", "", "Main name", "guest", false},
			{"Discord inheritance", "guest-avatar", "", "", "Discord guest", "discord", true},
		} {
			t.Run(role+"/"+tc.name, func(t *testing.T) {
				h := NewHub(Options{MediaTitle: func(string) string { return "A Movie" }})
				h.upsertRoom("room", "movie", nil)
				parent := newPlayer(nil, "viewer")
				parent.state.Name, parent.state.ProfileId = "Main name", tc.parentProfile
				if tc.discord {
					parent.state.DiscordUser = &DiscordUser{ID: "123", Username: "Discord guest"}
				}
				h.addPlayerToRoom("room", parent)
				child := newPlayer(nil, "viewer-"+role)
				child.state.Name, child.state.ProfileId = tc.tabName, tc.tabProfile
				output.Reset()
				// Test logging independently of the profile copied on connection.
				h.logRoomEvent(role+":room", child.state, "connected", "connection", "")
				for _, fragment := range []string{`user="` + tc.wantName + `"`, "identity=" + tc.wantIdentity, `media="A Movie"`, `media_id="movie"`, `sync="` + role + `"`} {
					if !strings.Contains(output.String(), fragment) {
						t.Fatalf("missing %s: %s", fragment, output.String())
					}
				}
			})
		}
	}
}

func TestMediaWatcherLogKeepsVerifiedSessionName(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	h := NewHub(Options{})
	parent := newPlayer(nil, "viewer")
	parent.state.Name, parent.state.ProfileId = "Old name", "plex-alice"
	h.addPlayerToRoom("room", parent)
	watcher := newPlayer(nil, "media_watcher")
	watcher.state.Name, watcher.state.ProfileId = "Current name", "plex-alice"
	h.logRoomEvent("room", watcher.state, "connected", "connection", "")
	if !strings.Contains(output.String(), `user="Current name" identity=plex`) {
		t.Fatalf("watcher lost its session identity: %s", output.String())
	}
}
