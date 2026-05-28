package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var safeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type Hub struct {
	outputDir      string
	maxUploadBytes int64
	upgrader       websocket.Upgrader

	mu     sync.RWMutex
	rooms  map[string]*Room
	closed bool
}

type Room struct {
	id       string
	players  map[string]*Player
	chats    []Chat
	lastSeek time.Time
	state    VideoState
	mu       sync.RWMutex
}

func NewHub(options Options) *Hub {
	return &Hub{
		outputDir:      options.OutputDir,
		maxUploadBytes: options.MaxUploadBytes,
		rooms:          make(map[string]*Room),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(_ *http.Request) bool { return true },
		},
	}
}

func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.syncPlayerStates()
		}
	}
}

func (h *Hub) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true
	rooms := make([]*Room, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room)
	}
	h.mu.Unlock()

	for _, room := range rooms {
		room.close()
	}
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	roomID := strings.TrimSpace(r.PathValue("room"))
	playerID := strings.TrimSpace(r.PathValue("id"))
	if roomID == "" || playerID == "" {
		http.Error(w, "room and id are required", http.StatusBadRequest)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}

	player := newPlayer(conn, playerID)
	room := h.getOrCreateRoom(roomID)
	room.add(player)

	log.Printf("[%s] connected to room %s", playerID, roomID)
	go player.writePump()
	h.readPump(room, player)
}

func (h *Hub) HandlePFP(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if !safeID.MatchString(id) {
		http.Error(w, "invalid profile id", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.maxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(h.maxUploadBytes); err != nil {
		http.Error(w, "invalid multipart upload", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("pfp")
	if err != nil {
		http.Error(w, "missing pfp file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, h.maxUploadBytes+1))
	if err != nil {
		http.Error(w, "failed to read upload", http.StatusBadRequest)
		return
	}
	if int64(len(content)) > h.maxUploadBytes {
		http.Error(w, "upload too large", http.StatusRequestEntityTooLarge)
		return
	}
	if !isImageUpload(content, header.Filename) {
		http.Error(w, "unsupported image type", http.StatusUnsupportedMediaType)
		return
	}

	if err := h.writeProfileImage(id, content); err != nil {
		log.Printf("write profile image: %v", err)
		http.Error(w, "failed to store profile image", http.StatusInternalServerError)
		return
	}

	revision := time.Now().UnixMilli()
	h.broadcastPFP(id, revision)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "revision": revision})
}

func (h *Hub) getOrCreateRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	if room := h.rooms[id]; room != nil {
		return room
	}
	room := &Room{
		id:      id,
		players: make(map[string]*Player),
		chats:   make([]Chat, 0),
		state:   defaultVideoState(),
	}
	h.rooms[id] = room
	return room
}

func (h *Hub) syncPlayerStates() {
	h.mu.RLock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room)
	}
	h.mu.RUnlock()

	for _, room := range rooms {
		room.broadcastPlayerState()
	}
}

func (h *Hub) readPump(room *Room, player *Player) {
	defer func() {
		room.remove(player)
		player.closeSend()
		log.Printf("[%s] disconnected from room %s", player.state.Id, room.id)
	}()

	player.conn.SetReadLimit(maxMessage)
	_ = player.conn.SetReadDeadline(time.Now().Add(pongWait))
	player.conn.SetPongHandler(func(string) error {
		return player.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		var payload ClientPayload
		if err := player.conn.ReadJSON(&payload); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("[%s] websocket read: %v", player.state.Id, err)
			}
			return
		}
		room.handlePayload(player, payload)
	}
}

func (h *Hub) broadcastPFP(id string, timestamp int64) {
	if timestamp == 0 {
		timestamp = time.Now().UnixMilli()
	}

	h.mu.RLock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room)
	}
	h.mu.RUnlock()

	for _, room := range rooms {
		room.broadcastPFP(id, timestamp)
	}
}

func (h *Hub) writeProfileImage(id string, content []byte) error {
	dir := filepath.Join(h.outputDir, "pfp")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, id+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()

	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	return os.Rename(tmpName, filepath.Join(dir, id+".png"))
}

func (r *Room) add(player *Player) {
	var old *Player

	r.mu.Lock()
	if existing := r.players[player.state.Id]; existing != nil {
		old = existing
	}
	r.players[player.state.Id] = player
	r.mu.Unlock()

	if old != nil {
		old.kick()
	}
}

func (r *Room) remove(player *Player) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if current := r.players[player.state.Id]; current != player {
		return
	}
	delete(r.players, player.state.Id)
	if len(r.players) == 0 {
		r.state = defaultVideoState()
		r.lastSeek = time.Time{}
	}
}

