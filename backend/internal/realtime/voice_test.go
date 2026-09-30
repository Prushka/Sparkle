package realtime

import (
	"strings"
	"testing"
)

func TestVoiceRejectsUntargetedAndMalformedNegotiation(t *testing.T) {
	for _, signal := range []map[string]any{
		{"kind": "offer", "sessionId": "session", "description": map[string]any{"type": "offer", "sdp": "v=0"}},
		{"kind": "ice", "sessionId": "session", "candidate": "invalid"},
		{"kind": "unknown", "sessionId": "session"},
	} {
		if got := sanitizeBroadcast(map[string]any{"type": "voiceSignal", "signal": signal}); got != nil {
			t.Errorf("accepted invalid voice signal: %#v", got)
		}
	}
}

func TestVoiceNegotiationStaysPrivateAndDoesNotChangePlayback(t *testing.T) {
	room := newRoom("voice", "fixture")
	sender, target, bystander := testPlayer("sender", "Sender", 8), testPlayer("target", "Target", 8), testPlayer("bystander", "Bystander", 8)
	for _, player := range []*Player{sender, target, bystander} {
		room.players[player.state.Id] = player
	}
	room.state = VideoState{Time: 42, Paused: true}
	room.handlePayload(sender, ClientPayload{Type: BroadcastSync, Broadcast: map[string]any{
		"type": "voiceSignal", "targetId": " target ", "injected": "drop",
		"signal": map[string]any{"kind": "offer", "sessionId": "sender-session", "targetSessionId": "target-session", "description": map[string]any{"type": "offer", "sdp": "v=0\r\n"}},
	}})
	got := readQueuedPayload(t, target)
	if got.FiredBy == nil || got.FiredBy.Id != "sender" || got.Broadcast["targetId"] != "target" {
		t.Fatalf("incorrect routing: %#v", got)
	}
	if _, exists := got.Broadcast["injected"]; exists {
		t.Fatal("unrecognized data forwarded")
	}
	if len(sender.send) != 0 || len(bystander.send) != 0 {
		t.Fatal("private voice negotiation broadcast to room")
	}
	if room.state.Time != 42 || !room.state.Paused {
		t.Fatal("voice changed room timeline")
	}
	outsider := testPlayer("outsider", "", 8)
	room.handlePayload(outsider, ClientPayload{Type: BroadcastSync, Broadcast: map[string]any{"type": "voiceSignal", "signal": map[string]any{"kind": "hello", "sessionId": "session", "muted": true}}})
	if len(target.send) != 0 {
		t.Fatal("nonmember signaled room")
	}
}

func TestVoiceCandidateValidationAndLimits(t *testing.T) {
	for _, candidate := range []map[string]any{
		{"candidate": "candidate:example", "sdpMid": "0", "sdpMLineIndex": float64(0), "usernameFragment": "abcd"},
		{"candidate": ""},
	} {
		raw := map[string]any{"type": "voiceSignal", "targetId": "target", "signal": map[string]any{"kind": "ice", "sessionId": "session", "candidate": candidate}}
		if sanitizeBroadcast(raw) == nil {
			t.Fatalf("valid candidate rejected: %#v", candidate)
		}
	}
	for _, candidate := range []map[string]any{
		{"candidate": strings.Repeat("a", 4097), "sdpMid": "0"},
		{"candidate": "candidate:example"},
		{"candidate": "candidate:example", "sdpMLineIndex": -1.0},
		{"candidate": "candidate:example", "sdpMLineIndex": 0.5},
		{"candidate": "candidate:example", "sdpMid": true},
	} {
		raw := map[string]any{"type": "voiceSignal", "targetId": "target", "signal": map[string]any{"kind": "ice", "sessionId": "session", "candidate": candidate}}
		if sanitizeBroadcast(raw) != nil {
			t.Fatalf("invalid candidate accepted: %#v", candidate)
		}
	}
}
