package realtime

const (
	NewPlayer         = "new player"
	ProfileSync       = "profile"
	TimeSync          = "time"
	PauseSync         = "pause"
	ChatSync          = "chat"
	PlayersStatusSync = "players"
	PlayerStatusSync  = "playerStatus"
	HeartbeatSync     = "heartbeat"
	PfpSync           = "pfp"
	StateSync         = "state"
	BroadcastSync     = "broadcast"
	SoundEffectSync   = "soundEffect"
	YouTubeSync       = "youtube"
	ChessSync         = "chess"
	ExitSync          = "exit"
	CodecSwitch       = "codec"
	AudioSwitch       = "audio"
	SubtitleSwitch    = "subtitle"
)

const (
	MoveToBroadcast = "moveTo"
)

const (
	maxChatMessages = 200
	maxChatLength   = 2000
	maxChatEmojis   = 50
	maxYouTubeTabs  = 12
	maxChessTabs    = 64
	maxChessMoves   = 600
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

type YouTubeTabState struct {
	ID           string  `json:"id"`
	Open         bool    `json:"open"`
	URL          string  `json:"url,omitempty"`
	VideoID      string  `json:"videoId,omitempty"`
	Time         float64 `json:"time"`
	Paused       bool    `json:"paused"`
	PlaybackRate float64 `json:"playbackRate"`
	UpdatedAt    int64   `json:"updatedAt"`
}

type YouTubeState struct {
	Tabs      []YouTubeTabState `json:"tabs,omitempty"`
	UpdatedAt int64             `json:"updatedAt"`
}

type ChessPlayerState struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ProfileID string `json:"profileId,omitempty"`
}

type ChessSettingsState struct {
	PieceSet         string `json:"pieceSet"`
	BoardTheme       string `json:"boardTheme"`
	Timed            bool   `json:"timed"`
	Minutes          int    `json:"minutes"`
	IncrementSeconds int    `json:"incrementSeconds"`
}

type ChessMoveState struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Promotion string `json:"promotion,omitempty"`
	SAN       string `json:"san"`
}

type ChessClockState struct {
	WhiteMs    int64 `json:"w"`
	BlackMs    int64 `json:"b"`
	LastTickAt int64 `json:"lastTickAt"`
}

type ChessCloseRequestState struct {
	RequestedBy ChessPlayerState `json:"requestedBy"`
	RequestedAt int64            `json:"requestedAt"`
	ExpiresAt   int64            `json:"expiresAt"`
}

type ChessDrawOfferState struct {
	OfferedBy ChessPlayerState `json:"offeredBy"`
	OfferedAt int64            `json:"offeredAt"`
}

type ChessResultState struct {
	Winner  string `json:"winner"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

type ChessTabState struct {
	ID           string                  `json:"id"`
	Open         bool                    `json:"open"`
	Phase        string                  `json:"phase"`
	Settings     ChessSettingsState      `json:"settings"`
	White        *ChessPlayerState       `json:"white"`
	Black        *ChessPlayerState       `json:"black"`
	FEN          string                  `json:"fen"`
	Moves        []ChessMoveState        `json:"moves,omitempty"`
	Clocks       ChessClockState         `json:"clocks"`
	Result       *ChessResultState       `json:"result"`
	CloseRequest *ChessCloseRequestState `json:"closeRequest"`
	DrawOffer    *ChessDrawOfferState    `json:"drawOffer"`
	UpdatedAt    int64                   `json:"updatedAt"`
}

type ChessState struct {
	Tabs      []ChessTabState `json:"tabs,omitempty"`
	UpdatedAt int64           `json:"updatedAt"`
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

type PlayerStatus struct {
	Id       string  `json:"id"`
	Time     float64 `json:"time"`
	Paused   bool    `json:"paused"`
	InBg     bool    `json:"inBg"`
	LastSeen int64   `json:"lastSeen"`
}

type Chat struct {
	Message   string         `json:"message"`
	Emojis    []string       `json:"emojis,omitempty"`
	EmojiRefs []ChatEmojiRef `json:"emojiRefs,omitempty"`
	Author    *ChatAuthor    `json:"author,omitempty"`
	Timestamp int64          `json:"timestamp"`
	MediaSec  float64        `json:"mediaSec"`
	Uid       string         `json:"uid"`
}

type ChatAuthor struct {
	Name        string       `json:"name"`
	Id          string       `json:"id"`
	ProfileId   string       `json:"profileId,omitempty"`
	DiscordUser *DiscordUser `json:"discordUser,omitempty"`
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
	Chess       *ChessState    `json:"chess,omitempty"`
}

type SendPayload struct {
	Type           string           `json:"type"`
	Time           *float64         `json:"time,omitempty"`
	Paused         *bool            `json:"paused,omitempty"`
	FiredBy        *PlayerSnapshot  `json:"firedBy,omitempty"`
	Chat           *Chat            `json:"chat,omitempty"`
	Chats          []Chat           `json:"chats,omitempty"`
	Players        []PlayerSnapshot `json:"players,omitempty"`
	PlayerStatuses []PlayerStatus   `json:"playerStatuses,omitempty"`
	PlayersCount   int              `json:"playersCount,omitempty"`
	Timestamp      int64            `json:"timestamp"`
	Broadcast      map[string]any   `json:"broadcast,omitempty"`
	YouTube        *YouTubeState    `json:"youtube,omitempty"`
	Chess          *ChessState      `json:"chess,omitempty"`
}

func defaultVideoState() VideoState {
	return VideoState{Time: 0, Paused: true}
}

func defaultYouTubeState() YouTubeState {
	return YouTubeState{}
}

func defaultChessState() ChessState {
	return ChessState{}
}
