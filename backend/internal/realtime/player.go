package realtime

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 50 * time.Second
	maxMessage = 64 * 1024
)

type Player struct {
	conn *websocket.Conn
	send chan []byte

	state PlayerSnapshot

	sendMu sync.Mutex
	closed bool
}

func newPlayer(conn *websocket.Conn, id string) *Player {
	p := &Player{
		conn: conn,
		send: make(chan []byte, 32),
		state: PlayerSnapshot{
			VideoState:  defaultVideoState(),
			PlayerState: PlayerState{Id: id, LastSeen: time.Now().Unix()},
		},
	}
	return p
}

func (p *Player) isMediaSubscriber() bool {
	return strings.HasPrefix(p.state.Id, MediaSubscriberPrefix)
}

func (p *Player) sendJSON(message any) bool {
	payload, err := json.Marshal(message)
	if err != nil {
		log.Printf("marshal websocket payload: %v", err)
		return false
	}
	return p.sendRaw(payload)
}

func (p *Player) sendRaw(payload []byte) bool {
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	if p.closed {
		return false
	}
	select {
	case p.send <- payload:
		return true
	default:
		log.Printf("closing slow websocket client %q", p.state.Id)
		_ = p.conn.Close()
		return false
	}
}

func (p *Player) closeSend() {
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	if p.closed {
		return
	}
	p.closed = true
	close(p.send)
}

func (p *Player) kick() {
	p.sendJSON(SendPayload{Type: ExitSync, Timestamp: time.Now().UnixMilli()})
	if p.conn == nil {
		return
	}
	_ = p.conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, "replaced by a newer connection"),
		time.Now().Add(writeWait),
	)
	_ = p.conn.Close()
}

func (p *Player) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = p.conn.Close()
	}()

	for {
		select {
		case message, ok := <-p.send:
			_ = p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = p.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			writer, err := p.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			if _, err := writer.Write(message); err != nil {
				_ = writer.Close()
				return
			}
			if err := writer.Close(); err != nil {
				return
			}
		case <-ticker.C:
			_ = p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := p.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