func (r *Room) close() {
	r.mu.RLock()
	players := make([]*Player, 0, len(r.players))
	for _, player := range r.players {
		players = append(players, player)
	}
	r.mu.RUnlock()

	for _, player := range players {
		player.kick()
		player.closeSend()
	}
}

func (r *Room) handlePayload(current *Player, payload ClientPayload) {
	now := time.Now()
	switch payload.Type {
	case StateSync:
		r.setForegroundState(current, payload.State)
	case CodecSwitch:
		r.updatePlayer(current, now, func(state *PlayerSnapshot) { state.Codec = payload.Codec })
	case AudioSwitch:
		r.updatePlayer(current, now, func(state *PlayerSnapshot) { state.Audio = payload.Audio })
	case SubtitleSwitch:
		r.updatePlayer(current, now, func(state *PlayerSnapshot) { state.Subtitle = payload.Subtitle })
	case ProfileSync:
		name := strings.TrimSpace(payload.Name)
		nameRunes := []rune(name)
		if len(nameRunes) > 80 {
			name = string(nameRunes[:80])
		}
		r.updatePlayer(current, now, func(state *PlayerSnapshot) {
			state.Name = name
			state.DiscordUser = payload.DiscordUser
		})
	case BroadcastSync:
		r.broadcast(current, payload.Broadcast)
	case ChatSync:
		r.chat(current, payload.Chat)
	case TimeSync:
		r.syncTime(current, payload.Time)
	case PauseSync:
		r.syncPause(current, payload.Paused)
	case PfpSync:
		r.broadcastPFP(current.state.Id, now.UnixMilli())
	case NewPlayer:
		r.newPlayer(current)
	default:
		log.Printf("[%s] ignored unknown sync type %q", current.state.Id, payload.Type)
	}
}

func (r *Room) updatePlayer(player *Player, now time.Time, update func(*PlayerSnapshot)) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.players[player.state.Id] != player {
		return
	}
	player.state.LastSeen = now.Unix()
	update(&player.state)
}

func (r *Room) setForegroundState(player *Player, state string) {
	var chats []Chat

	r.mu.Lock()
	if r.players[player.state.Id] != player {
		r.mu.Unlock()
		return
	}
	player.state.LastSeen = time.Now().Unix()
	switch state {
	case "bg":
		player.state.InBg = true
	case "fg":
		player.state.InBg = false
		chats = append([]Chat(nil), r.chats...)
	}
	r.mu.Unlock()

	if len(chats) > 0 {
		player.sendJSON(SendPayload{Type: ChatSync, Chats: chats, Timestamp: time.Now().UnixMilli()})
	}
}

func (r *Room) broadcast(sender *Player, broadcast map[string]any) {
	if broadcast == nil {
		return
	}

	now := time.Now().UnixMilli()
	var firedBy PlayerSnapshot
	var targets []*Player

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	firedBy = sender.state
	targets = r.playersLocked()
	r.mu.Unlock()

	payload := SendPayload{Type: BroadcastSync, FiredBy: &firedBy, Timestamp: now, Broadcast: broadcast}
	for _, player := range targets {
		player.sendJSON(payload)
	}
}

func (r *Room) chat(sender *Player, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(message) > maxChatLength {
		message = message[:maxChatLength]
	}

	var chats []Chat
	var targets []*Player
	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	chat := Chat{
		Message:   message,
		Uid:       sender.state.Id,
		Timestamp: time.Now().UnixMilli(),
		MediaSec:  sender.state.Time,
	}
	r.chats = append(r.chats, chat)
	if len(r.chats) > maxChatMessages {
		r.chats = append([]Chat(nil), r.chats[len(r.chats)-maxChatMessages:]...)
	}
	chats = append([]Chat(nil), r.chats...)
	targets = r.playersLocked()
	r.mu.Unlock()

	payload := SendPayload{Type: ChatSync, Chats: chats, Timestamp: time.Now().UnixMilli()}
	for _, player := range targets {
		player.sendJSON(payload)
	}
}

func (r *Room) syncTime(sender *Player, next *float64) {
	if next == nil || math.IsNaN(*next) || math.IsInf(*next, 0) || *next < 0 {
		return
	}

	var firedBy PlayerSnapshot
	var targets []*Player
	shouldBroadcast := false

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	sender.state.Time = *next
	if math.Abs(r.state.Time-sender.state.Time) > 5 && r.lastSeek.Add(time.Second).Before(time.Now()) {
		shouldBroadcast = !sender.state.InBg
		r.lastSeek = time.Now()
	}
	r.state.Time = sender.state.Time
	firedBy = sender.state
	if shouldBroadcast {
		targets = r.otherPlayersLocked(sender)
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: TimeSync, Time: next, FiredBy: &firedBy, Timestamp: time.Now().UnixMilli()}
	for _, player := range targets {
		player.sendJSON(payload)
	}
}

