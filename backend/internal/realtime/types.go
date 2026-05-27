package realtime

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

const (
	maxChatMessages = 200
	maxChatLength   = 2000
)

type Options struct {
	OutputDir      string
	MaxUploadBytes int64
}

type DiscordUser struct {
	Username      string  `json:"username"`
	Discriminator string  `json:"discriminator"`
	ID            string  `json:"id"`
	PublicFlags   int     `json:"public_flags,omitempty"`
	Avatar        *string `json:"avatar,omitempty"`
	GlobalName    *string `json:"global_name,omitempty"`
}

type VideoState struct {
	Time   float64 `json:"time"`
	Paused bool    `json:"paused"`
}

type PlayerState struct {
	Name        string       `json:"name"`
	Id          string       `json:"id"`
	InBg        bool         `json:"inBg,omitempty"`
	LastSeen    int64        `json:"lastSeen"`
	Codec       string       `json:"codec,omitempty"`
	Audio       string       `json:"audio,omitempty"`
	Subtitle    string       `json:"subtitle,omitempty"`
	DiscordUser *DiscordUser `json:"discordUser,omitempty"`
}

type PlayerSnapshot struct {
	VideoState
	PlayerState
}

type Chat struct {
	Message   string  `json:"message"`
	Timestamp int64   `json:"timestamp"`
	MediaSec  float64 `json:"mediaSec"`
	Uid       string  `json:"uid"`
}

type ClientPayload struct {
	Type        string         `json:"type"`
	Time        *float64       `json:"time,omitempty"`
	Name        string         `json:"name,omitempty"`
	DiscordUser *DiscordUser   `json:"discordUser,omitempty"`
	Paused      *bool          `json:"paused,omitempty"`
	Chat        string         `json:"chat,omitempty"`
	State       string         `json:"state,omitempty"`
	Broadcast   map[string]any `json:"broadcast,omitempty"`
	Codec       string         `json:"codec,omitempty"`
	Audio       string         `json:"audio,omitempty"`
	Subtitle    string         `json:"subtitle,omitempty"`
}

type SendPayload struct {
	Type      string           `json:"type"`
	Time      *float64         `json:"time,omitempty"`
	Paused    *bool            `json:"paused,omitempty"`
	FiredBy   *PlayerSnapshot  `json:"firedBy,omitempty"`
	Chats     []Chat           `json:"chats,omitempty"`
	Players   []PlayerSnapshot `json:"players,omitempty"`
	Timestamp int64            `json:"timestamp"`
	Broadcast map[string]any   `json:"broadcast,omitempty"`
}

func defaultVideoState() VideoState {
	return VideoState{Time: 0, Paused: true}
}
