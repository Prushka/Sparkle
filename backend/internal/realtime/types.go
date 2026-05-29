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
	SoundEffectSync   = "soundEffect"
	YouTubeSync       = "youtube"
	ExitSync          = "exit"
	CodecSwitch       = "codec"
	AudioSwitch       = "audio"
	SubtitleSwitch    = "subtitle"
)

const (
	maxChatMessages = 200
	maxChatLength   = 2000
	maxChatEmojis   = 50
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

type YouTubeState struct {
	Open         bool    `json:"open"`
	URL          string  `json:"url,omitempty"`
	VideoID      string  `json:"videoId,omitempty"`
	Time         float64 `json:"time"`
	Paused       bool    `json:"paused"`
	PlaybackRate float64 `json:"playbackRate"`
	UpdatedAt    int64   `json:"updatedAt"`
}

type PlayerState struct {
	Name        string       `json:"name"`
	Id          string       `json:"id"`
	ProfileId   string       `json:"profileId,omitempty"`
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
	Message   string         `json:"message"`
	Emojis    []string       `json:"emojis,omitempty"`
	EmojiRefs []ChatEmojiRef `json:"emojiRefs,omitempty"`
	Timestamp int64          `json:"timestamp"`
	MediaSec  float64        `json:"mediaSec"`
	Uid       string         `json:"uid"`
}

type ChatEmojiRef struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Src        string `json:"src"`
	Source     string `json:"source"`
	Animated   bool   `json:"animated"`
	Kind       string `json:"kind"`
	PreviewSrc string `json:"previewSrc,omitempty"`
	ItemURL    string `json:"itemUrl,omitempty"`
}

type ClientPayload struct {
	Type        string         `json:"type"`
	Time        *float64       `json:"time,omitempty"`
	Name        string         `json:"name,omitempty"`
	ProfileId   string         `json:"profileId,omitempty"`
	DiscordUser *DiscordUser   `json:"discordUser,omitempty"`
	Paused      *bool          `json:"paused,omitempty"`
	Chat        string         `json:"chat,omitempty"`
	Emojis      []string       `json:"emojis,omitempty"`
	EmojiRefs   []ChatEmojiRef `json:"emojiRefs,omitempty"`
	State       string         `json:"state,omitempty"`
	Broadcast   map[string]any `json:"broadcast,omitempty"`
	Codec       string         `json:"codec,omitempty"`
	Audio       string         `json:"audio,omitempty"`
	Subtitle    string         `json:"subtitle,omitempty"`
	YouTube     *YouTubeState  `json:"youtube,omitempty"`
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
	YouTube   *YouTubeState    `json:"youtube,omitempty"`
}

func defaultVideoState() VideoState {
	return VideoState{Time: 0, Paused: true}
}

func defaultYouTubeState() YouTubeState {
	return YouTubeState{Time: 0, Paused: true, PlaybackRate: 1}
}
