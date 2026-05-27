package main

import (
	"Sparkle/cleanup"
	"Sparkle/config"
	"Sparkle/discord"
	"Sparkle/job"
	"Sparkle/utils"
	"encoding/json"
	"github.com/go-co-op/gocron"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	log "github.com/sirupsen/logrus"
	"golang.org/x/net/websocket"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

var scheduler = gocron.NewScheduler(time.Now().Location())
var wss sync.Map // map[string]*Room
var e *echo.Echo

const (
	NewPlayer         = "new player"
	ProfileSync       = "profile"
	TimeSync          = "time"
	PauseSync         = "pause"
	ChatSync          = "chat"
	PlayersStatusSync = "players"
	PfpSync           = "pfp"
	StateSync         = "state"
	BroadcastSync     = "broadcast"
	ExitSync          = "exit"
	CodecSwitch       = "codec"
	AudioSwitch       = "audio"
	SubtitleSwitch    = "subtitle"
)

type Room struct {
	Players  map[string]*Player
	mutex    sync.RWMutex
	id       string
	Chats    []*discord.Chat `json:"chats"`
	LastSeek time.Time       `json:"lastSeek"`
	VideoState
}

type Player struct {
	ws *websocket.Conn
	VideoState
	PlayerState
	exited bool
}

type PlayerState struct {
	Name        string `json:"name"`
	Id          string `json:"id"`
	InBg        bool   `json:"inBg,omitempty"`
	LastSeen    int64  `json:"lastSeen"`
	codec       string
	audio       string
	subtitle    string
	DiscordUser *DiscordUser `json:"discordUser,omitempty"`
}

type DiscordUser struct {
	Username      string `json:"username"`
	Discriminator string `json:"discriminator"`
	ID            string `json:"id"`
	// PublicFlags   int     `json:"public_flags"`
	Avatar     *string `json:"avatar,omitempty"`
	GlobalName *string `json:"global_name,omitempty"`
}

type VideoState struct {
	Time   float64 `json:"time"`
	Paused bool    `json:"paused"`
}

type PlayerPayload struct {
	Type        string                 `json:"type"`
	Time        *float64               `json:"time"`
	Name        string                 `json:"name"`
	DiscordUser *DiscordUser           `json:"discordUser,omitempty"`
	Paused      *bool                  `json:"paused"`
	Chat        string                 `json:"chat"`
	State       string                 `json:"state"`
	Broadcast   map[string]interface{} `json:"broadcast,omitempty"`
	Codec       string                 `json:"codec,omitempty"`
	Audio       string                 `json:"audio,omitempty"`
	Subtitle    string                 `json:"subtitle,omitempty"`
}

type SendPayload struct {
	Type      string                 `json:"type"`
	Time      *float64               `json:"time,omitempty"`
	Paused    *bool                  `json:"paused,omitempty"`
	FiredBy   *Player                `json:"firedBy,omitempty"`
	Chats     []*discord.Chat        `json:"chats,omitempty"`
	Players   []Player               `json:"players"`
	Timestamp int64                  `json:"timestamp"`
	Broadcast map[string]interface{} `json:"broadcast,omitempty"`
}

func (room *Room) syncChatsToPlayerUnsafe(player *Player) {
	if len(room.Chats) > 0 {
		player.Send(SendPayload{Type: ChatSync, Chats: room.Chats, Timestamp: time.Now().UnixMilli()})
	}
}

func defaultVideoState() VideoState {
	return VideoState{Time: 0, Paused: true}
}

func (player *Player) Send(message interface{}) {
	messageStr := ""
	switch message.(type) {
	case string:
		messageStr = message.(string)
	case []byte:
		messageStr = string(message.([]byte))
	default:
		messageBytes, err := json.Marshal(message)
		if err != nil {
			discord.Errorf("error marshalling message: %v", err)
			return
		}
		messageStr = string(messageBytes)
	}
	err := websocket.Message.Send(player.ws, messageStr)
	if err != nil {
		discord.Errorf("error sending message: %v", err)
		return
	}
}

func (player *Player) Sync(t *float64, paused *bool, firedBy *Player) {
	if firedBy != nil && firedBy.InBg {
		return
	}
	if t != nil {
		player.Send(SendPayload{Type: TimeSync, Time: t, FiredBy: firedBy, Timestamp: time.Now().UnixMilli()})
	}
	if paused != nil {
		player.Send(SendPayload{Type: PauseSync, Paused: paused, FiredBy: firedBy, Timestamp: time.Now().UnixMilli()})
	}
}

func syncPlayerStates() {
	wss.Range(func(key, value interface{}) bool {
		room := value.(*Room)
		playersStatusListSorted := make([]Player, 0)
		func() {
			room.mutex.RLock()
			defer room.mutex.RUnlock()
			for _, player := range room.Players {
				if player.Name == "" {
					continue
				}
				playersStatusListSorted = append(playersStatusListSorted,
					Player{PlayerState: player.PlayerState, VideoState: player.VideoState})
			}
			if len(playersStatusListSorted) == 0 {
				return
			}
			sort.Slice(playersStatusListSorted, func(i, j int) bool {
				if playersStatusListSorted[i].Name == playersStatusListSorted[j].Name {
					return playersStatusListSorted[i].Id < playersStatusListSorted[j].Id
				}
				return playersStatusListSorted[i].Name < playersStatusListSorted[j].Name
			})
			playersStatusListSortedStr, err := json.Marshal(SendPayload{Type: PlayersStatusSync, Players: playersStatusListSorted, Timestamp: time.Now().UnixMilli()})
			if err != nil {
				discord.Errorf("error marshalling players status: %v", err)
				return
			}
			for _, player := range room.Players {
				player.Send(string(playersStatusListSortedStr))
			}
		}()
		return true
	})
}

func REST() {
	_, err := job.JobsCache.Get(true)
	if err != nil {
		discord.Errorf("error initializing jobs: %v", err)
	}
	scheduler.Every(1).Second().Do(syncPlayerStates)
	scheduler.StartAsync()
	e = echo.New()
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     []string{"*"},
		AllowCredentials: true,
	}), middleware.GzipWithConfig(middleware.DefaultGzipConfig), middleware.Logger(), middleware.Recover())
	routes()
	cleanup.AddOnStopFunc(func(_ os.Signal) {
		err := e.Close()
		if err != nil {
			return
		}
	})
	e.Logger.Fatal(e.Start(":1323"))
}

