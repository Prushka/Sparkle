package encode

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type SubtitleHeader struct {
	ID     int    `json:"id"`
	Codec  int    `json:"codec"`
	Header []byte `json:"header"`
	Title  string `json:"title"`
}
type SubtitlePacket struct {
	Key      string  `json:"key"`
	ID       int     `json:"id"`
	Data     []byte  `json:"data"`
	PTS      float64 `json:"pts"`
	Duration float64 `json:"duration"`
}
type SubtitleChunk struct {
	Tracks  []SubtitleHeader `json:"tracks"`
	Packets []SubtitlePacket `json:"packets"`
}

func unhex(dump string) ([]byte, error) {
	var result []byte
	for _, line := range strings.Split(dump, "\n") {
		_, rest, ok := strings.Cut(line, ": ")
		if !ok {
			continue
		}
		rest, _, _ = strings.Cut(rest, "  ")
		data, err := hex.DecodeString(strings.ReplaceAll(strings.TrimSpace(rest), " ", ""))
		if err != nil {
			return nil, errEncode
		}
		result = append(result, data...)
		if len(result) > 16<<20 {
			return nil, errEncode
		}
	}
	return result, nil
}
func subtitleCodec(name string) int {
	switch name {
	case "ass":
		return 0x17016
	case "ssa":
		return 0x17004
	case "hdmv_pgs_subtitle":
		return 0x17006
	case "subrip":
		return 0x17011
	case "text":
		return 0x17002
	case "webvtt":
		return 0x17012
	case "mov_text":
		return 0x17005
	default:
		return 0
	}
}
func subtitleJSON(ctx context.Context, binary, input, dir string, start float64, source Probe) error {
	chunk := SubtitleChunk{Tracks: []SubtitleHeader{}, Packets: []SubtitlePacket{}}
	if source.count("subtitle") > 0 {
		b := &limitedBuffer{limit: 64 << 20}
		timeBase, _ := strconv.ParseFloat(source.Format.StartTime, 64)
		// Absolute end time, rather than a duration after a preceding keyframe.
		// Looking back one segment preserves captions spanning a seek boundary.
		interval := fmt.Sprintf("%.6f%%%.6f", timeBase+max(0, start-SegmentSeconds), timeBase+start+SegmentSeconds)
		args := append([]string{"-v", "error"}, inputRestrictions(input)...)
		args = append(args, "-read_intervals", interval, "-select_streams", "s", "-show_packets", "-show_data", "-of", "json", input)
		err := run(ctx, binary, args, b)
		var data struct {
			Packets []struct {
				Index    int    `json:"stream_index"`
				PTS      string `json:"pts_time"`
				Duration string `json:"duration_time"`
				Data     string `json:"data"`
			} `json:"packets"`
		}
		if err != nil || json.Unmarshal(b.Bytes(), &data) != nil || len(data.Packets) > 4096 {
			return errEncode
		}
		ids := map[int]int{}
		for _, s := range source.Streams {
			if s.Type != "subtitle" {
				continue
			}
			id := len(chunk.Tracks)
			header, err := unhex(s.Extra)
			if err != nil {
				return err
			}
			title := "Subtitle " + strconv.Itoa(id+1)
			if s.Tags["title"] != "" {
				title = s.Tags["title"]
			} else if s.Tags["language"] != "" {
				title = s.Tags["language"]
			}
			ids[s.Index] = id
			chunk.Tracks = append(chunk.Tracks, SubtitleHeader{id, subtitleCodec(s.Codec), header, title})
		}
		var total int
		for _, p := range data.Packets {
			id, ok := ids[p.Index]
			if !ok {
				continue
			}
			pts, e := strconv.ParseFloat(p.PTS, 64)
			if e != nil {
				continue
			}
			duration, _ := strconv.ParseFloat(p.Duration, 64)
			bytes, e := unhex(p.Data)
			if e != nil {
				return e
			}
			total += len(bytes)
			if total > 24<<20 {
				return errEncode
			}
			digest := sha256.New()
			_, _ = fmt.Fprintf(digest, "%d:%f:%f:", id, pts, duration)
			_, _ = digest.Write(bytes)
			chunk.Packets = append(chunk.Packets, SubtitlePacket{hex.EncodeToString(digest.Sum(nil)[:16]), id, bytes, (pts - timeBase) * 1000, duration * 1000})
		}
	}
	bytes, err := json.Marshal(chunk)
	if err != nil {
		return errEncode
	}
	return os.WriteFile(filepath.Join(dir, "subtitles.json"), bytes, 0644)
}
