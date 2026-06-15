package realtime

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
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
			"id": "level_complete",
			"chess": map[string]any{
				"tabId":   "game_1",
				"whiteId": "white",
				"blackId": "black",
				"winner":  "w",
				"extra":   "ignored",
			},
			"extra": "ignored",
		},
		"extra": "ignored",
	})
	effect, ok := got["soundEffect"].(map[string]any)
	if !ok {
		t.Fatalf("sanitizeBroadcast() soundEffect = %#v", got["soundEffect"])
	}
	chess, ok := effect["chess"].(map[string]any)
	if !ok {
		t.Fatalf("sanitizeBroadcast() chess context = %#v", effect["chess"])
	}
	if got["type"] != SoundEffectSync || effect["id"] != "level_complete" || len(got) != 2 || len(effect) != 2 {
		t.Fatalf("sanitizeBroadcast() = %#v", got)
	}
	if chess["tabId"] != "game_1" || chess["whiteId"] != "white" || chess["blackId"] != "black" || chess["winner"] != "w" || len(chess) != 4 {
		t.Fatalf("sanitizeBroadcast() chess context = %#v", chess)
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

func TestSanitizeMoveToBroadcast(t *testing.T) {
	got := sanitizeBroadcast(map[string]any{
		"type":   MoveToBroadcast,
		"moveTo": "media_123",
		"extra":  "ignored",
	})
	if got["type"] != MoveToBroadcast || got["moveTo"] != "media_123" || len(got) != 2 {
		t.Fatalf("sanitizeBroadcast() = %#v", got)
	}
}

func TestEmptyRoomSnapshot(t *testing.T) {
	hub := NewHub(Options{})

	created := hub.upsertRoom("room", "", nil)
	if created.RoomID != "room" || created.MediaID != "" {
		t.Fatalf("created empty room = %#v", created)
	}

	snapshot, ok := hub.roomSnapshot("room")
	if !ok {
		t.Fatal("roomSnapshot() returned false for empty room")
	}
	if snapshot.RoomID != "room" || snapshot.MediaID != "" {
		t.Fatalf("empty room snapshot = %#v", snapshot)
	}
}

func TestGenerateRoomIDDefaultLength(t *testing.T) {
	hub := NewHub(Options{})

	roomID, err := hub.generateRoomID()
	if err != nil {
		t.Fatalf("generateRoomID() error = %v", err)
	}
	if len(roomID) != 10 {
		t.Fatalf("generateRoomID() returned length %d, want 10: %q", len(roomID), roomID)
	}
	if !safeID.MatchString(roomID) {
		t.Fatalf("generateRoomID() returned unsafe ID %q", roomID)
	}
}

func TestSanitizeMoveToBroadcastRejectsInvalidID(t *testing.T) {
	got := sanitizeBroadcast(map[string]any{
		"type":   MoveToBroadcast,
		"moveTo": "../bad",
	})
	if got != nil {
		t.Fatalf("sanitizeBroadcast() = %#v, want nil", got)
	}
}

func TestSanitizeDiscordUser(t *testing.T) {
	avatar := "a_123abc"
	globalName := strings.Repeat("Sparkle", 20)
	got := sanitizeDiscordUser(&DiscordUser{
		Username:      "  dan  ",
		Discriminator: "0",
		ID:            "123456789012345678",
		PublicFlags:   1,
		Avatar:        &avatar,
		GlobalName:    &globalName,
	})
	if got == nil {
		t.Fatal("sanitizeDiscordUser() rejected valid user")
	}
	if got.Username != "dan" || got.ID != "123456789012345678" || got.Avatar == nil || *got.Avatar != avatar {
		t.Fatalf("sanitizeDiscordUser() = %#v", got)
	}
	if got.GlobalName == nil || len([]rune(*got.GlobalName)) != 80 {
		t.Fatalf("sanitizeDiscordUser() global name = %#v, want 80 runes", got.GlobalName)
	}
}

func TestSanitizeDiscordUserRejectsUnsafeFields(t *testing.T) {
	avatar := "../bad"
	got := sanitizeDiscordUser(&DiscordUser{
		Username:      "dan",
		Discriminator: "0",
		ID:            "not-a-snowflake",
		Avatar:        &avatar,
	})
	if got != nil {
		t.Fatalf("sanitizeDiscordUser() = %#v, want nil", got)
	}

	got = sanitizeDiscordUser(&DiscordUser{
		Username:      "dan",
		Discriminator: "0",
		ID:            "123456789012345678",
		Avatar:        &avatar,
	})
	if got == nil {
		t.Fatal("sanitizeDiscordUser() rejected valid user with unsafe avatar")
	}
	if got.Avatar != nil {
		t.Fatalf("sanitizeDiscordUser() avatar = %#v, want nil", *got.Avatar)
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

func TestSanitizeChessState(t *testing.T) {
	got, ok := sanitizeChessState(&ChessState{
		Tabs: []ChessTabState{{
			ID:     "game_1",
			Open:   true,
			Phase:  "ended",
			White:  &ChessPlayerState{ID: "white", Name: "Alice"},
			Black:  &ChessPlayerState{ID: "black", Name: "Bob"},
			FEN:    "start",
			Moves:  []ChessMoveState{{From: "e2", To: "e4", SAN: "e4"}},
			Clocks: ChessClockState{WhiteMs: 0, BlackMs: 12000, LastTickAt: 99},
			Settings: ChessSettingsState{
				PieceSet:         "pixel-wood",
				BoardTheme:       "blue",
				Timed:            true,
				Minutes:          5,
				IncrementSeconds: 2,
			},
			Result: &ChessResultState{Winner: "b", Reason: "timeout", Message: "Black wins on time"},
		}},
	}, 1234)
	if !ok {
		t.Fatal("sanitizeChessState() rejected valid state")
	}
	if len(got.Tabs) != 1 {
		t.Fatalf("sanitizeChessState() tab count = %d", len(got.Tabs))
	}
	tab := got.Tabs[0]
	if !tab.Open || tab.Phase != "ended" || tab.White.Name != "Alice" || tab.Black.Name != "Bob" {
		t.Fatalf("sanitizeChessState() tab = %#v", tab)
	}
	if tab.Settings.PieceSet != "pixel-wood" || tab.Settings.BoardTheme != "blue" || tab.Settings.Minutes != 5 || tab.Settings.IncrementSeconds != 2 {
		t.Fatalf("sanitizeChessState() settings = %#v", tab.Settings)
	}
	if tab.Clocks.WhiteMs != 0 || tab.Clocks.BlackMs != 12000 || tab.Clocks.LastTickAt != 99 {
		t.Fatalf("sanitizeChessState() clocks = %#v", tab.Clocks)
	}
	if tab.Result == nil || tab.Result.Winner != "b" || tab.Result.Reason != "timeout" {
		t.Fatalf("sanitizeChessState() result = %#v", tab.Result)
	}
	if tab.UpdatedAt != 1234 || got.UpdatedAt != 1234 {
		t.Fatalf("sanitizeChessState() timestamps = %#v", got)
	}
}

func TestSanitizeChessSettingsDefaultsInvalidPieceSet(t *testing.T) {
	got := sanitizeChessSettings(ChessSettingsState{
		PieceSet:         "dragonfruit",
		BoardTheme:       "green",
		Timed:            true,
		Minutes:          10,
		IncrementSeconds: 5,
	})
	if got.PieceSet != "classic" {
		t.Fatalf("sanitizeChessSettings() piece set = %q, want classic", got.PieceSet)
	}
}

func TestSanitizeCottageState(t *testing.T) {
	targetX := 250.0
	targetY := 999.0
	got, ok := sanitizeCottageState(&CottageState{
		Players: []CottagePlayerState{
			{
				ID:            "player:one",
				Name:          strings.Repeat("A", 90),
				ProfileID:     "../bad",
				X:             12,
				Y:             240,
				TargetX:       &targetX,
				TargetY:       &targetY,
				Action:        "dancing",
				Facing:        "sideways",
				InteractionID: "couch-left",
			},
			{
				ID: "../bad",
				X:  100,
				Y:  200,
			},
		},
	}, 1234)
	if !ok {
		t.Fatal("sanitizeCottageState() rejected valid state")
	}
	if len(got.Players) != 1 {
		t.Fatalf("sanitizeCottageState() player count = %d, want 1", len(got.Players))
	}
	player := got.Players[0]
	if player.ID != "player:one" || len([]rune(player.Name)) != 80 || player.ProfileID != "" {
		t.Fatalf("sanitizeCottageState() identity = %#v", player)
	}
	if player.X != cottageMinX || player.Y != 240 {
		t.Fatalf("sanitizeCottageState() position = (%v,%v), want (%v,240)", player.X, player.Y, cottageMinX)
	}
	if player.TargetX == nil || *player.TargetX != 250 || player.TargetY == nil || *player.TargetY != cottageMaxY {
		t.Fatalf("sanitizeCottageState() target = (%v,%v), want (250,%v)", player.TargetX, player.TargetY, cottageMaxY)
	}
	if player.Action != "idle" || player.Facing != "down" || player.InteractionID != "couch-left" {
		t.Fatalf("sanitizeCottageState() action fields = %#v", player)
	}
	if player.UpdatedAt != 1234 || got.UpdatedAt != 1234 {
		t.Fatalf("sanitizeCottageState() timestamps = %#v", got)
	}
}

func TestSyncCottageMergesDeltaAndBroadcastsToPeers(t *testing.T) {
	room := newRoom("cottage:room", "")
	sender := testPlayer("sender-cottage", "Sender socket", 4)
	receiver := testPlayer("receiver-cottage", "Receiver socket", 4)
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver
	room.cottage = CottageState{
		Players: []CottagePlayerState{{
			ID:        "receiver",
			Name:      "Receiver",
			X:         500,
			Y:         210,
			Action:    "idle",
			Facing:    "down",
			UpdatedAt: 100,
		}},
		UpdatedAt: 100,
	}

	targetX := 300.0
	targetY := 260.0
	room.syncCottage(sender, &CottageState{
		Players: []CottagePlayerState{{
			ID:            "sender",
			Name:          "Sender",
			X:             120,
			Y:             220,
			TargetX:       &targetX,
			TargetY:       &targetY,
			Action:        "walking",
			Facing:        "right",
			InteractionID: "table-east",
			UpdatedAt:     1,
		}},
		UpdatedAt: 1,
	})

	assertNoQueuedPayload(t, sender)
	payload := readQueuedPayload(t, receiver)
	if payload.Type != CottageSync || payload.Cottage == nil || len(payload.Cottage.Players) != 1 {
		t.Fatalf("cottage payload = %#v, want one-player delta", payload)
	}
	if payload.FiredBy == nil || payload.FiredBy.Id != "sender-cottage" {
		t.Fatalf("cottage payload firedBy = %#v, want sender-cottage", payload.FiredBy)
	}
	player := payload.Cottage.Players[0]
	if player.ID != "sender" || player.Action != "walking" || player.Facing != "right" || player.InteractionID != "table-east" {
		t.Fatalf("cottage player delta = %#v", player)
	}
	if len(room.cottage.Players) != 2 {
		t.Fatalf("room cottage player count = %d, want 2", len(room.cottage.Players))
	}

	room.syncCottage(sender, &CottageState{
		Players:   []CottagePlayerState{player},
		UpdatedAt: player.UpdatedAt,
	})
	assertNoQueuedPayload(t, receiver)
}

func TestSyncCottageEmptyUpdateSendsSnapshotToRequester(t *testing.T) {
	room := newRoom("cottage:room", "")
	requester := testPlayer("requester-cottage", "Requester socket", 4)
	other := testPlayer("other-cottage", "Other socket", 4)
	room.players[requester.state.Id] = requester
	room.players[other.state.Id] = other
	room.cottage = CottageState{
		Players: []CottagePlayerState{{
			ID:        "other",
			Name:      "Other",
			X:         700,
			Y:         240,
			Action:    "sitting",
			Facing:    "down",
			UpdatedAt: 200,
		}},
		UpdatedAt: 200,
	}

	room.syncCottage(requester, &CottageState{})

	payload := readQueuedPayload(t, requester)
	if payload.Type != CottageSync || payload.Cottage == nil || len(payload.Cottage.Players) != 1 {
		t.Fatalf("snapshot payload = %#v, want full cottage snapshot", payload)
	}
	if payload.Cottage.Players[0].ID != "other" {
		t.Fatalf("snapshot player = %#v, want other", payload.Cottage.Players[0])
	}
	assertNoQueuedPayload(t, other)
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

func TestSyncTimeBroadcastsOnlyToOtherPlayers(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   VideoState{Time: 10, Paused: false},
		youtube: defaultYouTubeState(),
	}
	sender := testPlayer("sender", "Sender", 1)
	receiver := testPlayer("receiver", "Receiver", 1)
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver

	nextTime := 17.0
	room.syncTime(sender, &nextTime)

	assertNoQueuedPayload(t, sender)
	payload := readQueuedPayload(t, receiver)
	if payload.Type != TimeSync || payload.Time == nil || *payload.Time != nextTime {
		t.Fatalf("receiver time payload = %#v, want time %.1f", payload, nextTime)
	}
	if payload.FiredBy == nil || payload.FiredBy.Id != sender.state.Id {
		t.Fatalf("receiver time payload firedBy = %#v, want sender", payload.FiredBy)
	}
	if sender.state.Time != nextTime || receiver.state.Time != nextTime || room.state.Time != nextTime {
		t.Fatalf(
			"synced times sender=%v receiver=%v room=%v, want %.1f",
			sender.state.Time,
			receiver.state.Time,
			room.state.Time,
			nextTime,
		)
	}
}

func TestSyncPauseBroadcastsOnlyToOtherPlayers(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   VideoState{Time: 10, Paused: false},
		youtube: defaultYouTubeState(),
	}
	sender := testPlayer("sender", "Sender", 1)
	receiver := testPlayer("receiver", "Receiver", 1)
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver

	paused := true
	room.syncPause(sender, &paused)

	assertNoQueuedPayload(t, sender)
	payload := readQueuedPayload(t, receiver)
	if payload.Type != PauseSync || payload.Paused == nil || !*payload.Paused {
		t.Fatalf("receiver pause payload = %#v, want paused true", payload)
	}
	if payload.FiredBy == nil || payload.FiredBy.Id != sender.state.Id {
		t.Fatalf("receiver pause payload firedBy = %#v, want sender", payload.FiredBy)
	}
	if !sender.state.Paused || !receiver.state.Paused || !room.state.Paused {
		t.Fatalf(
			"synced paused states sender=%v receiver=%v room=%v, want true",
			sender.state.Paused,
			receiver.state.Paused,
			room.state.Paused,
		)
	}
}

func TestSetForegroundStateUpdatesPlayerPauseWithoutRoomBroadcast(t *testing.T) {
	room := newRoom("room", "")
	sender := testPlayer("sender", "Sender", 2)
	receiver := testPlayer("receiver", "Receiver", 2)
	sender.state.Paused = false
	receiver.state.Paused = false
	room.state.Paused = false
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver

	paused := true
	room.setForegroundState(sender, "bg", &paused)

	if !sender.state.Paused || !sender.state.InBg {
		t.Fatalf("sender state = %#v, want paused in background", sender.state)
	}
	if receiver.state.Paused {
		t.Fatal("foreground state sync should not update receiver pause state")
	}
	if room.state.Paused {
		t.Fatal("foreground state sync should not update room pause state")
	}
	assertNoQueuedPayload(t, sender)
	assertNoQueuedPayload(t, receiver)

	room.syncPlayerState(time.Unix(100, 0))
	payload := readQueuedPayload(t, receiver)
	if payload.Type != PlayersStatusSync || len(payload.Players) != 2 {
		t.Fatalf("status payload = %#v, want full players", payload)
	}
	var senderStatus *PlayerSnapshot
	for i := range payload.Players {
		if payload.Players[i].Id == sender.state.Id {
			senderStatus = &payload.Players[i]
			break
		}
	}
	if senderStatus == nil || !senderStatus.Paused || !senderStatus.InBg {
		t.Fatalf("broadcast sender status = %#v, want paused in background", senderStatus)
	}
	_ = readQueuedPayload(t, sender)
}

func TestChatBroadcastSendsDeltaOnly(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   defaultVideoState(),
		youtube: defaultYouTubeState(),
	}
	sender := testPlayer("sender", "Sender", 4)
	receiver := testPlayer("receiver", "Receiver", 4)
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver

	room.chat(sender, "hello :wave:", nil)

	for _, player := range []*Player{sender, receiver} {
		payload := readQueuedPayload(t, player)
		if payload.Type != ChatSync {
			t.Fatalf("chat payload type = %q, want %q", payload.Type, ChatSync)
		}
		if payload.Chat == nil || payload.Chat.Message != "hello :wave:" {
			t.Fatalf("chat delta payload = %#v", payload.Chat)
		}
		if payload.Chat.Author == nil || payload.Chat.Author.Name != "Sender" || payload.Chat.Author.Id != "sender" {
			t.Fatalf("chat delta author = %#v, want Sender/sender", payload.Chat.Author)
		}
		if len(payload.Chats) != 0 {
			t.Fatalf("chat delta included %d history messages, want 0", len(payload.Chats))
		}
	}
}

func TestMoveToBroadcastUpdatesRoomMedia(t *testing.T) {
	room := newRoom("room", "old_media")
	sender := testPlayer("sender", "Sender", 4)
	receiver := testPlayer("receiver", "Receiver", 4)
	subscriber := testPlayer(MediaSubscriberPrefix+"subscriber", "", 4)
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver
	room.mediaSubscribers[subscriber.state.Id] = subscriber

	room.broadcast(sender, sanitizeBroadcast(map[string]any{
		"type":   MoveToBroadcast,
		"moveTo": "new_media",
	}))

	if room.mediaID != "new_media" {
		t.Fatalf("room mediaID = %q, want new_media", room.mediaID)
	}
	for _, player := range []*Player{sender, receiver, subscriber} {
		payload := readQueuedPayload(t, player)
		if payload.Type != BroadcastSync || payload.Broadcast["type"] != MoveToBroadcast {
			t.Fatalf("move payload = %#v", payload)
		}
		if payload.Broadcast["moveTo"] != "new_media" {
			t.Fatalf("move payload target = %#v, want new_media", payload.Broadcast["moveTo"])
		}
		if payload.FiredBy == nil || payload.FiredBy.Id != "sender" {
			t.Fatalf("move payload firedBy = %#v, want sender", payload.FiredBy)
		}
	}
}

func TestMoveToBroadcastCanClearRoomMedia(t *testing.T) {
	room := newRoom("room", "old_media")
	sender := testPlayer("sender", "Sender", 4)
	receiver := testPlayer("receiver", "Receiver", 4)
	room.players[sender.state.Id] = sender
	room.players[receiver.state.Id] = receiver

	room.broadcast(sender, sanitizeBroadcast(map[string]any{
		"type":   MoveToBroadcast,
		"moveTo": "",
	}))

	if room.mediaID != "" {
		t.Fatalf("room mediaID = %q, want empty", room.mediaID)
	}
	for _, player := range []*Player{sender, receiver} {
		payload := readQueuedPayload(t, player)
		if payload.Type != BroadcastSync || payload.Broadcast["type"] != MoveToBroadcast {
			t.Fatalf("clear payload = %#v", payload)
		}
		if payload.Broadcast["moveTo"] != "" {
			t.Fatalf("clear payload target = %#v, want empty", payload.Broadcast["moveTo"])
		}
	}
}

func TestExitSyncKicksTargetPlayer(t *testing.T) {
	room := newRoom("room", "")
	sender := testPlayer("sender", "Sender", 1)
	target := testPlayer("target", "Target", 1)
	room.players[sender.state.Id] = sender
	room.players[target.state.Id] = target

	room.handlePayload(sender, ClientPayload{Type: ExitSync, TargetID: "target"})

	payload := readQueuedPayload(t, target)
	if payload.Type != ExitSync {
		t.Fatalf("kick payload type = %q, want %q", payload.Type, ExitSync)
	}
	if len(sender.send) != 0 {
		t.Fatal("kick request should not send exit payload to sender")
	}
}

func TestExitSyncDoesNotKickSelf(t *testing.T) {
	room := newRoom("room", "")
	sender := testPlayer("sender", "Sender", 1)
	room.players[sender.state.Id] = sender

	room.handlePayload(sender, ClientPayload{Type: ExitSync, TargetID: "sender"})

	if len(sender.send) != 0 {
		t.Fatal("self kick should not send exit payload")
	}
}

func TestUpdateMediaIDNotifiesMediaSubscribers(t *testing.T) {
	room := newRoom("room", "")
	subscriber := testPlayer(MediaSubscriberPrefix+"subscriber", "", 4)
	room.mediaSubscribers[subscriber.state.Id] = subscriber

	room.updateMediaID("new_media", nil)

	payload := readQueuedPayload(t, subscriber)
	if payload.Type != BroadcastSync || payload.Broadcast["type"] != MoveToBroadcast {
		t.Fatalf("subscriber payload = %#v", payload)
	}
	if payload.Broadcast["moveTo"] != "new_media" {
		t.Fatalf("subscriber target = %#v, want new_media", payload.Broadcast["moveTo"])
	}
}

func TestNewPlayerReceivesFullChatHistory(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   defaultVideoState(),
		youtube: defaultYouTubeState(),
		chats: []Chat{{
			Message:   "history",
			Timestamp: 123,
			Uid:       "existing",
		}},
	}
	joining := testPlayer("joining", "Joining", 5)
	room.players[joining.state.Id] = joining

	room.newPlayer(joining)

	_ = readQueuedPayload(t, joining)
	_ = readQueuedPayload(t, joining)
	_ = readQueuedPayload(t, joining)
	_ = readQueuedPayload(t, joining)
	chatPayload := readQueuedPayload(t, joining)
	if chatPayload.Type != ChatSync || len(chatPayload.Chats) != 1 {
		t.Fatalf("history chat payload = %#v, want 1 full-history chat", chatPayload)
	}
	if chatPayload.Chat != nil {
		t.Fatalf("history chat payload sent delta %#v, want full history only", chatPayload.Chat)
	}
}