func (r *Room) syncPause(sender *Player, paused *bool) {
	if paused == nil {
		return
	}

	var firedBy PlayerSnapshot
	var targets []*Player

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	sender.state.Paused = *paused
	r.state.Paused = *paused
	firedBy = sender.state
	if !sender.state.InBg {
		targets = r.otherPlayersLocked(sender)
	}
	r.mu.Unlock()

	if len(targets) == 0 {
		return
	}
	payload := SendPayload{Type: PauseSync, Paused: paused, FiredBy: &firedBy, Timestamp: time.Now().UnixMilli()}
	for _, player := range targets {
		player.sendJSON(payload)
	}
}

func (r *Room) newPlayer(sender *Player) {
	var roomTime float64
	var chats []Chat
	var firedBy PlayerSnapshot
	var targets []*Player

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	roomTime = r.state.Time
	chats = append([]Chat(nil), r.chats...)
	firedBy = sender.state
	if !sender.state.InBg {
		targets = r.otherPlayersLocked(sender)
	}
	r.mu.Unlock()

	paused := false
	sender.sendJSON(SendPayload{Type: TimeSync, Time: &roomTime, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: PauseSync, Paused: &paused, Timestamp: time.Now().UnixMilli()})
	for _, player := range targets {
		player.sendJSON(SendPayload{Type: PauseSync, Paused: &paused, FiredBy: &firedBy, Timestamp: time.Now().UnixMilli()})
	}
	if len(chats) > 0 {
		sender.sendJSON(SendPayload{Type: ChatSync, Chats: chats, Timestamp: time.Now().UnixMilli()})
	}
}

func (r *Room) broadcastPFP(id string, timestamp int64) {
	if timestamp == 0 {
		timestamp = time.Now().UnixMilli()
	}

	var firedBy *PlayerSnapshot
	var targets []*Player

	r.mu.RLock()
	if player := r.players[id]; player != nil {
		snapshot := player.state
		firedBy = &snapshot
		targets = r.playersLocked()
	}
	r.mu.RUnlock()

	if firedBy == nil {
		return
	}
	payload := SendPayload{Type: PfpSync, FiredBy: firedBy, Timestamp: timestamp}
	for _, player := range targets {
		player.sendJSON(payload)
	}
}

func (r *Room) broadcastPlayerState() {
	var players []PlayerSnapshot
	var targets []*Player

	r.mu.RLock()
	for _, player := range r.players {
		targets = append(targets, player)
		if player.state.Name == "" {
			continue
		}
		players = append(players, player.state)
	}
	r.mu.RUnlock()

	if len(players) == 0 {
		return
	}

	sort.Slice(players, func(i, j int) bool {
		if players[i].Name == players[j].Name {
			return players[i].Id < players[j].Id
		}
		return players[i].Name < players[j].Name
	})

	payload := SendPayload{Type: PlayersStatusSync, Players: players, Timestamp: time.Now().UnixMilli()}
	for _, player := range targets {
		player.sendJSON(payload)
	}
}

func (r *Room) playersLocked() []*Player {
	players := make([]*Player, 0, len(r.players))
	for _, player := range r.players {
		players = append(players, player)
	}
	return players
}

func (r *Room) otherPlayersLocked(sender *Player) []*Player {
	capacity := len(r.players) - 1
	if capacity < 0 {
		capacity = 0
	}
	players := make([]*Player, 0, capacity)
	for _, player := range r.players {
		if player != sender {
			players = append(players, player)
		}
	}
	return players
}

func isImageUpload(content []byte, filename string) bool {
	if len(content) == 0 {
		return false
	}
	contentType := http.DetectContentType(content)
	switch contentType {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif":
		return true
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".webp" && len(content) >= 12 &&
		string(content[:4]) == "RIFF" && string(content[8:12]) == "WEBP" {
		return true
	}
	if ext == ".avif" && bytes.Contains(content[:min(len(content), 64)], []byte("ftypavif")) {
		return true
	}
	if ext != ".svg" {
		return false
	}
	trimmed := strings.TrimSpace(string(content[:min(len(content), 512)]))
	return strings.HasPrefix(trimmed, "<svg") || strings.Contains(trimmed, "<svg ")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
