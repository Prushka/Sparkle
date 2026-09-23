package encode

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const SegmentSeconds = 6
const profileVersion = "nvenc-segments-v3"

type Profile struct {
	Quality   int
	Preset    string
	AudioKbps int
}
type Stream struct {
	Index     int               `json:"index"`
	Codec     string            `json:"codec_name"`
	Type      string            `json:"codec_type"`
	Width     int               `json:"width"`
	Height    int               `json:"height"`
	Transfer  string            `json:"color_transfer"`
	Primaries string            `json:"color_primaries"`
	Space     string            `json:"color_space"`
	Range     string            `json:"color_range"`
	Extra     string            `json:"extradata"`
	Tags      map[string]string `json:"tags"`
	SideData  []struct {
		Type    string `json:"side_data_type"`
		Profile int    `json:"dv_profile"`
	} `json:"side_data_list"`
}
type Probe struct {
	Streams []Stream `json:"streams"`
	Format  struct {
		Duration  string `json:"duration"`
		StartTime string `json:"start_time"`
	} `json:"format"`
}

func probe(ctx context.Context, binary, input string) (Probe, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	b := &limitedBuffer{limit: 24 << 20}
	args := append([]string{"-v", "error"}, inputRestrictions(input)...)
	args = append(args, "-probesize", "8000000", "-analyzeduration", "5000000", "-show_streams", "-show_format", "-show_data", "-of", "json", input)
	err := run(ctx, binary, args, b)
	var p Probe
	if err != nil || json.Unmarshal(b.Bytes(), &p) != nil || len(p.Streams) > 128 {
		return p, errEncode
	}
	return p, nil
}

// Playlists/concat inputs and demuxer-side local file references are forbidden.
func inputRestrictions(input string) []string {
	protocol := "file"
	if strings.HasPrefix(input, "http://127.0.0.1:") {
		protocol = "http,tcp"
	}
	return []string{"-protocol_whitelist", protocol, "-format_whitelist", "matroska,webm,mov,mpegts,mpeg,avi,asf,flv,ogg"}
}

func (p Probe) video() Stream {
	for _, s := range p.Streams {
		if s.Type == "video" {
			return s
		}
	}
	return Stream{}
}
func (p Probe) count(kind string) int {
	n := 0
	for _, s := range p.Streams {
		if s.Type == kind {
			n++
		}
	}
	return n
}
func (s Stream) dolby5() bool {
	for _, d := range s.SideData {
		if d.Profile == 5 {
			return true
		}
	}
	return false
}
func (p Probe) output() string {
	v := p.video()
	if v.dolby5() || v.Transfer == "smpte2084" {
		return "HDR10"
	}
	if v.Transfer == "arib-std-b67" {
		return "HLG"
	}
	return "SDR"
}

// HandBrake's NVENC CQ mapping: VBR, zero target bitrate, I/P/B initial
// quantizers CQ-2/CQ/CQ+2. Its slowest preset maps to p7. Streaming adds closed
// two-second GOPs; it does not silently replace CQ with a low-bitrate preset.
func videoArgs(codec string, p Profile, video Stream) []string {
	args := []string{"-map", "0:v:0", "-an", "-sn", "-dn", "-c:v", codec + "_nvenc", "-preset", p.Preset, "-tune", "hq", "-rc", "vbr", "-cq", strconv.Itoa(p.Quality), "-b:v", "0", "-init_qpP", strconv.Itoa(p.Quality), "-init_qpI", strconv.Itoa(max(0, p.Quality-2)), "-init_qpB", strconv.Itoa(min(51, p.Quality+2)), "-pix_fmt", "p010le", "-fps_mode", "vfr", "-force_key_frames", "expr:gte(t,n_forced*2)", "-forced-idr", "1"}
	// NVENC cannot preserve Dolby Vision enhancement layers or RPU mapping.
	// Profile 5 has no ordinary YCbCr base: libplacebo must apply its RPU first.
	filter := "format=p010le"
	if video.dolby5() {
		filter = "libplacebo=apply_dolbyvision=1:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=tv:format=yuv420p10le,format=p010le"
	}
	filter += ",sidedata=mode=delete:type=DOVI_METADATA,sidedata=mode=delete:type=DYNAMIC_HDR_PLUS"
	args = append(args, "-vf", filter)
	if codec == "hevc" {
		args = append(args, "-tag:v", "hvc1")
	}
	return args
}
func fragmentArgs(start float64) []string {
	return []string{"-output_ts_offset", fmt.Sprintf("%.6f", start), "-movflags", "+empty_moov+default_base_moof+frag_keyframe", "-video_track_timescale", "90000", "-frag_duration", "2000000", "-f", "mp4"}
}

