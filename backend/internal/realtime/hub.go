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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	safeID              = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	safeDiscordID       = regexp.MustCompile(`^[0-9]{1,32}$`)
	safeDiscordAvatar   = regexp.MustCompile(`^(a_)?[A-Za-z0-9_]{2,128}$`)
	emojiTokenPattern   = regexp.MustCompile(`:([a-z0-9][a-z0-9_+-]{1,39}):`)
	safeEmojiID         = regexp.MustCompile(`^[a-z0-9][a-z0-9_+-]{1,39}$`)
	safeYouTubeVideoID  = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	safeChessSquare     = regexp.MustCompile(`^[a-h][1-8]$`)
	safeChessFEN        = regexp.MustCompile(`^[pnbrqkPNBRQK1-8/]+ [wb] (?:K?Q?k?q?|-)? (?:[a-h][36]|-) [0-9]{1,3} [0-9]{1,4}$`)
	safeCottagePlayerID = regexp.MustCompile(`^[A-Za-z0-9_:-]{1,128}$`)
	safeWordleGuess     = regexp.MustCompile(`^[A-Z]{5}$`)
)

const (
	idleRoomTTL                     = 48 * time.Hour
	statusHeartbeatTimeout          = 3 * time.Second
	roomTimeSyncThresholdSeconds    = 6
	youTubeTimeSyncThresholdSeconds = 6
	generatedRoomIDLength           = 10
	roomIDAlphabet                  = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	cottageMinX                     = 44
	cottageMaxX                     = 1396
	cottageMinY                     = 116
	cottageMaxY                     = 520
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
	mediaSubscribers          map[string]*Player
	chats                     []Chat
	lastSeek                  time.Time
	idleSince                 time.Time
	lastPlayersSignature      string
	lastPlayerStatusSignature string
	lastStatusSent            time.Time
	state                     VideoState
	youtube                   YouTubeState
	chess                     ChessState
	wordle                    WordleState
	cottage                   CottageState
	mu                        sync.RWMutex
}