func Exit(room *Room, player *Player) {
	if room == nil {
		return
	}
	if player.exited {
		return
	}
	ws := player.ws
	player.Send(SendPayload{Type: ExitSync, Timestamp: time.Now().UnixMilli()})
	err := ws.Close()
	if err != nil {
		discord.Errorf("error closing websocket: %v", err)
	}
	delete(room.Players, player.Id)
	if len(room.Players) == 0 {
		room.VideoState = defaultVideoState()
	}
	log.Infof("[%v] disconnected", player.Id)
	player.exited = true
}

func routes() {
	e.Static("/static", config.TheConfig.Output)
	e.GET("/all", func(c echo.Context) error {
		return c.String(http.StatusOK, job.JobsCache.GetMarshalled())
	})
	e.GET("/purge", func(c echo.Context) error {
		_, err := job.JobsCache.Get(true)
		if err != nil {
			return err
		}
		return c.String(http.StatusOK, job.JobsCache.GetMarshalled())
	})
	//e.GET("/job/:id", func(c echo.Context) error {
	//	id := c.Param("id")
	//	job := populate(id)
	//	return c.JSON(http.StatusOK, job)
	//})
	e.POST("/pfp/:id", func(c echo.Context) error {
		id := c.Param("id")
		file, err := c.FormFile("pfp")
		if err != nil {
			discord.Errorf("error getting file: %v", err)
			return err
		}
		src, err := file.Open()
		if err != nil {
			discord.Errorf("error opening file: %v", err)
			return err
		}
		defer func() {
			err := src.Close()
			if err != nil {
				discord.Errorf("error closing file: %v", err)
			}
		}()
		err = os.MkdirAll(config.TheConfig.Output+"/pfp", 0755)
		if err != nil {
			return err
		}
		dst, err := os.Create(config.TheConfig.Output + "/pfp/" + id + ".png")
		if err != nil {
			return err
		}
		defer func(dst *os.File) {
			err := dst.Close()
			if err != nil {
				discord.Errorf("error closing file: %v", err)
			}
		}(dst)
		if _, err = io.Copy(dst, src); err != nil {
			return err
		}
		err = func() error {
			wss.Range(func(key, value interface{}) bool {
				room := value.(*Room)
				err = func() error {
					room.mutex.RLock()
					defer room.mutex.RUnlock()
					if firedBy, ok := room.Players[id]; ok {
						payload := SendPayload{Type: PfpSync, FiredBy: firedBy, Timestamp: time.Now().UnixMilli()}
						payloadStr, err := json.Marshal(payload)
						if err != nil {
							discord.Errorf("error marshalling payload: %v", err)
							return err
						}
						for _, player := range room.Players {
							player.Send(payloadStr)
						}
					}
					return nil
				}()
				return true
			})
			return nil
		}()
		if err != nil {
			return err
		}
		return c.String(http.StatusOK, "File uploaded")
	})
	e.GET("/sync/:room", func(c echo.Context) error {
		roomId := c.Param("room")
		roomI, ok := wss.Load(roomId)
		if !ok {
			return c.String(http.StatusNotFound, "Room not found")
		}
		room := roomI.(*Room)
		room.mutex.RLock()
		defer room.mutex.RUnlock()
		return c.JSON(http.StatusOK, room)
	})
	e.GET("/sync/:room/:id", func(c echo.Context) error {
		roomId := c.Param("room")
		id := c.Param("id")
		websocket.Handler(func(ws *websocket.Conn) {
			currentPlayer := &Player{ws: ws,
				PlayerState: PlayerState{Id: id, LastSeen: time.Now().Unix()},
			}
			if _, ok := wss.Load(roomId); !ok {
				wss.Store(roomId, &Room{Players: make(map[string]*Player), id: id,
					VideoState: defaultVideoState(), Chats: make([]*discord.Chat, 0)})
			}
			roomI, _ := wss.Load(roomId)
			room := roomI.(*Room)
			defer func() {
				room.mutex.Lock()
				defer room.mutex.Unlock()
				Exit(room, currentPlayer)
			}()
			room.mutex.Lock()
			if room.Players[id] != nil {
				old := room.Players[id]
				Exit(room, old)
			}
			room.Players[id] = currentPlayer
			room.mutex.Unlock()
			log.Infof("[%v] connected", id)
			for {
				msg := ""
				err := websocket.Message.Receive(ws, &msg)
				if err != nil {
					discord.Errorf("error receiving message: %v", err)
					return
				}
				payload := &PlayerPayload{}
				err = json.Unmarshal([]byte(msg), payload)
				if err != nil {
					discord.Errorf("error unmarshalling message: %v", err)
					return
				}
				func() {
					room.mutex.Lock()
					defer room.mutex.Unlock()
					currentPlayer.LastSeen = time.Now().Unix()
					switch payload.Type {
					case StateSync:
						switch payload.State {
						case "bg":
							currentPlayer.InBg = true
						case "fg":
							currentPlayer.InBg = false
							room.syncChatsToPlayerUnsafe(currentPlayer)
						}
					case CodecSwitch:
						currentPlayer.codec = payload.Codec
					case AudioSwitch:
						currentPlayer.audio = payload.Audio
					case SubtitleSwitch:
						currentPlayer.subtitle = payload.Subtitle
					case ProfileSync:
						currentPlayer.Name = payload.Name
						currentPlayer.DiscordUser = payload.DiscordUser
					case BroadcastSync:
						now := time.Now().UnixMilli()
						for _, player := range room.Players {
							player.Send(SendPayload{Type: BroadcastSync,
								FiredBy: currentPlayer, Timestamp: now,
								Broadcast: payload.Broadcast})
						}
					case ChatSync:
						if strings.TrimSpace(payload.Chat) == "" {
							return
						}
						room.Chats = append(room.Chats, &discord.Chat{Message: payload.Chat,
							Uid:       currentPlayer.Id,
							Timestamp: time.Now().UnixMilli(), MediaSec: currentPlayer.Time})
						for _, player := range room.Players {
							room.syncChatsToPlayerUnsafe(player)
						}
						go func() {
							discord.Webhook(utils.FormatSecondsToTime(currentPlayer.Time)+": "+payload.Chat, currentPlayer.Name, currentPlayer.Id)
						}()
					case TimeSync:
						currentPlayer.Time = *payload.Time
						if math.Abs(room.Time-currentPlayer.Time) > 5 &&
							room.LastSeek.Add(1*time.Second).Before(time.Now()) {
							log.Debugf("[%v] player time: %v, room time: %v", currentPlayer.Name, currentPlayer.Time, room.Time)
							for _, p := range room.Players {
								if currentPlayer.Id == p.Id {
									continue
								}
								p.Sync(&currentPlayer.Time, nil, currentPlayer)
							}
							room.LastSeek = time.Now()
						}
						room.Time = currentPlayer.Time
					case PauseSync:
						currentPlayer.Paused = *payload.Paused
						log.Debugf("[%v] player paused: %v, room paused: %v", currentPlayer.Name, currentPlayer.Paused, room.Paused)
						room.Paused = currentPlayer.Paused
						for _, p := range room.Players {
							if currentPlayer.Id == p.Id {
								continue
							}
							p.Sync(nil, &room.Paused, currentPlayer)
						}
					case NewPlayer:
						paused := false
						currentPlayer.Sync(&room.VideoState.Time, &paused, nil)
						for _, p := range room.Players {
							if currentPlayer.Id == p.Id {
								continue
							}
							p.Sync(nil, &paused, currentPlayer)
						}
						room.syncChatsToPlayerUnsafe(currentPlayer)
					}
				}()
			}
		}).ServeHTTP(c.Response(), c.Request())
		return nil
	})
}