func toolRevision(ctx context.Context, binary string) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	buffer := &limitedBuffer{limit: 128 << 10}
	if run(ctx, binary, []string{"-version"}, buffer) != nil {
		return "unavailable"
	}
	return fmt.Sprintf("%x", sha256.Sum256(buffer.Bytes()))
}
func encodeArgs(input, dir, codec string, segment int, duration float64, p Profile, source Probe) []string {
	start := float64(segment * SegmentSeconds)
	length := math.Min(SegmentSeconds, duration-start)
	clip := []string{"-t", fmt.Sprintf("%.6f", length)}
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y"}
	args = append(args, inputRestrictions(input)...)
	if !source.video().dolby5() {
		args = append(args, "-hwaccel", "auto")
	}
	// FFmpeg otherwise selects libdav1d even when NVDEC is available. The
	// native AV1 decoder admits hardware acceleration; the runner retries with
	// software decoding on older GPUs that can encode HEVC but not decode AV1.
	if source.video().Codec == "av1" {
		args = append(args, "-c:v", "av1")
	}
	args = append(args, "-ss", fmt.Sprintf("%.6f", start), "-i", input)
	// Limit container metadata to the normalized API; copied chapter tracks can
	// otherwise introduce a spurious MP4 data stream in every fragment.
	args = append(args, clip...)
	args = append(args, "-map_chapters", "-1", "-map_metadata", "-1")
	args = append(args, videoArgs(codec, p, source.video())...)
	args = append(args, fragmentArgs(start)...)
	args = append(args, filepath.Join(dir, "video.mp4"))
	if source.count("audio") > 0 {
		args = append(args, clip...)
		args = append(args, "-map_chapters", "-1", "-map_metadata", "-1")
		args = append(args, "-map", "0:a", "-vn", "-sn", "-dn", "-c:a", "libopus", "-b:a", strconv.Itoa(p.AudioKbps)+"k", "-ac", "2")
		args = append(args, fragmentArgs(start)...)
		args = append(args, filepath.Join(dir, "audio.mp4"))
	}
	return args
}

func softwareInput(args []string) []string {
	result := []string{}
	input := true
	for i := 0; i < len(args); i++ {
		if input && (args[i] == "-hwaccel" || args[i] == "-c:v") {
			i++
			continue
		}
		result = append(result, args[i])
		if args[i] == "-i" {
			input = false
		}
	}
	return result
}

// Probe real 10-bit encoding, not just an encoder name in `ffmpeg -encoders`.
func capabilities(ctx context.Context, binary, dir string) []string {
	result := []string{}
	for _, codec := range []string{"av1", "hevc"} {
		check, cancel := context.WithTimeout(ctx, 15*time.Second)
		tmp, err := os.CreateTemp(dir, "probe-*.mp4")
		if err != nil {
			cancel()
			continue
		}
		name := tmp.Name()
		tmp.Close()
		args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=size=256x144:rate=24", "-frames:v", "2", "-c:v", codec + "_nvenc", "-pix_fmt", "p010le", "-f", "mp4", name}
		if run(check, binary, args, nil) == nil {
			result = append(result, codec)
		}
		os.Remove(name)
		cancel()
	}
	return result
}

func validProfile(p Profile) bool {
	return p.Quality >= 0 && p.Quality <= 51 && p.AudioKbps >= 32 && p.AudioKbps <= 512 && len(p.Preset) == 2 && strings.HasPrefix(p.Preset, "p") && p.Preset[1] >= '1' && p.Preset[1] <= '7'
}
