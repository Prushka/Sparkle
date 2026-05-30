package realtime

import (
	"bytes"
	"compress/flate"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	safeID             = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	safeDiscordID      = regexp.MustCompile(`^[0-9]{1,32}$`)
	safeDiscordAvatar  = regexp.MustCompile(`^(a_)?[A-Za-z0-9_]{2,128}$`)
	emojiTokenPattern  = regexp.MustCompile(`:([a-z0-9][a-z0-9_+-]{1,39}):`)
	safeEmojiID        = regexp.MustCompile(`^[a-z0-9][a-z0-9_+-]{1,39}$`)
	safeYouTubeVideoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	safeChessSquare    = regexp.MustCompile(`^[a-h][1-8]$`)
	safeChessFEN       = regexp.MustCompile(`^[pnbrqkPNBRQK1-8/]+ [wb] (?:K?Q?k?q?|-)? (?:[a-h][36]|-) [0-9]{1,3} [0-9]{1,4}$`)
)

const (
	idleRoomTTL            = 48 * time.Hour
	statusHeartbeatTimeout = 3 * time.Second
	generatedRoomIDLength  = 6
	roomIDAlphabet         = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
)

type Hub struct {
	outputDir      string
	maxUploadBytes int64
	upgrader       websocket.Upgrader

	mu     sync.RWMutex
	rooms  map[string]*Room
	closed bool
}

type Room struct {
	id                        string
	mediaID                   string
	mediaUpdatedAt            int64
	players                   map[string]*Player
	chats                     []Chat
	lastSeek                  time.Time
	idleSince                 time.Time
	lastPlayersSignature      string
	lastPlayerStatusSignature string
	lastStatusSent            time.Time
	state                     VideoState
	youtube                   YouTubeState
	chess                     ChessState
	mu                        sync.RWMutex
}

type roomRequest struct {
	RoomID  string `json:"roomId,omitempty"`
	MediaID string `json:"mediaId"`
}

type roomResponse struct {
	RoomID       string `json:"roomId"`
	MediaID      string `json:"mediaId"`
	MediaUpdated int64  `json:"mediaUpdated"`
}

func NewHub(options Options) *Hub {
	return &Hub{
		outputDir:      options.OutputDir,
		maxUploadBytes: options.MaxUploadBytes,
		rooms:          make(map[string]*Room),
		upgrader: websocket.Upgrader{
			ReadBufferSize:    1024,
			WriteBufferSize:   1024,
			EnableCompression: true,
			CheckOrigin:       func(_ *http.Request) bool { return true },
		},
	}
}

func (h *Hub) Run(ctx context.Context) {
	syncTicker := time.NewTicker(time.Second)
	defer syncTicker.Stop()
	cleanupTicker := time.NewTicker(time.Minute)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-syncTicker.C:
			h.syncPlayerStates(time.Now())
		case <-cleanupTicker.C:
			h.cleanupIdleRooms(time.Now())
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
	conn.EnableWriteCompression(true)
	if err := conn.SetCompressionLevel(flate.BestSpeed); err != nil {
		log.Printf("websocket compression level: %v", err)
	}

	player := newPlayer(conn, playerID)
	room := h.addPlayerToRoom(roomID, player)

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

func (h *Hub) HandleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var payload roomRequest
	if err := decodeJSONRequest(w, r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	mediaID := strings.TrimSpace(payload.MediaID)
	if !safeID.MatchString(mediaID) {
		http.Error(w, "mediaId is required", http.StatusBadRequest)
		return
	}

	roomID := strings.TrimSpace(payload.RoomID)
	if roomID != "" {
		if !safeID.MatchString(roomID) {
			http.Error(w, "invalid roomId", http.StatusBadRequest)
			return
		}
	} else {
		var err error
		roomID, err = h.generateRoomID()
		if err != nil {
			log.Printf("generate room id: %v", err)
			http.Error(w, "failed to create room", http.StatusInternalServerError)
			return
		}
	}

	writeJSON(w, h.upsertRoom(roomID, mediaID, nil))
}

func (h *Hub) HandleGetRoom(w http.ResponseWriter, r *http.Request) {
	roomID := strings.TrimSpace(r.PathValue("room"))
	if !safeID.MatchString(roomID) {
		http.Error(w, "invalid room", http.StatusBadRequest)
		return
	}

	snapshot, ok := h.roomSnapshot(roomID)
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, snapshot)
}

func (h *Hub) HandleUpdateRoom(w http.ResponseWriter, r *http.Request) {
	roomID := strings.TrimSpace(r.PathValue("room"))
	if !safeID.MatchString(roomID) {
		http.Error(w, "invalid room", http.StatusBadRequest)
		return
	}

	var payload roomRequest
	if err := decodeJSONRequest(w, r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	mediaID := strings.TrimSpace(payload.MediaID)
	if !safeID.MatchString(mediaID) {
		http.Error(w, "mediaId is required", http.StatusBadRequest)
		return
	}

	if _, ok := h.roomSnapshot(roomID); !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, h.upsertRoom(roomID, mediaID, nil))
}

