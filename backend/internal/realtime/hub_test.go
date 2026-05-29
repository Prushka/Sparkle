package realtime

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestExtractEmojiIDs(t *testing.T) {
	got := extractEmojiIDs("hello :pepe_smile: :pepe_smile: :chika-pls: :bad token:")
	want := []string{"pepe_smile", "chika-pls"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("extractEmojiIDs() = %#v, want %#v", got, want)
	}
}

func TestExtractEmojiIDsLimit(t *testing.T) {
	var message strings.Builder
	for i := 0; i < maxChatEmojis+5; i++ {
		_, _ = fmt.Fprintf(&message, " :emoji_%d:", i)
	}
	got := extractEmojiIDs(message.String())
	if len(got) != maxChatEmojis {
		t.Fatalf("extractEmojiIDs() returned %d IDs, want %d", len(got), maxChatEmojis)
	}
}

func TestSanitizeEmojiRefs(t *testing.T) {
	got := sanitizeEmojiRefs("look :tenor_123:", []ChatEmojiRef{
		{
			ID:       "tenor_123",
			Label:    "Reaction",
			Src:      "https://media.tenor.com/example/tenor.gif",
			Source:   "Tenor",
			Animated: true,
			Kind:     "sticker",
		},
		{
			ID:       "tenor_unused",
			Label:    "Unused",
			Src:      "https://media.tenor.com/example/unused.gif",
			Source:   "Tenor",
			Animated: true,
			Kind:     "sticker",
		},
		{
			ID:       "tenor_bad",
			Label:    "Bad",
			Src:      "https://example.com/bad.gif",
			Source:   "Tenor",
			Animated: true,
			Kind:     "sticker",
		},
	})
	if len(got) != 1 {
		t.Fatalf("sanitizeEmojiRefs() returned %d refs, want 1", len(got))
	}
	if got[0].ID != "tenor_123" || got[0].Src != "https://media.tenor.com/example/tenor.gif" {
		t.Fatalf("sanitizeEmojiRefs() = %#v", got[0])
	}
}

func TestSanitizeSoundEffectBroadcast(t *testing.T) {
	got := sanitizeBroadcast(map[string]any{
		"type": SoundEffectSync,
		"soundEffect": map[string]any{
			"id":    "level_complete",
			"extra": "ignored",
		},
		"extra": "ignored",
	})
	effect, ok := got["soundEffect"].(map[string]any)
	if !ok {
		t.Fatalf("sanitizeBroadcast() soundEffect = %#v", got["soundEffect"])
	}
	if got["type"] != SoundEffectSync || effect["id"] != "level_complete" || len(got) != 2 {
		t.Fatalf("sanitizeBroadcast() = %#v", got)
	}
}

func TestSanitizeSoundEffectBroadcastRejectsInvalidID(t *testing.T) {
	got := sanitizeBroadcast(map[string]any{
		"type": SoundEffectSync,
		"soundEffect": map[string]any{
			"id": "../bad",
		},
	})
	if got != nil {
		t.Fatalf("sanitizeBroadcast() = %#v, want nil", got)
	}
}

func TestSanitizeYouTubeState(t *testing.T) {
	got, ok := sanitizeYouTubeState(&YouTubeState{
		Tabs: []YouTubeTabState{{
			ID:           "tab_1",
			Open:         true,
			URL:          "https://evil.example/watch?v=dQw4w9WgXcQ",
			VideoID:      "dQw4w9WgXcQ",
			Time:         42.5,
			Paused:       false,
			PlaybackRate: 1.25,
		}},
	}, 1234)
	if !ok {
		t.Fatal("sanitizeYouTubeState() rejected valid state")
	}
	if len(got.Tabs) != 1 {
		t.Fatalf("sanitizeYouTubeState() tab count = %d", len(got.Tabs))
	}
	tab := got.Tabs[0]
	if !tab.Open || tab.URL != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" || tab.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("sanitizeYouTubeState() = %#v", got)
	}
	if tab.Time != 42.5 || tab.Paused || tab.PlaybackRate != 1.25 || tab.UpdatedAt != 1234 || got.UpdatedAt != 1234 {
		t.Fatalf("sanitizeYouTubeState() playback fields = %#v", got)
	}
}

func TestSanitizeYouTubeStateRejectsInvalidVideoID(t *testing.T) {
	_, ok := sanitizeYouTubeState(&YouTubeState{
		Tabs: []YouTubeTabState{{
			ID:      "tab_1",
			Open:    true,
			VideoID: "../bad",
		}},
	}, 1234)
	if ok {
		t.Fatal("sanitizeYouTubeState() accepted invalid video id")
	}
}

func TestNewSoloPlayerStartsPlayback(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   VideoState{Time: 42, Paused: true},
		youtube: defaultYouTubeState(),
	}
	player := &Player{
		send: make(chan []byte, 4),
		state: PlayerSnapshot{
			VideoState:  defaultVideoState(),
			PlayerState: PlayerState{Id: "joining"},
		},
	}
	room.players[player.state.Id] = player

	room.newPlayer(player)

	if room.state.Paused {
		t.Fatal("solo join left room paused, want resumed")
	}
	if player.state.Time != 42 || player.state.Paused {
		t.Fatalf("joining player state = %#v, want time 42 and paused false", player.state.VideoState)
	}

	timePayload := readQueuedPayload(t, player)
	if timePayload.Type != TimeSync || timePayload.Time == nil || *timePayload.Time != 42 {
		t.Fatalf("time sync payload = %#v, want time 42", timePayload)
	}

	pausePayload := readQueuedPayload(t, player)
	if pausePayload.Type != PauseSync || pausePayload.Paused == nil || *pausePayload.Paused {
		t.Fatalf("pause sync payload = %#v, want paused false", pausePayload)
	}
}

func TestNewPlayerAdoptsExistingRoomPause(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   VideoState{Time: 42, Paused: true},
		youtube: defaultYouTubeState(),
	}
	existing := &Player{
		send: make(chan []byte, 4),
		state: PlayerSnapshot{
			VideoState:  VideoState{Time: 42, Paused: true},
			PlayerState: PlayerState{Id: "existing"},
		},
	}
	joining := &Player{
		send: make(chan []byte, 4),
		state: PlayerSnapshot{
			VideoState:  defaultVideoState(),
			PlayerState: PlayerState{Id: "joining"},
		},
	}
	room.players[existing.state.Id] = existing
	room.players[joining.state.Id] = joining

	room.newPlayer(joining)

	if !room.state.Paused {
		t.Fatal("non-solo join resumed paused room")
	}
	if joining.state.Time != 42 || !joining.state.Paused {
		t.Fatalf("joining player state = %#v, want time 42 and paused true", joining.state.VideoState)
	}

	_ = readQueuedPayload(t, joining)
	pausePayload := readQueuedPayload(t, joining)
	if pausePayload.Type != PauseSync || pausePayload.Paused == nil || !*pausePayload.Paused {
		t.Fatalf("pause sync payload = %#v, want paused true", pausePayload)
	}
	if len(existing.send) != 0 {
		t.Fatal("new player snapshot should not send playback commands to existing player")
	}
}

func readQueuedPayload(t *testing.T, player *Player) SendPayload {
	t.Helper()

	select {
	case raw := <-player.send:
		var payload SendPayload
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("unmarshal queued payload: %v", err)
		}
		return payload
	default:
		t.Fatal("expected queued payload")
		return SendPayload{}
	}
}
