package realtime

import (
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