func decodeJSONRequest(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("unexpected extra json")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func newRoom(id string, mediaID string) *Room {
	room := &Room{
		id:      id,
		mediaID: mediaID,
		players: make(map[string]*Player),
		chats:   make([]Chat, 0),
		state:   defaultVideoState(),
		youtube: defaultYouTubeState(),
		chess:   defaultChessState(),
	}
	if mediaID != "" {
		room.mediaUpdatedAt = time.Now().UnixMilli()
	}
	return room
}

func (h *Hub) generateRoomID() (string, error) {
	for range 32 {
		roomID, err := randomRoomID(generatedRoomIDLength)
		if err != nil {
			return "", err
		}
		h.mu.RLock()
		_, exists := h.rooms[roomID]
		h.mu.RUnlock()
		if !exists {
			return roomID, nil
		}
	}
	return "", errors.New("unable to allocate unique room id")
}

func randomRoomID(length int) (string, error) {
	if length <= 0 {
		return "", errors.New("room id length must be positive")
	}
	bytes := make([]byte, length)
	if _, err := cryptorand.Read(bytes); err != nil {
		return "", err
	}
	result := make([]byte, length)
	for i, value := range bytes {
		result[i] = roomIDAlphabet[int(value)%len(roomIDAlphabet)]
	}
	return string(result), nil
}

func (h *Hub) upsertRoom(roomID string, mediaID string, firedBy *PlayerSnapshot) roomResponse {
	h.mu.Lock()
	room := h.rooms[roomID]
	if room == nil {
		room = newRoom(roomID, mediaID)
		h.rooms[roomID] = room
		response := room.snapshotLocked()
		h.mu.Unlock()
		return response
	}
	h.mu.Unlock()

	return room.updateMediaID(mediaID, firedBy)
}

func (h *Hub) roomSnapshot(roomID string) (roomResponse, bool) {
	h.mu.RLock()
	room := h.rooms[roomID]
	h.mu.RUnlock()
	if room == nil {
		return roomResponse{}, false
	}

	room.mu.RLock()
	defer room.mu.RUnlock()
	if room.mediaID == "" {
		return roomResponse{}, false
	}
	return room.snapshotLocked(), true
}

func (h *Hub) addPlayerToRoom(id string, player *Player) *Room {
	h.mu.Lock()
	room := h.rooms[id]
	if room == nil {
		room = newRoom(id, "")
		h.rooms[id] = room
	}

	var old *Player
	room.mu.Lock()
	if existing := room.players[player.state.Id]; existing != nil {
		old = existing
	}
	room.players[player.state.Id] = player
	room.idleSince = time.Time{}
	room.lastPlayersSignature = ""
	room.lastPlayerStatusSignature = ""
	room.lastStatusSent = time.Time{}
	room.mu.Unlock()
	h.mu.Unlock()

	if old != nil {
		old.kick()
	}
	return room
}

func (h *Hub) cleanupIdleRooms(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for id, room := range h.rooms {
		room.mu.RLock()
		idle := len(room.players) == 0 &&
			!room.idleSince.IsZero() &&
			now.Sub(room.idleSince) >= idleRoomTTL
		room.mu.RUnlock()
		if idle {
			delete(h.rooms, id)
		}
	}
}

func (h *Hub) syncPlayerStates(now time.Time) {
	h.mu.RLock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, room := range h.rooms {
		rooms = append(rooms, room)
	}
	h.mu.RUnlock()

	for _, room := range rooms {
		room.syncPlayerState(now)
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
			if !isExpectedWebSocketReadClose(err) {
				log.Printf("[%s] websocket read: %v", player.state.Id, err)
			}
			return
		}
		room.handlePayload(player, payload)
	}
}

func isExpectedWebSocketReadClose(err error) bool {
	return websocket.IsCloseError(
		err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseNoStatusReceived,
	) || errors.Is(err, net.ErrClosed) || strings.Contains(err.Error(), "use of closed network connection")
}

