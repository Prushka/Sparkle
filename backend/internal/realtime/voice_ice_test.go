package realtime

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestVoiceICEConfigValidation(t *testing.T) {
	secret := strings.Repeat("s", 32)
	if cfg, err := NewVoiceICE("", ""); err != nil || cfg != nil {
		t.Fatal("TURN must default off")
	}
	for _, url := range []string{"turn:relay.example:3478?transport=udp", "turns:relay.example:5349?transport=tcp", "turn:[::1]:3478"} {
		if _, err := NewVoiceICE(url, secret); err != nil {
			t.Fatal(err)
		}
	}
	for _, url := range []string{"", "https://relay.example", "turn:user:password@relay.example", "turn:relay.example/path", "turn:relay.example?transport=invalid", "turn:relay.example:99999"} {
		if _, err := NewVoiceICE(url, secret); err == nil {
			t.Fatalf("invalid TURN URL accepted: %s", url)
		}
	}
	if _, err := NewVoiceICE("turn:relay.example", "short"); err == nil {
		t.Fatal("short secret accepted")
	}
}

func TestVoiceICETemporaryCredentialsAndPrivateDelivery(t *testing.T) {
	secret := strings.Repeat("s", 32)
	cfg, err := NewVoiceICE("turn:relay.example:3478", secret)
	if err != nil {
		t.Fatal(err)
	}
	servers := cfg.servers("participant", time.Unix(1000, 0))
	if servers[1].Username != "4600:participant" {
		t.Fatal("credential expiry is not one hour")
	}
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte("4600:participant"))
	if servers[1].Credential != base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
		t.Fatal("coturn credential does not match")
	}
	h := NewHub(Options{VoiceICE: cfg})
	defer h.Close()
	p := testPlayer("participant", "", 4)
	h.sendVoiceConfig(p, "room")
	raw := <-p.send
	if strings.Contains(string(raw), secret) {
		t.Fatal("shared TURN secret leaked")
	}
	var message struct {
		Type       string
		ICEServers []ICEServer
	}
	if json.Unmarshal(raw, &message) != nil || message.Type != "voiceConfig" || len(message.ICEServers) != 2 {
		t.Fatal("missing ICE config")
	}
	h.sendVoiceConfig(p, "room")
	if len(p.send) != 0 {
		t.Fatal("unbounded credential minting")
	}
	p.lastVoiceConfig = time.Now().Add(-31 * time.Minute)
	h.sendVoiceConfig(p, "room")
	if len(p.send) != 1 {
		t.Fatal("credential renewal failed")
	}
	for _, tc := range []struct{ id, room string }{{"media_viewer", "room"}, {"game", "youtube:room"}} {
		p := testPlayer(tc.id, "", 4)
		h.sendVoiceConfig(p, tc.room)
		if len(p.send) != 0 {
			t.Fatal("ICE config sent to non-voice socket")
		}
	}
}
