package job

import (
	"Sparkle/config"
	"Sparkle/utils"
	"fmt"
	"strings"
)

const (
	Complete         = "complete"
	Incomplete       = "incomplete"
	StreamsExtracted = "streams_extracted"
	JobFile          = "job.json"
	ThumbnailVtt     = "storyboard.vtt"
	SpritePrefix     = "sp"
	SpriteExtension  = ".jpg"
	SubtitlesType    = "subtitle"
	AudioType        = "audio"
	AttachmentType   = "attachment"
)

// StreamInfo holds information about a stream in a media file
type StreamInfo struct {
	Index     int    `json:"index"`
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Channels  int    `json:"channels,omitempty"` // Ensure this matches the JSON structure
	Tags      struct {
		Language string `json:"language"`
		Title    string `json:"title"`
		Filename string `json:"filename"`
		MimeType string `json:"mimetype"`
	}
}

// FFProbeOutput holds the structure for ffprobe output
type FFProbeOutput struct {
	Streams  []StreamInfo `json:"streams"`
	Chapters []Chapter    `json:"chapters"`
}

var codecMap = map[string]string{
	"hdmv_pgs_subtitle": "sup",
	"dvd_subtitle":      "sub",
	"subrip":            "srt",
	"webvtt":            "vtt",
}

type JobStripped struct {
	Id             string
	Input          string
	State          string
	EncodedCodecs  []string
	MappedAudio    map[string][]StreamStripped
	Streams        []StreamStripped `json:",omitempty"`
	Duration       float64
	Chapters       []ChapterStripped `json:",omitempty"`
	DominantColors []string          `json:",omitempty"`
	Files          map[string]int64
	OriSize        int64 `json:",omitempty"`
	OriModTime     int64 `json:",omitempty"`
	JobModTime     int64 `json:",omitempty"`
	Fast           bool  `json:",omitempty"`
	Translate      bool  `json:",omitempty"`
}

type StreamStripped struct {
	CodecType string `json:",omitempty"`
	Index     int
	Location  string `json:",omitempty"`
	Language  string `json:",omitempty"`
	Title     string `json:",omitempty"`
}

type ChapterStripped struct {
	Start int                    `json:"start"`
	End   int                    `json:"end"`
	Tags  map[string]interface{} `json:"tags"`
}

type Job struct {
	Id             string
	InputParent    string
	Input          string
	State          string
	SHA256         string
	EncodedCodecs  []string
	MappedAudio    map[string][]Stream
	Streams        []Stream
	Duration       float64
	Width          int
	Height         int
	EncodedExt     string
	Chapters       []Chapter
	DominantColors []string
	OriSize        int64
	OriModTime     int64
	Fast           bool
	Translate      bool
}

type Stream struct {
	Bitrate    int
	CodecName  string
	CodecType  string
	Index      int
	Location   string
	Language   string
	Title      string
	Filename   string
	MimeType   string
	Channels   int
	SampleRate int
}

type Chapter struct {
	ID        int64                  `json:"id"`
	StartTime string                 `json:"start_time"`
	EndTime   string                 `json:"end_time"`
	Start     int                    `json:"start"`
	End       int                    `json:"end"`
	TimeBase  string                 `json:"time_base"`
	Tags      map[string]interface{} `json:"tags"`
}

func (job *Job) InputExt() string {
	sp := strings.Split(job.Input, ".")
	return sp[len(sp)-1]
}

func (job *Job) InputName() string {
	sp := strings.Split(job.Input, ".")
	return strings.Join(sp[:len(sp)-1], ".")
}

func (job *Job) OutputJoin(args ...string) string {
	return utils.OutputJoin(append([]string{job.Id}, args...)...)
}

func (job *Job) InputJoin(args ...string) string {
	return utils.InputJoin(append([]string{job.InputParent}, args...)...)
}

func (job *Job) GetCodecVideo(codec string) string {
	return job.OutputJoin(fmt.Sprintf("%s.%s", codec, config.TheConfig.VideoExt))
}

var ValidExtensions = []string{"mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "vob", "3gp", "3g2"}