func sendPayloadToPlayers(players []*Player, message any) {
	payload, err := json.Marshal(message)
	if err != nil {
		log.Printf("marshal websocket payload: %v", err)
		return
	}
	for _, player := range players {
		player.sendRaw(payload)
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

func (r *Room) remove(player *Player) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if current := r.players[player.state.Id]; current != player {
		return
	}
	delete(r.players, player.state.Id)
	if len(r.players) == 0 {
		r.state = defaultVideoState()
		r.youtube = defaultYouTubeState()
		r.chess = defaultChessState()
		r.lastSeek = time.Time{}
		r.idleSince = time.Now()
		r.lastPlayersSignature = ""
		r.lastPlayerStatusSignature = ""
		r.lastStatusSent = time.Time{}
	}
}

func (r *Room) updateMediaID(mediaID string, firedBy *PlayerSnapshot) roomResponse {
	now := time.Now().UnixMilli()
	var targets []*Player
	changed := false

	r.mu.Lock()
	if r.mediaID != mediaID {
		r.applyMediaIDLocked(mediaID, now)
		targets = r.playersLocked()
		changed = true
	}
	response := r.snapshotLocked()
	r.mu.Unlock()

	if changed && len(targets) > 0 {
		payload := SendPayload{
			Type:      BroadcastSync,
			FiredBy:   firedBy,
			Timestamp: now,
			Broadcast: map[string]any{
				"type":   MoveToBroadcast,
				"moveTo": mediaID,
			},
		}
		sendPayloadToPlayers(targets, payload)
	}

	return response
}

func (r *Room) applyMediaIDLocked(mediaID string, timestamp int64) {
	r.mediaID = mediaID
	r.mediaUpdatedAt = timestamp
	r.state = defaultVideoState()
	r.youtube = defaultYouTubeState()
	r.chess = defaultChessState()
	r.lastSeek = time.Time{}
	r.lastPlayersSignature = ""
	r.lastPlayerStatusSignature = ""
	r.lastStatusSent = time.Time{}
	for _, player := range r.players {
		player.state.Time = 0
		player.state.Paused = true
	}
}

func (r *Room) snapshotLocked() roomResponse {
	return roomResponse{
		RoomID:       r.id,
		MediaID:      r.mediaID,
		MediaUpdated: r.mediaUpdatedAt,
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
		profileID := strings.TrimSpace(payload.ProfileId)
		if !safeID.MatchString(profileID) {
			profileID = current.state.Id
		}
		name = trimRunes(name, 80)
		r.updatePlayer(current, now, func(state *PlayerSnapshot) {
			state.Name = name
			state.ProfileId = profileID
			state.DiscordUser = sanitizeDiscordUser(payload.DiscordUser)
		})
	case BroadcastSync:
		r.broadcast(current, sanitizeBroadcast(payload.Broadcast))
	case YouTubeSync:
		r.syncYouTube(current, payload.YouTube)
	case ChessSync:
		r.syncChess(current, payload.Chess)
	case ChatSync:
		r.chat(current, payload.Chat, payload.EmojiRefs)
	case TimeSync:
		r.syncTime(current, payload.Time)
	case PauseSync:
		r.syncPause(current, payload.Paused)
	case PfpSync:
		id := current.state.ProfileId
		if id == "" {
			id = current.state.Id
		}
		r.broadcastPFP(id, now.UnixMilli())
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
	targetID, targeted := broadcastTargetID(broadcast)
	moveToMediaID, isMediaMove := broadcastMoveToMediaID(broadcast)
	mediaChanged := false

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	firedBy = sender.state
	if isMediaMove {
		if r.mediaID == moveToMediaID {
			r.mu.Unlock()
			return
		}
		r.applyMediaIDLocked(moveToMediaID, now)
		mediaChanged = true
	}
	if targeted {
		if target := r.players[targetID]; target != nil {
			targets = append(targets, target)
		}
	} else {
		targets = r.playersLocked()
	}
	r.mu.Unlock()

	if isMediaMove && !mediaChanged {
		return
	}
	payload := SendPayload{Type: BroadcastSync, FiredBy: &firedBy, Timestamp: now, Broadcast: broadcast}
	sendPayloadToPlayers(targets, payload)
}

func broadcastTargetID(broadcast map[string]any) (string, bool) {
	if broadcast["type"] != "voiceSignal" {
		return "", false
	}
	targetID, ok := broadcast["targetId"].(string)
	if !ok || strings.TrimSpace(targetID) == "" {
		return "", false
	}
	return strings.TrimSpace(targetID), true
}

func broadcastMoveToMediaID(broadcast map[string]any) (string, bool) {
	if broadcast["type"] != MoveToBroadcast {
		return "", false
	}
	mediaID, ok := broadcast["moveTo"].(string)
	if !ok {
		return "", false
	}
	mediaID = strings.TrimSpace(mediaID)
	if !safeID.MatchString(mediaID) {
		return "", false
	}
	return mediaID, true
}

func sanitizeBroadcast(broadcast map[string]any) map[string]any {
	if broadcast == nil {
		return nil
	}
	switch broadcast["type"] {
	case MoveToBroadcast:
		mediaID, ok := broadcastMoveToMediaID(broadcast)
		if !ok {
			return nil
		}
		return map[string]any{
			"type":   MoveToBroadcast,
			"moveTo": mediaID,
		}
	case SoundEffectSync:
	default:
		return broadcast
	}

	rawEffect, ok := broadcast["soundEffect"].(map[string]any)
	if !ok {
		return nil
	}
	id, ok := rawEffect["id"].(string)
	if !ok {
		return nil
	}
	id = strings.TrimSpace(id)
	if !safeEmojiID.MatchString(id) {
		return nil
	}
	effect := map[string]any{
		"id": id,
	}
	if chessContext, ok := sanitizeSoundEffectChessContext(rawEffect["chess"]); ok {
		effect["chess"] = chessContext
	}
	return map[string]any{
		"type":        SoundEffectSync,
		"soundEffect": effect,
	}
}

func sanitizeSoundEffectChessContext(value any) (map[string]any, bool) {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	tabID, ok := raw["tabId"].(string)
	if !ok {
		return nil, false
	}
	tabID = strings.TrimSpace(tabID)
	if !safeID.MatchString(tabID) {
		return nil, false
	}
	whiteID, ok := raw["whiteId"].(string)
	if !ok {
		return nil, false
	}
	whiteID = strings.TrimSpace(whiteID)
	if !safeID.MatchString(whiteID) {
		return nil, false
	}
	blackID, ok := raw["blackId"].(string)
	if !ok {
		return nil, false
	}
	blackID = strings.TrimSpace(blackID)
	if !safeID.MatchString(blackID) {
		return nil, false
	}
	winner, ok := raw["winner"].(string)
	if !ok {
		return nil, false
	}
	winner = strings.TrimSpace(winner)
	switch winner {
	case "w", "b", "draw":
	default:
		return nil, false
	}
	return map[string]any{
		"tabId":   tabID,
		"whiteId": whiteID,
		"blackId": blackID,
		"winner":  winner,
	}, true
}

func sanitizeDiscordUser(user *DiscordUser) *DiscordUser {
	if user == nil {
		return nil
	}
	id := strings.TrimSpace(user.ID)
	if !safeDiscordID.MatchString(id) {
		return nil
	}
	username := trimRunes(strings.TrimSpace(user.Username), 80)
	if username == "" {
		return nil
	}
	discriminator := trimRunes(strings.TrimSpace(user.Discriminator), 8)
	if discriminator == "" {
		discriminator = "0"
	}
	return &DiscordUser{
		Username:      username,
		Discriminator: discriminator,
		ID:            id,
		PublicFlags:   user.PublicFlags,
		Avatar:        sanitizeDiscordAvatar(user.Avatar),
		GlobalName:    sanitizeOptionalString(user.GlobalName, 80),
	}
}

func sanitizeDiscordAvatar(value *string) *string {
	if value == nil {
		return nil
	}
	avatar := strings.TrimSpace(*value)
	if !safeDiscordAvatar.MatchString(avatar) {
		return nil
	}
	return &avatar
}

func sanitizeOptionalString(value *string, maxRunes int) *string {
	if value == nil {
		return nil
	}
	trimmed := trimRunes(strings.TrimSpace(*value), maxRunes)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func trimRunes(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}

func (r *Room) syncYouTube(sender *Player, incoming *YouTubeState) {
	now := time.Now()
	state, ok := sanitizeYouTubeState(incoming, now.UnixMilli())
	if !ok {
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
	sender.state.LastSeen = now.Unix()
	shouldBroadcast = shouldBroadcastYouTubeState(r.youtube, state)
	r.youtube = state
	firedBy = sender.state
	if shouldBroadcast {
		targets = r.playersLocked()
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: YouTubeSync, YouTube: &state, FiredBy: &firedBy, Timestamp: now.UnixMilli()}
	sendPayloadToPlayers(targets, payload)
}

func shouldBroadcastYouTubeState(previous YouTubeState, next YouTubeState) bool {
	if len(previous.Tabs) != len(next.Tabs) {
		return true
	}
	for i, previousTab := range previous.Tabs {
		nextTab := next.Tabs[i]
		if previousTab.ID != nextTab.ID ||
			previousTab.Open != nextTab.Open ||
			previousTab.VideoID != nextTab.VideoID ||
			previousTab.Paused != nextTab.Paused ||
			math.Abs(previousTab.PlaybackRate-nextTab.PlaybackRate) > 0.01 {
			return true
		}
		if nextTab.Paused {
			if math.Abs(previousTab.Time-nextTab.Time) > 0.5 {
				return true
			}
		} else if math.Abs(previousTab.Time-nextTab.Time) > 3 {
			return true
		}
	}
	return false
}

func sanitizeYouTubeState(incoming *YouTubeState, timestamp int64) (YouTubeState, bool) {
	if incoming == nil {
		return YouTubeState{}, false
	}

	state := defaultYouTubeState()
	seen := make(map[string]bool, len(incoming.Tabs))
	for _, rawTab := range incoming.Tabs {
		if len(state.Tabs) >= maxYouTubeTabs {
			break
		}
		tab := YouTubeTabState{
			ID:           strings.TrimSpace(rawTab.ID),
			Open:         rawTab.Open,
			Paused:       true,
			PlaybackRate: 1,
			UpdatedAt:    timestamp,
		}
		if !safeID.MatchString(tab.ID) || seen[tab.ID] {
			continue
		}
		seen[tab.ID] = true

		tab.VideoID = strings.TrimSpace(rawTab.VideoID)
		if tab.VideoID != "" {
			if !safeYouTubeVideoID.MatchString(tab.VideoID) {
				continue
			}
			tab.URL = "https://www.youtube.com/watch?v=" + tab.VideoID
		}
		if !math.IsNaN(rawTab.Time) && !math.IsInf(rawTab.Time, 0) && rawTab.Time > 0 {
			tab.Time = math.Min(rawTab.Time, 7*24*60*60)
		}
		if rawTab.PlaybackRate > 0 && !math.IsNaN(rawTab.PlaybackRate) && !math.IsInf(rawTab.PlaybackRate, 0) {
			tab.PlaybackRate = math.Min(rawTab.PlaybackRate, 4)
		}
		tab.Paused = rawTab.Paused
		if rawTab.UpdatedAt > 0 {
			tab.UpdatedAt = rawTab.UpdatedAt
		}
		state.Tabs = append(state.Tabs, tab)
	}
	if len(incoming.Tabs) > 0 && len(state.Tabs) == 0 {
		return YouTubeState{}, false
	}
	state.UpdatedAt = timestamp
	return state, true
}

func (r *Room) syncChess(sender *Player, incoming *ChessState) {
	now := time.Now()
	state, ok := sanitizeChessState(incoming, now.UnixMilli())
	if !ok {
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
	sender.state.LastSeen = now.Unix()
	shouldBroadcast = !reflect.DeepEqual(r.chess, state)
	r.chess = state
	firedBy = sender.state
	if shouldBroadcast {
		targets = r.playersLocked()
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: ChessSync, Chess: &state, FiredBy: &firedBy, Timestamp: now.UnixMilli()}
	sendPayloadToPlayers(targets, payload)
}

func sanitizeChessState(incoming *ChessState, timestamp int64) (ChessState, bool) {
	if incoming == nil {
		return ChessState{}, false
	}

	state := defaultChessState()
	seen := make(map[string]bool, len(incoming.Tabs))
	for _, rawTab := range incoming.Tabs {
		if len(state.Tabs) >= maxChessTabs {
			break
		}
		phase := sanitizeChessPhase(rawTab.Phase)
		settings := sanitizeChessSettings(rawTab.Settings)
		tab := ChessTabState{
			ID:        strings.TrimSpace(rawTab.ID),
			Open:      rawTab.Open,
			Phase:     phase,
			Settings:  settings,
			FEN:       sanitizeChessFEN(rawTab.FEN),
			Clocks:    sanitizeChessClocks(rawTab.Clocks, settings, phase),
			Result:    sanitizeChessResult(rawTab.Result),
			UpdatedAt: timestamp,
		}
		if !safeID.MatchString(tab.ID) || seen[tab.ID] {
			continue
		}
		seen[tab.ID] = true
		if tab.FEN == "" {
			tab.FEN = "start"
		}
		if rawTab.UpdatedAt > 0 {
			tab.UpdatedAt = rawTab.UpdatedAt
		}

		tab.White = sanitizeChessPlayer(rawTab.White)
		tab.Black = sanitizeChessPlayer(rawTab.Black)
		if tab.White != nil && tab.Black != nil && tab.White.ID == tab.Black.ID {
			tab.Black = nil
		}
		tab.Moves = sanitizeChessMoves(rawTab.Moves)
		tab.CloseRequest = sanitizeChessCloseRequest(rawTab.CloseRequest, timestamp)
		tab.DrawOffer = sanitizeChessDrawOffer(rawTab.DrawOffer)
		if tab.Phase != "playing" {
			tab.DrawOffer = nil
		}
		if tab.Phase == "setup" {
			tab.Result = nil
		}

		state.Tabs = append(state.Tabs, tab)
	}
	if len(incoming.Tabs) > 0 && len(state.Tabs) == 0 {
		return ChessState{}, false
	}
	state.UpdatedAt = timestamp
	return state, true
}

func sanitizeChessPhase(value string) string {
	switch strings.TrimSpace(value) {
	case "playing", "ended":
		return strings.TrimSpace(value)
	default:
		return "setup"
	}
}

func sanitizeChessSettings(settings ChessSettingsState) ChessSettingsState {
	pieceSet := strings.TrimSpace(settings.PieceSet)
	switch pieceSet {
	case "cartoon", "mushroom", "sushi", "space":
	default:
		pieceSet = "cartoon"
	}

	boardTheme := strings.TrimSpace(settings.BoardTheme)
	switch boardTheme {
	case "blue", "walnut":
	default:
		boardTheme = "green"
	}

	minutes := settings.Minutes
	if minutes <= 0 {
		minutes = 10
	}
	if minutes > 180 {
		minutes = 180
	}
	increment := settings.IncrementSeconds
	if increment < 0 {
		increment = 0
	}
	if increment > 120 {
		increment = 120
	}

	return ChessSettingsState{
		PieceSet:         pieceSet,
		BoardTheme:       boardTheme,
		Timed:            settings.Timed,
		Minutes:          minutes,
		IncrementSeconds: increment,
	}
}

func sanitizeChessPlayer(player *ChessPlayerState) *ChessPlayerState {
	if player == nil {
		return nil
	}
	id := strings.TrimSpace(player.ID)
	if !safeID.MatchString(id) {
		return nil
	}
	name := trimRunes(strings.TrimSpace(player.Name), 80)
	if name == "" {
		name = "Player"
	}
	profileID := strings.TrimSpace(player.ProfileID)
	if profileID != "" && !safeID.MatchString(profileID) {
		profileID = ""
	}
	return &ChessPlayerState{
		ID:        id,
		Name:      name,
		ProfileID: profileID,
	}
}

func sanitizeChessMoves(moves []ChessMoveState) []ChessMoveState {
	if len(moves) == 0 {
		return nil
	}
	sanitized := make([]ChessMoveState, 0, min(len(moves), maxChessMoves))
	for _, move := range moves {
		if len(sanitized) >= maxChessMoves {
			break
		}
		from := strings.TrimSpace(move.From)
		to := strings.TrimSpace(move.To)
		if !safeChessSquare.MatchString(from) || !safeChessSquare.MatchString(to) {
			continue
		}
		promotion := strings.TrimSpace(move.Promotion)
		switch promotion {
		case "", "q", "r", "b", "n":
		default:
			promotion = ""
		}
		san := trimRunes(strings.TrimSpace(move.SAN), 32)
		sanitized = append(sanitized, ChessMoveState{
			From:      from,
			To:        to,
			Promotion: promotion,
			SAN:       san,
		})
	}
	return sanitized
}

func sanitizeChessFEN(value string) string {
	fen := strings.TrimSpace(value)
	if fen == "" || fen == "start" {
		return "start"
	}
	if len(fen) > 120 || !safeChessFEN.MatchString(fen) {
		return ""
	}
	return fen
}

func sanitizeChessClocks(clocks ChessClockState, settings ChessSettingsState, phase string) ChessClockState {
	defaultMs := int64(settings.Minutes)
	if defaultMs <= 0 {
		defaultMs = 10
	}
	defaultMs *= int64(time.Minute / time.Millisecond)
	whiteMs := clocks.WhiteMs
	blackMs := clocks.BlackMs
	if whiteMs < 0 {
		whiteMs = 0
	}
	if blackMs < 0 {
		blackMs = 0
	}
	if whiteMs == 0 && blackMs == 0 && phase != "ended" {
		whiteMs = defaultMs
		blackMs = defaultMs
	}
	maxMs := int64(24 * time.Hour / time.Millisecond)
	if whiteMs > maxMs {
		whiteMs = maxMs
	}
	if blackMs > maxMs {
		blackMs = maxMs
	}
	lastTickAt := clocks.LastTickAt
	if lastTickAt < 0 {
		lastTickAt = 0
	}
	return ChessClockState{WhiteMs: whiteMs, BlackMs: blackMs, LastTickAt: lastTickAt}
}

func sanitizeChessResult(result *ChessResultState) *ChessResultState {
	if result == nil {
		return nil
	}
	winner := strings.TrimSpace(result.Winner)
	switch winner {
	case "w", "b", "draw":
	default:
		winner = ""
	}
	reason := trimRunes(strings.TrimSpace(result.Reason), 40)
	message := trimRunes(strings.TrimSpace(result.Message), 160)
	return &ChessResultState{Winner: winner, Reason: reason, Message: message}
}

func sanitizeChessCloseRequest(request *ChessCloseRequestState, timestamp int64) *ChessCloseRequestState {
	if request == nil {
		return nil
	}
	requestedBy := sanitizeChessPlayer(&request.RequestedBy)
	if requestedBy == nil {
		return nil
	}
	requestedAt := request.RequestedAt
	if requestedAt <= 0 {
		requestedAt = timestamp
	}
	expiresAt := request.ExpiresAt
	if expiresAt <= requestedAt {
		expiresAt = requestedAt + int64(time.Minute/time.Millisecond)
	}
	return &ChessCloseRequestState{
		RequestedBy: *requestedBy,
		RequestedAt: requestedAt,
		ExpiresAt:   expiresAt,
	}
}

func sanitizeChessDrawOffer(offer *ChessDrawOfferState) *ChessDrawOfferState {
	if offer == nil {
		return nil
	}
	offeredBy := sanitizeChessPlayer(&offer.OfferedBy)
	if offeredBy == nil {
		return nil
	}
	offeredAt := offer.OfferedAt
	if offeredAt < 0 {
		offeredAt = 0
	}
	return &ChessDrawOfferState{OfferedBy: *offeredBy, OfferedAt: offeredAt}
}

func (r *Room) chat(sender *Player, message string, emojiRefs []ChatEmojiRef) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	messageRunes := []rune(message)
	if len(messageRunes) > maxChatLength {
		message = string(messageRunes[:maxChatLength])
	}

	var targets []*Player
	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	author := chatAuthorFromSnapshot(sender.state)
	chat := Chat{
		Message:   message,
		Emojis:    extractEmojiIDs(message),
		EmojiRefs: sanitizeEmojiRefs(message, emojiRefs),
		Author:    &author,
		Uid:       sender.state.Id,
		Timestamp: time.Now().UnixMilli(),
		MediaSec:  sender.state.Time,
	}
	r.chats = append(r.chats, chat)
	if len(r.chats) > maxChatMessages {
		r.chats = append([]Chat(nil), r.chats[len(r.chats)-maxChatMessages:]...)
	}
	targets = r.playersLocked()
	r.mu.Unlock()

	payload := SendPayload{Type: ChatSync, Chat: &chat, Timestamp: time.Now().UnixMilli()}
	sendPayloadToPlayers(targets, payload)
}

func extractEmojiIDs(message string) []string {
	matches := emojiTokenPattern.FindAllStringSubmatch(message, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]bool, len(matches))
	ids := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		id := match[1]
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= maxChatEmojis {
			break
		}
	}
	return ids
}

func chatAuthorFromSnapshot(snapshot PlayerSnapshot) ChatAuthor {
	return ChatAuthor{
		Name:        snapshot.Name,
		Id:          snapshot.Id,
		ProfileId:   snapshot.ProfileId,
		DiscordUser: snapshot.DiscordUser,
	}
}

func sanitizeEmojiRefs(message string, refs []ChatEmojiRef) []ChatEmojiRef {
	if len(refs) == 0 {
		return nil
	}

	tokenIDs := make(map[string]bool)
	for _, match := range emojiTokenPattern.FindAllStringSubmatch(message, -1) {
		if len(match) >= 2 {
			tokenIDs[strings.ToLower(match[1])] = true
		}
	}
	if len(tokenIDs) == 0 {
		return nil
	}

	seen := make(map[string]bool, len(refs))
	sanitized := make([]ChatEmojiRef, 0, len(refs))
	for _, ref := range refs {
		id := strings.ToLower(strings.TrimSpace(ref.ID))
		if !tokenIDs[id] || seen[id] || !safeEmojiID.MatchString(id) {
			continue
		}

		source := strings.TrimSpace(ref.Source)
		if !isAllowedEmojiSource(source) {
			continue
		}

		src := sanitizeEmojiURL(ref.Src, false)
		if src == "" {
			continue
		}

		kind := strings.TrimSpace(ref.Kind)
		if kind != "emoji" && kind != "sticker" {
			kind = "emoji"
		}

		label := strings.TrimSpace(ref.Label)
		labelRunes := []rune(label)
		if len(labelRunes) > 80 {
			label = string(labelRunes[:80])
		}
		if label == "" {
			label = id
		}

		seen[id] = true
		sanitized = append(sanitized, ChatEmojiRef{
			ID:         id,
			Label:      label,
			Src:        src,
			Source:     source,
			Animated:   ref.Animated,
			Kind:       kind,
			PreviewSrc: sanitizeEmojiURL(ref.PreviewSrc, false),
			ItemURL:    sanitizeEmojiURL(ref.ItemURL, true),
		})
		if len(sanitized) >= maxChatEmojis {
			break
		}
	}
	return sanitized
}

func isAllowedEmojiSource(source string) bool {
	switch source {
	case "7TV", "BetterTTV", "FrankerFaceZ", "Tenor":
		return true
	default:
		return false
	}
}

func sanitizeEmojiURL(raw string, allowItemURL bool) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return ""
	}

	switch parsed.Hostname() {
	case "media.tenor.com", "c.tenor.com", "cdn.7tv.app", "cdn.betterttv.net", "cdn.frankerfacez.com":
		return parsed.String()
	case "tenor.com":
		if allowItemURL {
			return parsed.String()
		}
		return ""
	default:
		return ""
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
		targets = r.playersLocked()
		for _, player := range targets {
			player.state.Time = sender.state.Time
		}
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: TimeSync, Time: next, FiredBy: &firedBy, Timestamp: time.Now().UnixMilli()}
	sendPayloadToPlayers(targets, payload)
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
		targets = r.playersLocked()
		for _, player := range targets {
			player.state.Paused = *paused
		}
	}
	r.mu.Unlock()

	if len(targets) == 0 {
		return
	}
	payload := SendPayload{Type: PauseSync, Paused: paused, FiredBy: &firedBy, Timestamp: time.Now().UnixMilli()}
	sendPayloadToPlayers(targets, payload)
}

