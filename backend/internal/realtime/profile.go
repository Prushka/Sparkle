package realtime

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

func (h *Hub) HandleProfileLimits(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"maxPfpBytes":       h.maxUploadBytes,
		"maxUsernameLength": h.maxUsernameLength,
	})
}

func (h *Hub) avatarSizeError() string {
	return fmt.Sprintf("Avatar file is too large. Maximum size is %d bytes.", h.maxUploadBytes)
}

func (r *Room) updateProfile(player *Player, payload ClientPayload, now time.Time) {
	name := strings.TrimSpace(payload.Name)
	profileID := strings.TrimSpace(payload.ProfileId)
	discordUser := sanitizeDiscordUser(payload.DiscordUser)
	if !safeID.MatchString(profileID) || strings.HasPrefix(profileID, "plex-") {
		profileID = player.state.Id
	}
	account := false
	if player.accountProfile != nil {
		if id, accountName, ok := player.accountProfile(); ok {
			profileID, name, discordUser, account = id, trimRunes(accountName, 80), nil, true
		}
	}
	if !account && discordUser == nil && utf8.RuneCountInString(name) > r.maxUsernameLength {
		player.sendJSON(SendPayload{Type: ProfileError, Error: fmt.Sprintf("Username must be %d characters or fewer.", r.maxUsernameLength)})
		return
	}
	if discordUser != nil {
		name = trimRunes(name, 80)
	}
	r.mu.Lock()
	if r.players[player.state.Id] != player && r.mediaSubscribers[player.state.Id] != player {
		r.mu.Unlock()
		return
	}
	changed := player.state.Name != name || player.state.ProfileId != profileID
	player.state.Name, player.state.ProfileId, player.state.DiscordUser = name, profileID, discordUser
	player.state.LastSeen = now.Unix()
	snapshot := player.state
	r.mu.Unlock()
	if changed {
		r.logPlayerEvent(snapshot, "profile updated", ProfileSync, "")
	}
}