func TestSyncPlayerStateSendsFullDeltaAndHeartbeat(t *testing.T) {
	room := &Room{
		id:      "room",
		players: make(map[string]*Player),
		state:   defaultVideoState(),
		youtube: defaultYouTubeState(),
	}
	alice := testPlayer("alice", "Alice", 8)
	bob := testPlayer("bob", "Bob", 8)
	room.players[alice.state.Id] = alice
	room.players[bob.state.Id] = bob

	firstSync := time.Unix(100, 0)
	room.syncPlayerState(firstSync)

	fullPayload := readQueuedPayload(t, alice)
	if fullPayload.Type != PlayersStatusSync || len(fullPayload.Players) != 2 {
		t.Fatalf("full player payload = %#v, want 2 players", fullPayload)
	}
	if fullPayload.PlayersCount != 2 {
		t.Fatalf("full payload playersCount = %d, want 2", fullPayload.PlayersCount)
	}
	_ = readQueuedPayload(t, bob)

	room.syncPlayerState(firstSync.Add(time.Second))
	assertNoQueuedPayload(t, alice)
	assertNoQueuedPayload(t, bob)

	alice.state.Time = 42
	alice.state.LastSeen = firstSync.Add(2 * time.Second).Unix()
	room.syncPlayerState(firstSync.Add(2 * time.Second))

	statusPayload := readQueuedPayload(t, alice)
	if statusPayload.Type != PlayerStatusSync || len(statusPayload.PlayerStatuses) != 2 {
		t.Fatalf("status payload = %#v, want 2 player statuses", statusPayload)
	}
	if len(statusPayload.Players) != 0 {
		t.Fatalf("status payload included %d full players, want 0", len(statusPayload.Players))
	}
	_ = readQueuedPayload(t, bob)

	room.syncPlayerState(firstSync.Add(5 * time.Second))
	heartbeatPayload := readQueuedPayload(t, alice)
	if heartbeatPayload.Type != HeartbeatSync || heartbeatPayload.PlayersCount != 2 {
		t.Fatalf("heartbeat payload = %#v, want playersCount 2", heartbeatPayload)
	}
	if len(heartbeatPayload.Players) != 0 || len(heartbeatPayload.PlayerStatuses) != 0 {
		t.Fatalf("heartbeat included player state: %#v", heartbeatPayload)
	}
	_ = readQueuedPayload(t, bob)
}

func testPlayer(id string, name string, sendBuffer int) *Player {
	return &Player{
		send: make(chan []byte, sendBuffer),
		state: PlayerSnapshot{
			VideoState:  defaultVideoState(),
			PlayerState: PlayerState{Id: id, Name: name, LastSeen: time.Now().Unix()},
		},
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

func assertNoQueuedPayload(t *testing.T, player *Player) {
	t.Helper()

	select {
	case raw := <-player.send:
		t.Fatalf("unexpected queued payload: %s", string(raw))
	default:
	}
}