type roomRequest struct {
	RoomID  string `json:"roomId,omitempty"`
	MediaID string `json:"mediaId,omitempty"`
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
	if !isValidSocketPlayerID(playerID) {
		http.Error(w, "invalid player id", http.StatusBadRequest)
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

func isValidSocketPlayerID(id string) bool {
	if strings.HasPrefix(id, MediaSubscriberPrefix) {
		return safeID.MatchString(strings.TrimPrefix(id, MediaSubscriberPrefix))
	}
	return safeID.MatchString(id)
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
	if mediaID != "" && !safeID.MatchString(mediaID) {
		http.Error(w, "invalid mediaId", http.StatusBadRequest)
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
	if mediaID != "" && !safeID.MatchString(mediaID) {
		http.Error(w, "invalid mediaId", http.StatusBadRequest)
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
		id:               id,
		mediaID:          mediaID,
		players:          make(map[string]*Player),
		mediaSubscribers: make(map[string]*Player),
		chats:            make([]Chat, 0),
		state:            defaultVideoState(),
		youtube:          defaultYouTubeState(),
		chess:            defaultChessState(),
		wordle:           defaultWordleState(),
		cottage:          defaultCottageState(),
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
	isNewPresence := false
	room.mu.Lock()
	if player.isMediaSubscriber() {
		if existing := room.mediaSubscribers[player.state.Id]; existing != nil {
			old = existing
		}
		room.mediaSubscribers[player.state.Id] = player
	} else {
		if existing := room.players[player.state.Id]; existing != nil {
			old = existing
		} else {
			isNewPresence = true
		}
		room.players[player.state.Id] = player
		player.joined = false
		player.joinMessagePending = isNewPresence
		room.lastPlayersSignature = ""
		room.lastPlayerStatusSignature = ""
		room.lastStatusSent = time.Time{}
	}
	room.idleSince = time.Time{}
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
			len(room.mediaSubscribers) == 0 &&
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
		removed, announced := room.remove(player)
		if announced {
			room.systemChat(displayNameFromSnapshot(removed)+" left", time.Now().UnixMilli(), removed.Time, nil)
		}
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

func (r *Room) remove(player *Player) (PlayerSnapshot, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if player.isMediaSubscriber() {
		if current := r.mediaSubscribers[player.state.Id]; current == player {
			delete(r.mediaSubscribers, player.state.Id)
			if len(r.players) == 0 && len(r.mediaSubscribers) == 0 {
				r.idleSince = time.Now()
			}
		}
		return PlayerSnapshot{}, false
	}

	if current := r.players[player.state.Id]; current != player {
		return PlayerSnapshot{}, false
	}
	removed := player.state
	announceLeave := player.joined && !player.suppressLeaveMessage
	delete(r.players, player.state.Id)
	if len(r.players) == 0 {
		r.state = defaultVideoState()
		r.youtube = defaultYouTubeState()
		r.chess = defaultChessState()
		r.wordle = defaultWordleState()
		r.cottage = defaultCottageState()
		r.lastSeek = time.Time{}
		r.idleSince = time.Now()
		r.lastPlayersSignature = ""
		r.lastPlayerStatusSignature = ""
		r.lastStatusSent = time.Time{}
	}
	return removed, announceLeave
}

func (r *Room) updateMediaID(mediaID string, firedBy *PlayerSnapshot) roomResponse {
	now := time.Now().UnixMilli()
	var targets []*Player
	changed := false

	r.mu.Lock()
	if r.mediaID != mediaID {
		r.applyMediaIDLocked(mediaID, now)
		targets = r.mediaWatchersLocked()
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
	r.wordle = defaultWordleState()
	r.cottage = defaultCottageState()
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
	players := make([]*Player, 0, len(r.players)+len(r.mediaSubscribers))
	for _, player := range r.players {
		players = append(players, player)
	}
	for _, player := range r.mediaSubscribers {
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
		r.setForegroundState(current, payload.State, payload.Paused)
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
	case WordleSync:
		r.syncWordle(current, payload.Wordle)
	case CottageSync:
		r.syncCottage(current, payload.Cottage)
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
	case ExitSync:
		r.kickPlayer(current, payload.TargetID)
	case NewPlayer:
		r.newPlayer(current)
	default:
		log.Printf("[%s] ignored unknown sync type %q", current.state.Id, payload.Type)
	}
}

func (r *Room) kickPlayer(sender *Player, targetID string) {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" || targetID == sender.state.Id || !safeID.MatchString(targetID) {
		return
	}

	var target *Player
	var targetSnapshot PlayerSnapshot
	r.mu.Lock()
	if sender.isMediaSubscriber() || r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = time.Now().Unix()
	target = r.players[targetID]
	if target != nil {
		targetSnapshot = target.state
		target.suppressLeaveMessage = true
	}
	r.mu.Unlock()

	if target != nil {
		r.systemChat(
			displayNameFromSnapshot(targetSnapshot)+" was disconnected by "+displayNameFromSnapshot(sender.state),
			time.Now().UnixMilli(),
			targetSnapshot.Time,
			nil,
		)
		target.kick()
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

func (r *Room) setForegroundState(player *Player, state string, paused *bool) {
	var chats []Chat

	r.mu.Lock()
	if r.players[player.state.Id] != player {
		r.mu.Unlock()
		return
	}
	player.state.LastSeen = time.Now().Unix()
	if paused != nil {
		player.state.Paused = *paused
	}
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
	if sender.isMediaSubscriber() || r.players[sender.state.Id] != sender {
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
	if isMediaMove && !targeted {
		targets = append(targets, r.mediaSubscribersLocked()...)
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
	if mediaID != "" && !safeID.MatchString(mediaID) {
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
	context := map[string]any{
		"tabId":   tabID,
		"whiteId": whiteID,
		"blackId": blackID,
		"winner":  winner,
	}
	if rawReason, ok := raw["reason"].(string); ok {
		reason := trimRunes(strings.TrimSpace(rawReason), 40)
		if reason != "" {
			context["reason"] = reason
		}
	}
	return context, true
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
	timestamp := now.UnixMilli()
	state, ok := sanitizeYouTubeState(incoming, timestamp)
	if !ok {
		return
	}

	var firedBy PlayerSnapshot
	var targets []*Player
	var shouldBroadcast bool

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = now.Unix()
	next, changed := mergeYouTubeState(r.youtube, state, timestamp)
	if changed {
		r.youtube = next
		firedBy = sender.state
		targets = r.playersLocked()
		shouldBroadcast = true
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: YouTubeSync, YouTube: &next, FiredBy: &firedBy, Timestamp: timestamp}
	sendPayloadToPlayers(targets, payload)
}

func mergeYouTubeState(previous YouTubeState, incoming YouTubeState, timestamp int64) (YouTubeState, bool) {
	next := YouTubeState{Tabs: make([]YouTubeTabState, 0, len(previous.Tabs)+len(incoming.Tabs)), UpdatedAt: previous.UpdatedAt}
	incomingByID := make(map[string]YouTubeTabState, len(incoming.Tabs))
	for _, tab := range incoming.Tabs {
		incomingByID[tab.ID] = tab
	}

	seen := make(map[string]bool, len(incoming.Tabs))
	for _, previousTab := range previous.Tabs {
		incomingTab, ok := incomingByID[previousTab.ID]
		if !ok {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		seen[previousTab.ID] = true
		if !previousTab.Open {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		incomingTab.UpdatedAt = timestamp
		next.Tabs = append(next.Tabs, incomingTab)
	}

	for _, incomingTab := range incoming.Tabs {
		if seen[incomingTab.ID] {
			continue
		}
		incomingTab.UpdatedAt = timestamp
		next.Tabs = append(next.Tabs, incomingTab)
	}

	if len(next.Tabs) > maxYouTubeTabs {
		next.Tabs = next.Tabs[len(next.Tabs)-maxYouTubeTabs:]
	}
	changed := shouldBroadcastYouTubeState(previous, next)
	if changed {
		next.UpdatedAt = timestamp
	}
	if !changed && previous.UpdatedAt != next.UpdatedAt {
		next.UpdatedAt = previous.UpdatedAt
	}
	return next, changed
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
		} else if math.Abs(previousTab.Time-nextTab.Time) > youTubeTimeSyncThresholdSeconds {
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
	timestamp := now.UnixMilli()
	state, ok := sanitizeChessState(incoming, timestamp)
	if !ok {
		return
	}

	var firedBy PlayerSnapshot
	var targets []*Player
	var shouldBroadcast bool

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = now.Unix()
	next, changed := mergeChessState(r.chess, state, chessSenderPlayerID(sender), timestamp)
	if changed {
		r.chess = next
		firedBy = sender.state
		targets = r.playersLocked()
		shouldBroadcast = true
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: ChessSync, Chess: &next, FiredBy: &firedBy, Timestamp: timestamp}
	sendPayloadToPlayers(targets, payload)
}

func chessSenderPlayerID(sender *Player) string {
	id := strings.TrimSpace(sender.state.Id)
	return strings.TrimSuffix(id, "-chess")
}

func mergeChessState(previous ChessState, incoming ChessState, senderID string, timestamp int64) (ChessState, bool) {
	next := ChessState{Tabs: make([]ChessTabState, 0, len(previous.Tabs)+len(incoming.Tabs)), UpdatedAt: previous.UpdatedAt}
	incomingByID := make(map[string]ChessTabState, len(incoming.Tabs))
	for _, tab := range incoming.Tabs {
		incomingByID[tab.ID] = tab
	}

	seen := make(map[string]bool, len(incoming.Tabs))
	changed := false
	for _, previousTab := range previous.Tabs {
		incomingTab, ok := incomingByID[previousTab.ID]
		if !ok {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		seen[previousTab.ID] = true
		if !chessTabUpdateAuthorized(previousTab, incomingTab, senderID) {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		if !previousTab.Open {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		incomingTab.UpdatedAt = timestamp
		if !reflect.DeepEqual(previousTab, incomingTab) {
			changed = true
		}
		next.Tabs = append(next.Tabs, incomingTab)
	}

	for _, incomingTab := range incoming.Tabs {
		if seen[incomingTab.ID] {
			continue
		}
		if !chessTabHasPlayer(incomingTab, senderID) {
			continue
		}
		incomingTab.UpdatedAt = timestamp
		next.Tabs = append(next.Tabs, incomingTab)
		changed = true
	}

	if len(next.Tabs) > maxChessTabs {
		next.Tabs = next.Tabs[len(next.Tabs)-maxChessTabs:]
	}
	if changed {
		next.UpdatedAt = timestamp
	}
	if !changed && previous.UpdatedAt != next.UpdatedAt {
		next.UpdatedAt = previous.UpdatedAt
	}
	return next, changed
}

func chessTabUpdateAuthorized(previous ChessTabState, next ChessTabState, senderID string) bool {
	if senderID == "" {
		return false
	}
	wasParticipant := chessTabHasPlayer(previous, senderID)
	if !next.Open {
		return wasParticipant
	}
	if wasParticipant {
		if previous.Phase != "setup" && !chessSamePlayers(previous, next) {
			return false
		}
		if previous.Phase != "setup" && !chessSettingsAllowedAfterSetup(previous.Settings, next.Settings) {
			return false
		}
		return true
	}
	return chessJoinOnly(previous, next, senderID)
}

func chessJoinOnly(previous ChessTabState, next ChessTabState, senderID string) bool {
	if previous.Phase != "setup" {
		return false
	}
	if previous.Open != next.Open ||
		previous.Phase != next.Phase ||
		previous.FEN != next.FEN ||
		!reflect.DeepEqual(previous.Settings, next.Settings) ||
		!reflect.DeepEqual(previous.Moves, next.Moves) ||
		!reflect.DeepEqual(previous.Clocks, next.Clocks) ||
		!reflect.DeepEqual(previous.Result, next.Result) ||
		!reflect.DeepEqual(previous.CloseRequest, next.CloseRequest) ||
		!reflect.DeepEqual(previous.DrawOffer, next.DrawOffer) {
		return false
	}
	return chessPlayersAddOnlySender(previous, next, senderID)
}

func chessPlayersAddOnlySender(previous ChessTabState, next ChessTabState, senderID string) bool {
	changes := 0
	if !chessSeatAddOnlySender(previous.White, next.White, senderID, &changes) {
		return false
	}
	if !chessSeatAddOnlySender(previous.Black, next.Black, senderID, &changes) {
		return false
	}
	return changes == 1
}

func chessSeatAddOnlySender(previous *ChessPlayerState, next *ChessPlayerState, senderID string, changes *int) bool {
	if previous == nil {
		if next == nil {
			return true
		}
		if next.ID != senderID {
			return false
		}
		*changes += 1
		return true
	}
	return reflect.DeepEqual(previous, next)
}

func chessTabHasPlayer(tab ChessTabState, playerID string) bool {
	return chessPlayerID(tab.White) == playerID || chessPlayerID(tab.Black) == playerID
}

func chessPlayerID(player *ChessPlayerState) string {
	if player == nil {
		return ""
	}
	return player.ID
}

func chessSamePlayers(previous ChessTabState, next ChessTabState) bool {
	return reflect.DeepEqual(previous.White, next.White) && reflect.DeepEqual(previous.Black, next.Black)
}

func chessSettingsAllowedAfterSetup(previous ChessSettingsState, next ChessSettingsState) bool {
	return previous.BoardTheme == next.BoardTheme &&
		previous.Timed == next.Timed &&
		previous.Minutes == next.Minutes &&
		previous.IncrementSeconds == next.IncrementSeconds
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
	case "classic", "pixel", "pixel-wood", "pixel-simple":
	default:
		pieceSet = "classic"
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

func (r *Room) syncWordle(sender *Player, incoming *WordleState) {
	now := time.Now()
	timestamp := now.UnixMilli()
	state, ok := sanitizeIncomingWordleState(incoming, timestamp)
	if !ok {
		return
	}

	var firedBy PlayerSnapshot
	var targets []*Player
	var shouldBroadcast bool

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = now.Unix()
	next, changed := mergeWordleState(r.wordle, state, wordleSenderPlayerID(sender), timestamp)
	if changed {
		r.wordle = next
		firedBy = sender.state
		targets = r.playersLocked()
		shouldBroadcast = true
	}
	r.mu.Unlock()

	if !shouldBroadcast {
		return
	}
	payload := SendPayload{Type: WordleSync, Wordle: &next, FiredBy: &firedBy, Timestamp: timestamp}
	sendPayloadToPlayers(targets, payload)
}

func wordleSenderPlayerID(sender *Player) string {
	id := strings.TrimSpace(sender.state.Id)
	return strings.TrimSuffix(id, "-wordle")
}

func mergeWordleState(previous WordleState, incoming WordleState, senderID string, timestamp int64) (WordleState, bool) {
	next := WordleState{Tabs: make([]WordleTabState, 0, len(previous.Tabs)+len(incoming.Tabs)), UpdatedAt: previous.UpdatedAt}
	incomingByID := make(map[string]WordleTabState, len(incoming.Tabs))
	for _, tab := range incoming.Tabs {
		incomingByID[tab.ID] = tab
	}

	seen := make(map[string]bool, len(incoming.Tabs))
	changed := false
	for _, previousTab := range previous.Tabs {
		incomingTab, ok := incomingByID[previousTab.ID]
		if !ok {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		seen[previousTab.ID] = true

		authorized := wordleTabUpdateAuthorized(previousTab, incomingTab, senderID)
		if !authorized {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		if !previousTab.Open {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		if !incomingTab.Open {
			incomingTab.UpdatedAt = timestamp
			if !reflect.DeepEqual(previousTab, incomingTab) {
				changed = true
			}
			next.Tabs = append(next.Tabs, incomingTab)
			continue
		}
		incomingTab, ok = applyWordleSubmissionRules(previousTab, incomingTab, senderID, timestamp)
		if !ok {
			next.Tabs = append(next.Tabs, previousTab)
			continue
		}
		incomingTab.UpdatedAt = timestamp
		if !reflect.DeepEqual(previousTab, incomingTab) {
			changed = true
		}
		next.Tabs = append(next.Tabs, incomingTab)
	}

	for _, incomingTab := range incoming.Tabs {
		if seen[incomingTab.ID] {
			continue
		}
		if !wordleTabHasPlayer(incomingTab, senderID) {
			continue
		}
		if !incomingTab.Open {
			incomingTab.UpdatedAt = timestamp
			next.Tabs = append(next.Tabs, incomingTab)
			changed = true
			continue
		}
		var ok bool
		incomingTab, ok = applyWordleSubmissionRules(WordleTabState{}, incomingTab, senderID, timestamp)
		if !ok {
			continue
		}
		incomingTab.UpdatedAt = timestamp
		next.Tabs = append(next.Tabs, incomingTab)
		changed = true
	}

	if len(next.Tabs) > maxWordleTabs {
		next.Tabs = next.Tabs[len(next.Tabs)-maxWordleTabs:]
	}
	if changed {
		next.UpdatedAt = timestamp
	}
	if !changed && previous.UpdatedAt != next.UpdatedAt {
		next.UpdatedAt = previous.UpdatedAt
	}
	return next, changed
}

func applyWordleSubmissionRules(previous WordleTabState, incoming WordleTabState, senderID string, timestamp int64) (WordleTabState, bool) {
	if incoming.Phase == "setup" {
		return stripWordleGuesses(incoming), true
	}
	validationTab := incoming
	if previous.Phase != "" && previous.Phase != "setup" {
		validationTab = previous
		incoming.Settings = previous.Settings
		incoming.StartedAt = previous.StartedAt
	}
	previousBoards := make(map[string]WordleBoardState, len(previous.Boards))
	for _, board := range previous.Boards {
		previousBoards[board.ID] = board
	}
	for boardIndex, board := range incoming.Boards {
		previousBoard, hasPrevious := previousBoards[board.ID]
		nextBoard, ok := applyWordleBoardSubmissionRules(previousBoard, hasPrevious, validationTab, boardIndex, board, senderID, timestamp)
		if !ok {
			return incoming, false
		}
		incoming.Boards[boardIndex] = nextBoard
	}
	return stripWordleGuesses(incoming), true
}

func applyWordleBoardSubmissionRules(
	previous WordleBoardState,
	hasPrevious bool,
	tab WordleTabState,
	boardIndex int,
	board WordleBoardState,
	senderID string,
	timestamp int64,
) (WordleBoardState, bool) {
	if hasPrevious && previous.Finished {
		return previous, true
	}
	answer := wordleAnswerForBoard(tab, boardIndex)
	rows := make([]WordleRowState, len(board.Rows))
	foundOpenRow := false
	for rowIndex, row := range board.Rows {
		previousRow := WordleRowState{}
		hasPreviousRow := hasPrevious && rowIndex < len(previous.Rows)
		if hasPreviousRow {
			previousRow = previous.Rows[rowIndex]
		}
		if row.Submitted && foundOpenRow {
			return board, false
		}
		if hasPreviousRow && previousRow.Submitted && !row.Submitted {
			previousRow.Guess = ""
			rows[rowIndex] = previousRow
			continue
		}
		if row.Submitted {
			if row.Guess != "" {
				if !wordleCanSubmitBoard(tab, board, senderID) ||
					(hasPrevious && rowIndex != previous.CurrentRow) ||
					!isValidWordleGuess(row.Guess) {
					return board, false
				}
				rows[rowIndex] = WordleRowState{
					Statuses:  scoreWordleGuess(row.Guess, answer),
					Typed:     5,
					Submitted: true,
					PlayerID:  senderID,
				}
				continue
			}
			if hasPreviousRow && previousRow.Submitted {
				previousRow.Guess = ""
				rows[rowIndex] = previousRow
				continue
			}
			return board, false
		}
		row.Guess = ""
		rows[rowIndex] = row
		foundOpenRow = true
	}

	currentRow := 0
	solved := false
	for currentRow < len(rows) && rows[currentRow].Submitted {
		if wordleStatusesSolved(rows[currentRow].Statuses) {
			solved = true
			currentRow += 1
			break
		}
		currentRow += 1
	}
	if currentRow > tab.Settings.Turns {
		currentRow = tab.Settings.Turns
	}
	finished := solved || currentRow >= tab.Settings.Turns
	finishedAt := int64(0)
	if finished {
		if hasPrevious && previous.FinishedAt > 0 {
			finishedAt = previous.FinishedAt
		} else if board.FinishedAt > 0 {
			finishedAt = board.FinishedAt
		} else {
			finishedAt = timestamp
		}
	}

	board.Rows = rows
	board.CurrentRow = currentRow
	board.Solved = solved
	board.Finished = finished
	board.FinishedAt = finishedAt
	return board, true
}

func stripWordleGuesses(tab WordleTabState) WordleTabState {
	for boardIndex := range tab.Boards {
		for rowIndex := range tab.Boards[boardIndex].Rows {
			tab.Boards[boardIndex].Rows[rowIndex].Guess = ""
		}
	}
	return tab
}

func wordleCanSubmitBoard(tab WordleTabState, board WordleBoardState, senderID string) bool {
	if senderID == "" {
		return false
	}
	if tab.Settings.Mode == "coop" {
		return tab.TurnPlayerID == senderID && tab.ActiveBoardID == board.ID
	}
	return board.PlayerID == senderID
}

func isValidWordleGuess(guess string) bool {
	_, ok := wordleWordSet[strings.ToUpper(strings.TrimSpace(guess))]
	return ok
}

func wordleAnswerForBoard(tab WordleTabState, boardIndex int) string {
	seed := "setup"
	if tab.StartedAt > 0 {
		seed = strconv.FormatInt(tab.StartedAt, 10)
	}
	base := hashToWordleAnswerIndex(tab.ID + ":" + seed)
	if tab.Settings.Mode == "coop" {
		base = (base + boardIndex) % len(wordleWords)
	}
	return wordleWords[base]
}

func hashToWordleAnswerIndex(value string) int {
	if len(wordleWords) == 0 {
		return 0
	}
	var hash uint32
	for index := 0; index < len(value); index += 1 {
		hash = hash*31 + uint32(value[index])
	}
	return int(hash % uint32(len(wordleWords)))
}

func scoreWordleGuess(guess string, answer string) []string {
	guess = strings.ToUpper(strings.TrimSpace(guess))
	answer = strings.ToUpper(strings.TrimSpace(answer))
	statuses := []string{"absent", "absent", "absent", "absent", "absent"}
	remaining := make(map[byte]int, 5)
	for index := 0; index < 5; index += 1 {
		if guess[index] == answer[index] {
			statuses[index] = "correct"
			continue
		}
		remaining[answer[index]] += 1
	}
	for index := 0; index < 5; index += 1 {
		if statuses[index] == "correct" {
			continue
		}
		count := remaining[guess[index]]
		if count > 0 {
			statuses[index] = "present"
			remaining[guess[index]] = count - 1
		}
	}
	return statuses
}

func wordleStatusesSolved(statuses []string) bool {
	if len(statuses) < 5 {
		return false
	}
	for index := 0; index < 5; index += 1 {
		if statuses[index] != "correct" {
			return false
		}
	}
	return true
}

func wordleTabUpdateAuthorized(previous WordleTabState, next WordleTabState, senderID string) bool {
	if senderID == "" {
		return false
	}
	wasParticipant := wordleTabHasPlayer(previous, senderID)
	if !next.Open {
		return wasParticipant
	}
	if wasParticipant {
		if previous.Phase == "playing" && !reflect.DeepEqual(previous.Players, next.Players) {
			return false
		}
		return true
	}
	return wordleJoinOnly(previous, next, senderID)
}

func wordleJoinOnly(previous WordleTabState, next WordleTabState, senderID string) bool {
	if previous.Phase != "setup" {
		return false
	}
	if !wordleTabHasPlayer(next, senderID) {
		return false
	}
	if previous.Open != next.Open ||
		previous.Phase != next.Phase ||
		previous.ActiveBoardID != next.ActiveBoardID ||
		previous.TurnPlayerID != next.TurnPlayerID ||
		previous.StartedAt != next.StartedAt ||
		!reflect.DeepEqual(previous.Settings, next.Settings) ||
		!reflect.DeepEqual(previous.Result, next.Result) {
		return false
	}
	if !wordlePlayersAddOnlySender(previous.Players, next.Players, senderID) {
		return false
	}
	return wordleBoardsJoinOnly(previous.Boards, next.Boards, senderID)
}

func wordlePlayersAddOnlySender(previous []WordlePlayerState, next []WordlePlayerState, senderID string) bool {
	if len(next) != len(previous)+1 {
		return false
	}
	previousByID := make(map[string]WordlePlayerState, len(previous))
	for _, player := range previous {
		previousByID[player.ID] = player
	}
	foundSender := false
	for _, player := range next {
		if player.ID == senderID {
			if foundSender {
				return false
			}
			foundSender = true
			continue
		}
		previousPlayer, ok := previousByID[player.ID]
		if !ok || !reflect.DeepEqual(previousPlayer, player) {
			return false
		}
	}
	return foundSender
}

func wordleBoardsJoinOnly(previous []WordleBoardState, next []WordleBoardState, senderID string) bool {
	previousByID := make(map[string]WordleBoardState, len(previous))
	for _, board := range previous {
		previousByID[board.ID] = board
	}
	seenPrevious := make(map[string]bool, len(previous))
	usedSenderBoard := false
	for _, board := range next {
		previousBoard, ok := previousByID[board.ID]
		if ok {
			if !reflect.DeepEqual(previousBoard, board) {
				return false
			}
			seenPrevious[board.ID] = true
			continue
		}
		if board.PlayerID != senderID || usedSenderBoard {
			return false
		}
		usedSenderBoard = true
	}
	return len(seenPrevious) == len(previous)
}

func wordleTabHasPlayer(tab WordleTabState, playerID string) bool {
	for _, player := range tab.Players {
		if player.ID == playerID {
			return true
		}
	}
	return false
}

func sanitizeWordleState(incoming *WordleState, timestamp int64) (WordleState, bool) {
	return sanitizeWordleStateWithGuessOption(incoming, timestamp, false)
}

func sanitizeIncomingWordleState(incoming *WordleState, timestamp int64) (WordleState, bool) {
	return sanitizeWordleStateWithGuessOption(incoming, timestamp, true)
}

func sanitizeWordleStateWithGuessOption(incoming *WordleState, timestamp int64, keepGuesses bool) (WordleState, bool) {
	if incoming == nil {
		return WordleState{}, false
	}

	state := defaultWordleState()
	seen := make(map[string]bool, len(incoming.Tabs))
	for _, rawTab := range incoming.Tabs {
		if len(state.Tabs) >= maxWordleTabs {
			break
		}
		tab, ok := sanitizeWordleTab(rawTab, timestamp, keepGuesses)
		if !ok || seen[tab.ID] {
			continue
		}
		seen[tab.ID] = true
		state.Tabs = append(state.Tabs, tab)
	}
	if len(incoming.Tabs) > 0 && len(state.Tabs) == 0 {
		return WordleState{}, false
	}
	state.UpdatedAt = timestamp
	return state, true
}

func sanitizeWordleTab(rawTab WordleTabState, timestamp int64, keepGuesses bool) (WordleTabState, bool) {
	id := strings.TrimSpace(rawTab.ID)
	if !safeID.MatchString(id) {
		return WordleTabState{}, false
	}
	settings := sanitizeWordleSettings(rawTab.Settings)
	phase := sanitizeWordlePhase(rawTab.Phase)
	tab := WordleTabState{
		ID:        id,
		Open:      rawTab.Open,
		Phase:     phase,
		Settings:  settings,
		Players:   sanitizeWordlePlayers(rawTab.Players),
		StartedAt: rawTab.StartedAt,
		Result:    sanitizeWordleResult(rawTab.Result),
		UpdatedAt: timestamp,
	}
	if rawTab.UpdatedAt > 0 {
		tab.UpdatedAt = rawTab.UpdatedAt
	}
	if tab.StartedAt < 0 {
		tab.StartedAt = 0
	}

	if phase == "setup" {
		tab.Result = nil
		return tab, true
	}

	tab.Boards = sanitizeWordleBoards(rawTab.Boards, settings.Turns, timestamp, keepGuesses)
	activeBoardID := strings.TrimSpace(rawTab.ActiveBoardID)
	if safeID.MatchString(activeBoardID) {
		tab.ActiveBoardID = activeBoardID
	}
	if tab.ActiveBoardID == "" && len(tab.Boards) > 0 {
		tab.ActiveBoardID = tab.Boards[0].ID
	}
	turnPlayerID := strings.TrimSpace(rawTab.TurnPlayerID)
	if safeID.MatchString(turnPlayerID) && wordlePlayersContain(tab.Players, turnPlayerID) {
		tab.TurnPlayerID = turnPlayerID
	}
	if tab.TurnPlayerID == "" && settings.Mode == "coop" && len(tab.Players) > 0 {
		tab.TurnPlayerID = tab.Players[0].ID
	}
	if phase == "playing" {
		tab.Result = nil
	}
	return tab, true
}

func sanitizeWordlePhase(value string) string {
	switch strings.TrimSpace(value) {
	case "playing", "ended":
		return strings.TrimSpace(value)
	default:
		return "setup"
	}
}

func sanitizeWordleSettings(settings WordleSettingsState) WordleSettingsState {
	mode := strings.TrimSpace(settings.Mode)
	if mode != "coop" {
		mode = "competitive"
	}
	turns := settings.Turns
	if turns <= 0 {
		turns = 6
	}
	if turns > maxWordleTurns {
		turns = maxWordleTurns
	}
	return WordleSettingsState{Mode: mode, Turns: turns}
}

func sanitizeWordlePlayers(players []WordlePlayerState) []WordlePlayerState {
	if len(players) == 0 {
		return nil
	}
	sanitized := make([]WordlePlayerState, 0, len(players))
	seen := make(map[string]bool, len(players))
	for _, player := range players {
		id := strings.TrimSpace(player.ID)
		if !safeID.MatchString(id) || seen[id] {
			continue
		}
		seen[id] = true
		name := trimRunes(strings.TrimSpace(player.Name), 80)
		if name == "" {
			name = "Player"
		}
		profileID := strings.TrimSpace(player.ProfileID)
		if profileID != "" && !safeID.MatchString(profileID) {
			profileID = ""
		}
		sanitized = append(sanitized, WordlePlayerState{ID: id, Name: name, ProfileID: profileID})
	}
	return sanitized
}

func sanitizeWordleBoards(boards []WordleBoardState, turns int, timestamp int64, keepGuesses bool) []WordleBoardState {
	if len(boards) == 0 {
		return nil
	}
	sanitized := make([]WordleBoardState, 0, len(boards))
	seen := make(map[string]bool, len(boards))
	for _, raw := range boards {
		id := strings.TrimSpace(raw.ID)
		if !safeID.MatchString(id) || seen[id] {
			continue
		}
		seen[id] = true
		playerID := strings.TrimSpace(raw.PlayerID)
		if playerID != "" && !safeID.MatchString(playerID) {
			playerID = ""
		}
		currentRow := raw.CurrentRow
		if currentRow < 0 {
			currentRow = 0
		}
		if currentRow > turns {
			currentRow = turns
		}
		finishedAt := raw.FinishedAt
		if finishedAt < 0 {
			finishedAt = 0
		}
		finished := raw.Finished || raw.Solved || currentRow >= turns
		if finished && finishedAt == 0 {
			finishedAt = timestamp
		}
		sanitized = append(sanitized, WordleBoardState{
			ID:         id,
			PlayerID:   playerID,
			Rows:       sanitizeWordleRows(raw.Rows, turns, keepGuesses),
			CurrentRow: currentRow,
			Solved:     raw.Solved,
			Finished:   finished,
			FinishedAt: finishedAt,
		})
	}
	return sanitized
}

func sanitizeWordleRows(rows []WordleRowState, turns int, keepGuesses bool) []WordleRowState {
	sanitized := make([]WordleRowState, turns)
	for i := range sanitized {
		if i >= len(rows) {
			sanitized[i] = defaultWordleRow()
			continue
		}
		raw := rows[i]
		typed := raw.Typed
		if typed < 0 {
			typed = 0
		}
		if typed > 5 {
			typed = 5
		}
		submitted := raw.Submitted
		if submitted {
			typed = 5
		}
		playerID := strings.TrimSpace(raw.PlayerID)
		if playerID != "" && !safeID.MatchString(playerID) {
			playerID = ""
		}
		guess := ""
		if keepGuesses && submitted {
			guess = sanitizeWordleGuess(raw.Guess)
		}
		statuses := make([]string, 5)
		for index := range statuses {
			rawStatus := ""
			if index < len(raw.Statuses) {
				rawStatus = raw.Statuses[index]
			}
			statuses[index] = sanitizeWordleTileStatus(rawStatus, submitted, index < typed)
		}
		sanitized[i] = WordleRowState{
			Statuses:  statuses,
			Typed:     typed,
			Submitted: submitted,
			PlayerID:  playerID,
			Guess:     guess,
		}
	}
	return sanitized
}

func sanitizeWordleGuess(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if safeWordleGuess.MatchString(value) {
		return value
	}
	return ""
}

func defaultWordleRow() WordleRowState {
	return WordleRowState{
		Statuses: []string{"empty", "empty", "empty", "empty", "empty"},
	}
}

func sanitizeWordleTileStatus(value string, submitted bool, typed bool) string {
	value = strings.TrimSpace(value)
	if submitted {
		switch value {
		case "absent", "present", "correct":
			return value
		default:
			return "absent"
		}
	}
	if typed {
		return "typed"
	}
	return "empty"
}

func sanitizeWordleResult(result *WordleResultState) *WordleResultState {
	if result == nil {
		return nil
	}
	winners := make([]string, 0, len(result.WinnerIDs))
	seen := make(map[string]bool, len(result.WinnerIDs))
	for _, rawID := range result.WinnerIDs {
		id := strings.TrimSpace(rawID)
		if !safeID.MatchString(id) || seen[id] {
			continue
		}
		seen[id] = true
		winners = append(winners, id)
	}
	message := trimRunes(strings.TrimSpace(result.Message), 160)
	return &WordleResultState{WinnerIDs: winners, Message: message}
}

func wordlePlayersContain(players []WordlePlayerState, playerID string) bool {
	for _, player := range players {
		if player.ID == playerID {
			return true
		}
	}
	return false
}

func (r *Room) syncCottage(sender *Player, incoming *CottageState) {
	now := time.Now()
	timestamp := now.UnixMilli()
	state, ok := sanitizeCottageState(incoming, timestamp)
	if !ok {
		return
	}
	if len(state.Players) == 0 {
		r.sendCottageSnapshot(sender, timestamp)
		return
	}

	var firedBy PlayerSnapshot
	var targets []*Player
	var delta CottageState
	shouldBroadcast := false

	r.mu.Lock()
	if r.players[sender.state.Id] != sender {
		r.mu.Unlock()
		return
	}
	sender.state.LastSeen = now.Unix()
	next, changedPlayers, changed := mergeCottageState(r.cottage, state.Players, timestamp)
	if changed {
		r.cottage = next
		firedBy = sender.state
		targets = r.otherPlayersLocked(sender)
		delta = CottageState{Players: changedPlayers, UpdatedAt: next.UpdatedAt}
		shouldBroadcast = true
	}
	r.mu.Unlock()

	if !shouldBroadcast || len(targets) == 0 {
		return
	}
	payload := SendPayload{Type: CottageSync, Cottage: &delta, FiredBy: &firedBy, Timestamp: timestamp}
	sendPayloadToPlayers(targets, payload)
}

func (r *Room) sendCottageSnapshot(sender *Player, timestamp int64) {
	var cottage CottageState
	shouldSend := false

	r.mu.Lock()
	if r.players[sender.state.Id] == sender {
		sender.state.LastSeen = time.Now().Unix()
		cottage = cloneCottageState(r.cottage)
		shouldSend = len(cottage.Players) > 0
	}
	r.mu.Unlock()

	if !shouldSend {
		return
	}
	sender.sendJSON(SendPayload{Type: CottageSync, Cottage: &cottage, Timestamp: timestamp})
}

func sanitizeCottageState(incoming *CottageState, timestamp int64) (CottageState, bool) {
	if incoming == nil {
		return CottageState{}, false
	}

	state := defaultCottageState()
	seen := make(map[string]bool, len(incoming.Players))
	for _, rawPlayer := range incoming.Players {
		if len(state.Players) >= maxCottagePlayers {
			break
		}
		player, ok := sanitizeCottagePlayer(rawPlayer, timestamp)
		if !ok || seen[player.ID] {
			continue
		}
		seen[player.ID] = true
		state.Players = append(state.Players, player)
	}
	if len(incoming.Players) > 0 && len(state.Players) == 0 {
		return CottageState{}, false
	}
	if len(state.Players) > 0 {
		sort.Slice(state.Players, func(i, j int) bool {
			return state.Players[i].ID < state.Players[j].ID
		})
		state.UpdatedAt = timestamp
	}
	return state, true
}

func sanitizeCottagePlayer(raw CottagePlayerState, timestamp int64) (CottagePlayerState, bool) {
	id := strings.TrimSpace(raw.ID)
	if !safeCottagePlayerID.MatchString(id) {
		return CottagePlayerState{}, false
	}

	name := trimRunes(strings.TrimSpace(raw.Name), 80)
	if name == "" {
		name = "Guest"
	}

	profileID := strings.TrimSpace(raw.ProfileID)
	if profileID != "" && !safeID.MatchString(profileID) {
		profileID = ""
	}

	x, ok := sanitizeCottageCoordinate(raw.X, cottageMinX, cottageMaxX)
	if !ok {
		return CottagePlayerState{}, false
	}
	y, ok := sanitizeCottageCoordinate(raw.Y, cottageMinY, cottageMaxY)
	if !ok {
		return CottagePlayerState{}, false
	}

	player := CottagePlayerState{
		ID:        id,
		Name:      name,
		ProfileID: profileID,
		X:         x,
		Y:         y,
		Action:    sanitizeCottageAction(raw.Action),
		Facing:    sanitizeCottageFacing(raw.Facing),
		UpdatedAt: timestamp,
	}

	if targetX, hasTargetX := sanitizeOptionalCottageCoordinate(raw.TargetX, cottageMinX, cottageMaxX); hasTargetX {
		if targetY, hasTargetY := sanitizeOptionalCottageCoordinate(raw.TargetY, cottageMinY, cottageMaxY); hasTargetY {
			player.TargetX = targetX
			player.TargetY = targetY
		}
	}

	interactionID := strings.TrimSpace(raw.InteractionID)
	if interactionID != "" && safeID.MatchString(interactionID) {
		player.InteractionID = interactionID
	}

	return player, true
}

func sanitizeCottageCoordinate(value float64, minValue float64, maxValue float64) (float64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return math.Min(maxValue, math.Max(minValue, value)), true
}

func sanitizeOptionalCottageCoordinate(value *float64, minValue float64, maxValue float64) (*float64, bool) {
	if value == nil {
		return nil, false
	}
	coordinate, ok := sanitizeCottageCoordinate(*value, minValue, maxValue)
	if !ok {
		return nil, false
	}
	return &coordinate, true
}

func sanitizeCottageAction(value string) string {
	switch strings.TrimSpace(value) {
	case "walking", "sitting", "sleeping", "interacting":
		return strings.TrimSpace(value)
	default:
		return "idle"
	}
}

func sanitizeCottageFacing(value string) string {
	switch strings.TrimSpace(value) {
	case "up", "left", "right":
		return strings.TrimSpace(value)
	default:
		return "down"
	}
}

func mergeCottageState(previous CottageState, updates []CottagePlayerState, timestamp int64) (CottageState, []CottagePlayerState, bool) {
	if len(updates) == 0 {
		return previous, nil, false
	}

	playersByID := make(map[string]CottagePlayerState, len(previous.Players)+len(updates))
	for _, player := range previous.Players {
		playersByID[player.ID] = player
	}

	changedPlayers := make([]CottagePlayerState, 0, len(updates))
	for _, update := range updates {
		update.UpdatedAt = timestamp
		existing, exists := playersByID[update.ID]
		if exists && sameCottagePlayerState(existing, update) {
			continue
		}
		playersByID[update.ID] = update
		changedPlayers = append(changedPlayers, update)
	}
	if len(changedPlayers) == 0 {
		return previous, nil, false
	}

	players := cottagePlayersFromMap(playersByID)
	if len(players) > maxCottagePlayers {
		sort.Slice(players, func(i, j int) bool {
			if players[i].UpdatedAt == players[j].UpdatedAt {
				return players[i].ID < players[j].ID
			}
			return players[i].UpdatedAt > players[j].UpdatedAt
		})
		players = players[:maxCottagePlayers]
		playersByID = make(map[string]CottagePlayerState, len(players))
		for _, player := range players {
			playersByID[player.ID] = player
		}
		filteredChangedPlayers := changedPlayers[:0]
		for _, player := range changedPlayers {
			if _, ok := playersByID[player.ID]; ok {
				filteredChangedPlayers = append(filteredChangedPlayers, player)
			}
		}
		changedPlayers = filteredChangedPlayers
	}

	sortCottagePlayersByID(players)
	sortCottagePlayersByID(changedPlayers)
	return CottageState{Players: players, UpdatedAt: timestamp}, changedPlayers, true
}

func cottagePlayersFromMap(playersByID map[string]CottagePlayerState) []CottagePlayerState {
	players := make([]CottagePlayerState, 0, len(playersByID))
	for _, player := range playersByID {
		players = append(players, player)
	}
	return players
}

func sortCottagePlayersByID(players []CottagePlayerState) {
	sort.Slice(players, func(i, j int) bool {
		return players[i].ID < players[j].ID
	})
}

func cloneCottageState(state CottageState) CottageState {
	return CottageState{
		Players:   append([]CottagePlayerState(nil), state.Players...),
		UpdatedAt: state.UpdatedAt,
	}
}

func sameCottagePlayerState(left CottagePlayerState, right CottagePlayerState) bool {
	return left.ID == right.ID &&
		left.Name == right.Name &&
		left.ProfileID == right.ProfileID &&
		sameCottageCoordinate(left.X, right.X) &&
		sameCottageCoordinate(left.Y, right.Y) &&
		sameOptionalCottageCoordinate(left.TargetX, right.TargetX) &&
		sameOptionalCottageCoordinate(left.TargetY, right.TargetY) &&
		left.Action == right.Action &&
		left.Facing == right.Facing &&
		left.InteractionID == right.InteractionID
}

func sameCottageCoordinate(left float64, right float64) bool {
	return math.Abs(left-right) <= 0.01
}

func sameOptionalCottageCoordinate(left *float64, right *float64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return sameCottageCoordinate(*left, *right)
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

func (r *Room) systemChat(message string, timestamp int64, mediaSec float64, targets []*Player) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if timestamp == 0 {
		timestamp = time.Now().UnixMilli()
	}
	messageRunes := []rune(message)
	if len(messageRunes) > maxChatLength {
		message = string(messageRunes[:maxChatLength])
	}

	var sendTargets []*Player
	chat := Chat{
		Message:       message,
		Uid:           "system",
		Timestamp:     timestamp,
		MediaSec:      mediaSec,
		IsStateUpdate: true,
		IsSystem:      true,
	}

	r.mu.Lock()
	r.chats = append(r.chats, chat)
	if len(r.chats) > maxChatMessages {
		r.chats = append([]Chat(nil), r.chats[len(r.chats)-maxChatMessages:]...)
	}
	if targets == nil {
		sendTargets = r.playersLocked()
	} else {
		sendTargets = append([]*Player(nil), targets...)
	}
	r.mu.Unlock()

	payload := SendPayload{Type: ChatSync, Chat: &chat, Timestamp: time.Now().UnixMilli()}
	sendPayloadToPlayers(sendTargets, payload)
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

func displayNameFromSnapshot(snapshot PlayerSnapshot) string {
	if snapshot.DiscordUser != nil {
		if name := strings.TrimSpace(optionalString(snapshot.DiscordUser.GlobalName)); name != "" {
			return name
		}
		if name := strings.TrimSpace(snapshot.DiscordUser.Username); name != "" {
			return name
		}
	}
	if name := strings.TrimSpace(snapshot.Name); name != "" {
		return name
	}
	return "Unknown"
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
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
	if math.Abs(r.state.Time-sender.state.Time) > roomTimeSyncThresholdSeconds && r.lastSeek.Add(time.Second).Before(time.Now()) {
		shouldBroadcast = !sender.state.InBg
		r.lastSeek = time.Now()
	}
	r.state.Time = sender.state.Time
	firedBy = sender.state
	if shouldBroadcast {
		targets = r.otherPlayersLocked(sender)
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
		targets = r.otherPlayersLocked(sender)
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
	var wordle WordleState
	var cottage CottageState
	var chats []Chat
	var joinMessage string
	var joinTimestamp int64

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
	wordle = r.wordle
	cottage = cloneCottageState(r.cottage)
	chats = append([]Chat(nil), r.chats...)
	if sender.joinMessagePending {
		sender.joined = true
		sender.joinMessagePending = false
		joinTimestamp = time.Now().UnixMilli()
		joinMessage = displayNameFromSnapshot(sender.state) + " joined"
	}
	r.mu.Unlock()

	sender.sendJSON(SendPayload{Type: TimeSync, Time: &roomTime, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: PauseSync, Paused: &roomPaused, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: YouTubeSync, YouTube: &youtube, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: ChessSync, Chess: &chess, Timestamp: time.Now().UnixMilli()})
	sender.sendJSON(SendPayload{Type: WordleSync, Wordle: &wordle, Timestamp: time.Now().UnixMilli()})
	if len(cottage.Players) > 0 {
		sender.sendJSON(SendPayload{Type: CottageSync, Cottage: &cottage, Timestamp: time.Now().UnixMilli()})
	}
	if len(chats) > 0 {
		sender.sendJSON(SendPayload{Type: ChatSync, Chats: chats, Timestamp: time.Now().UnixMilli()})
	}
	if joinMessage != "" {
		r.systemChat(joinMessage, joinTimestamp, roomTime, nil)
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

func (r *Room) mediaSubscribersLocked() []*Player {
	players := make([]*Player, 0, len(r.mediaSubscribers))
	for _, player := range r.mediaSubscribers {
		players = append(players, player)
	}
	return players
}

func (r *Room) mediaWatchersLocked() []*Player {
	players := make([]*Player, 0, len(r.players)+len(r.mediaSubscribers))
	for _, player := range r.players {
		players = append(players, player)
	}
	for _, player := range r.mediaSubscribers {
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