func (r *Room) newPlayer(sender *Player) {
	var roomTime float64
	var roomPaused bool
	var youtube YouTubeState
	var chess ChessState
	var chats []Chat

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	roomTime = r.state.Time
	roomPaused = r.state.Paused
	if len(r.players) == 1 {
		roomPaused = false
		r.state.Paused = false
	}
	sender.state.Time = roomTime
	sender.state.Paused = roomPaused
	youtube = r.youtube
	chess = r.chess
	chats = append([]Chat(nil), r.chats...)
	r.mu.Unlock()

	sender.sendJSON(SendPayload{Type: TimeSync, Time: &roomTime, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: PauseSync, Paused: &roomPaused, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: YouTubeSync, YouTube: &youtube, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: ChessSync, Chess: &chess, Timestamp: time.Now().UnixMilli()})
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
	for _, player := range r.players {
		if player.state.Id != id && player.state.ProfileId != id {
			continue
		}
		snapshot := player.state
		if snapshot.ProfileId == "" {
			snapshot.ProfileId = id
		}
		firedBy = &snapshot
		break
	}
	if firedBy != nil {
		targets = r.playersLocked()
	}
	r.mu.RUnlock()

	if firedBy == nil {
		return
	}
	payload := SendPayload{Type: PfpSync, FiredBy: firedBy, Timestamp: timestamp}
	sendPayloadToPlayers(targets, payload)
}

