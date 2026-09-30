package realtime

import (
	"log"
	"strings"
)

func socketRole(roomID, playerID string) (baseRoom, role string) {
	for _, kind := range []string{YouTubeSync, ChessSync, WordleSync, CottageSync} {
		if strings.HasPrefix(roomID, kind+":") {
			return strings.TrimPrefix(roomID, kind+":"), kind
		}
	}
	if strings.HasPrefix(playerID, MediaSubscriberPrefix) {
		return roomID, "media watcher"
	}
	return roomID, PlaybackSync
}

func (h *Hub) newRoom(id, mediaID string) *Room {
	r := newRoom(id, mediaID)
	r.maxUsernameLength = h.maxUsernameLength
	r.logEvent = func(player PlayerSnapshot, event, syncType, detail string) {
		h.logRoomEvent(id, player, event, syncType, detail)
	}
	return r
}

func (r *Room) logPlayerEvent(player PlayerSnapshot, event, syncType, detail string) {
	if r.logEvent != nil {
		r.logEvent(player, event, syncType, detail)
	}
}

func (r *Room) playerSnapshot(player *Player) PlayerSnapshot {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return player.state
}

func (h *Hub) logRoomEvent(roomID string, player PlayerSnapshot, event, syncType, detail string) {
	baseRoom, role := socketRole(roomID, player.Id)
	h.mu.RLock()
	room := h.rooms[baseRoom]
	h.mu.RUnlock()
	mediaID := ""
	if room != nil {
		room.mu.RLock()
		mediaID = room.mediaID
		if baseRoom != roomID {
			// Tab sockets share their participant's identity with the main room.
			if parent := room.players[strings.TrimSuffix(player.Id, "-"+role)]; parent != nil {
				id := player.Id
				player = parent.state
				player.Id = id
			}
		} else if role == "media watcher" && player.ProfileId != "" {
			for _, parent := range room.players {
				if parent.state.ProfileId == player.ProfileId {
					id := player.Id
					player = parent.state
					player.Id = id
					break
				}
			}
		}
		room.mu.RUnlock()
	}
	title := "No media"
	if mediaID != "" {
		title = "Title unavailable"
		if h.mediaTitle != nil {
			if resolved := h.mediaTitle(mediaID); resolved != "" {
				title = resolved
			}
		}
	}
	name := displayNameFromSnapshot(player)
	if name == "Unknown" {
		name = "Guest"
	}
	identity := "guest"
	if strings.HasPrefix(player.ProfileId, "plex-") {
		identity = "plex"
	} else if player.DiscordUser != nil {
		identity = "discord"
	}
	// Quote and bound user-controlled text so one event stays on one log line.
	log.Printf("room=%q user=%q identity=%s media=%q media_id=%q sync=%q event=%q type=%q player=%q detail=%q",
		trimRunes(baseRoom, 128), trimRunes(name, 80), identity, trimRunes(title, 300), trimRunes(mediaID, 256),
		role, event, trimRunes(syncType, 64), trimRunes(player.Id, 128), trimRunes(detail, 200))
}
