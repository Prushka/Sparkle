package realtime

import "time"

// These namespaces have independent game lifetimes and clients. Send just the
// requested initial state, preserving discovery of tabs opened by other viewers.
func (r *Room) sendTabSnapshot(player *Player) bool {
	base, kind := socketRole(r.id, "")
	if base == r.id {
		return false
	}
	r.mu.Lock()
	if r.players[player.state.Id] != player {
		r.mu.Unlock()
		return true
	}
	player.state.LastSeen = time.Now().Unix()
	payload := SendPayload{Type: kind, Timestamp: time.Now().UnixMilli()}
	switch kind {
	case YouTubeSync:
		state := r.youtube
		payload.YouTube = &state
	case ChessSync:
		state := r.chess
		payload.Chess = &state
	case WordleSync:
		state := r.wordle
		payload.Wordle = &state
	case CottageSync:
		state := cloneCottageState(r.cottage)
		payload.Cottage = &state
	}
	r.mu.Unlock()
	player.sendJSON(payload)
	return true
}