type playerPresenceSignature struct {
	Id          string       `json:"id"`
	Name        string       `json:"name"`
	ProfileId   string       `json:"profileId,omitempty"`
	Codec       string       `json:"codec,omitempty"`
	Audio       string       `json:"audio,omitempty"`
	Subtitle    string       `json:"subtitle,omitempty"`
	DiscordUser *DiscordUser `json:"discordUser,omitempty"`
}

func (r *Room) syncPlayerState(now time.Time) {
	var players []PlayerSnapshot
	var statuses []PlayerStatus
	var presences []playerPresenceSignature
	var targets []*Player

	r.mu.Lock()
	for _, player := range r.players {
		targets = append(targets, player)
		if player.state.Name == "" {
			continue
		}
		players = append(players, player.state)
		statuses = append(statuses, playerStatusFromSnapshot(player.state))
		presences = append(presences, playerPresenceSignature{
			Id:          player.state.Id,
			Name:        player.state.Name,
			ProfileId:   player.state.ProfileId,
			Codec:       player.state.Codec,
			Audio:       player.state.Audio,
			Subtitle:    player.state.Subtitle,
			DiscordUser: player.state.DiscordUser,
		})
	}

	sort.Slice(players, func(i, j int) bool {
		return comparePlayerSnapshots(players[i], players[j])
	})
	sort.Slice(statuses, func(i, j int) bool {
		return statuses[i].Id < statuses[j].Id
	})
	sort.Slice(presences, func(i, j int) bool {
		return presences[i].Id < presences[j].Id
	})

	playersSignature := signatureFor(presences)
	statusSignature := signatureFor(statuses)
	var payload *SendPayload
	timestamp := now.UnixMilli()
	switch {
	case len(players) == 0:
		r.lastPlayersSignature = ""
		r.lastPlayerStatusSignature = ""
		r.lastStatusSent = time.Time{}
	case playersSignature != r.lastPlayersSignature:
		r.lastPlayersSignature = playersSignature
		r.lastPlayerStatusSignature = statusSignature
		r.lastStatusSent = now
		payload = &SendPayload{
			Type:         PlayersStatusSync,
			Players:      players,
			PlayersCount: len(players),
			Timestamp:    timestamp,
		}
	case statusSignature != r.lastPlayerStatusSignature:
		r.lastPlayerStatusSignature = statusSignature
		r.lastStatusSent = now
		payload = &SendPayload{
			Type:           PlayerStatusSync,
			PlayerStatuses: statuses,
			PlayersCount:   len(players),
			Timestamp:      timestamp,
		}
	case r.lastStatusSent.IsZero() || now.Sub(r.lastStatusSent) >= statusHeartbeatTimeout:
		r.lastStatusSent = now
		payload = &SendPayload{
			Type:         HeartbeatSync,
			PlayersCount: len(players),
			Timestamp:    timestamp,
		}
	}
	r.mu.Unlock()

	if payload == nil || len(targets) == 0 {
		return
	}
	sendPayloadToPlayers(targets, *payload)
}

func comparePlayerSnapshots(left PlayerSnapshot, right PlayerSnapshot) bool {
	if left.Name == right.Name {
		return left.Id < right.Id
	}
	return left.Name < right.Name
}

func playerStatusFromSnapshot(snapshot PlayerSnapshot) PlayerStatus {
	return PlayerStatus{
		Id:       snapshot.Id,
		Time:     snapshot.Time,
		Paused:   snapshot.Paused,
		InBg:     snapshot.InBg,
		LastSeen: snapshot.LastSeen,
	}
}

func signatureFor(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		log.Printf("marshal websocket signature: %v", err)
		return ""
	}
	return string(payload)
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
