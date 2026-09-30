package realtime

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type VoiceICE struct {
	urls   []string
	secret string
}
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// Accept browser TURN URIs, never URLs carrying embedded credentials or paths.
var turnURI = regexp.MustCompile(`^turns?:([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?(\?transport=(udp|tcp))?$`)

func NewVoiceICE(urls, secret string) (*VoiceICE, error) {
	if strings.TrimSpace(urls) == "" && secret == "" {
		return nil, nil
	}
	if strings.TrimSpace(urls) == "" || len(strings.TrimSpace(secret)) < 32 {
		return nil, fmt.Errorf("VOICE_TURN_URLS and a VOICE_TURN_SECRET of at least 32 characters are required together")
	}
	items := strings.Split(urls, ",")
	if len(items) > 8 {
		return nil, fmt.Errorf("VOICE_TURN_URLS supports at most eight URLs")
	}
	for i, url := range items {
		items[i] = strings.TrimSpace(url)
		matches := turnURI.FindStringSubmatch(items[i])
		if matches == nil {
			return nil, fmt.Errorf("VOICE_TURN_URLS contains an invalid TURN URI")
		}
		if matches[2] != "" {
			port, _ := strconv.Atoi(matches[2][1:])
			if port < 1 || port > 65535 {
				return nil, fmt.Errorf("VOICE_TURN_URLS contains an invalid port")
			}
		}
	}
	return &VoiceICE{urls: items, secret: secret}, nil
}

func (v *VoiceICE) servers(id string, now time.Time) []ICEServer {
	// coturn REST credentials: the long-lived shared secret never leaves Go.
	username := strconv.FormatInt(now.Add(time.Hour).Unix(), 10) + ":" + id
	mac := hmac.New(sha1.New, []byte(v.secret))
	_, _ = mac.Write([]byte(username))
	return []ICEServer{
		{URLs: []string{"stun:stun.l.google.com:19302"}},
		{URLs: v.urls, Username: username, Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil))},
	}
}

func (h *Hub) sendVoiceConfig(player *Player, roomID string) {
	if h.voiceICE == nil || player.isMediaSubscriber() || strings.Contains(roomID, ":") {
		return
	}
	now := time.Now()
	if now.Sub(player.lastVoiceConfig) < time.Minute {
		return
	}
	player.lastVoiceConfig = now
	player.sendJSON(struct {
		Type       string      `json:"type"`
		ICEServers []ICEServer `json:"iceServers"`
	}{Type: "voiceConfig", ICEServers: h.voiceICE.servers(player.state.Id, now)})
}
