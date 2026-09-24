package encode

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// Generate deterministic tones through the real segment encoder for the browser
// PCM continuity test. Nothing is written to Plex/media roots; callers opt into
// an explicit disposable fixture directory and a physical NVENC GPU.
func TestNVENCAudioContinuityFixture(t *testing.T) {
	root := os.Getenv("SPARKLE_ENCODE_AUDIO_FIXTURE_DIR")
	if root == "" {
		t.Skip("SPARKLE_ENCODE_AUDIO_FIXTURE_DIR is required")
	}
	ffmpeg, ffprobe := os.Getenv("FFMPEG"), os.Getenv("FFPROBE")
	if ffmpeg == "" || ffprobe == "" || !filepath.IsAbs(root) {
		t.Fatal("absolute fixture directory, FFMPEG and FFPROBE are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	input := filepath.Join(t.TempDir(), "tones.mkv")
	args := []string{"-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "30", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "ffv1", "-c:a", "pcm_s16le", input}
	if err := run(ctx, ffmpeg, args, nil); err != nil {
		t.Fatal(err)
	}
	p, err := probe(ctx, ffprobe, input)
	if err != nil {
		t.Fatal(err)
	}
	for _, codec := range []string{"av1", "hevc"} {
		dir := filepath.Join(root, codec)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		for segment := 0; segment < 5; segment++ {
			chunk := t.TempDir()
			if err := run(ctx, ffmpeg, encodeArgs(input, chunk, codec, segment, 30, Profile{22, "p3", 144}, p), nil); err != nil {
				t.Fatal(err)
			}
			for _, kind := range []string{"video", "audio"} {
				name := filepath.Join(chunk, kind+".mp4")
				if kind == "audio" {
					if err := clearOpusPreSkip(name); err != nil {
						t.Fatal(err)
					}
				}
				offset, err := shiftFragments(name, float64(segment*SegmentSeconds))
				if err != nil {
					t.Fatal(err)
				}
				if kind == "audio" {
					packets := &limitedBuffer{limit: 2 << 20}
					if err := run(ctx, ffprobe, []string{"-v", "error", "-show_packets", "-show_entries", "packet=stream_index,pts_time,duration_time", "-of", "json", name}, packets); err != nil {
						t.Fatal(err)
					}
					var result struct {
						Packets []struct {
							Track    int    `json:"stream_index"`
							PTS      string `json:"pts_time"`
							Duration string `json:"duration_time"`
						} `json:"packets"`
					}
					if err := json.Unmarshal(packets.Bytes(), &result); err != nil {
						t.Fatal(err)
					}
					counts := map[int]int{}
					for _, packet := range result.Packets {
						pts, _ := strconv.ParseFloat(packet.PTS, 64)
						duration, _ := strconv.ParseFloat(packet.Duration, 64)
						expected := float64(segment*SegmentSeconds) + float64(counts[packet.Track])*0.02
						if pts < expected-0.000001 || pts > expected+0.000001 || duration != 0.02 {
							t.Fatalf("Opus discontinuity at segment %d packet %d: %s duration %s", segment, counts[packet.Track], packet.PTS, packet.Duration)
						}
						counts[packet.Track]++
					}
					if counts[0] != 300 || counts[1] != 300 {
						t.Fatalf("unexpected audio packet count: %v", counts)
					}
				}
				data, err := os.ReadFile(name)
				if err != nil {
					t.Fatal(err)
				}
				if segment == 0 {
					if err := os.WriteFile(filepath.Join(dir, kind+"-init.mp4"), data[:offset], 0644); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%s-%d.m4s", kind, segment)), data[offset:], 0644); err != nil {
					t.Fatal(err)
				}
			}
		}
		for _, kind := range []string{"video", "audio"} {
			playlist := fmt.Sprintf("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"%s-init.mp4\"\n", kind)
			for n := 0; n < 5; n++ {
				playlist += fmt.Sprintf("#EXTINF:6,\n%s-%d.m4s\n", kind, n)
			}
			if err := os.WriteFile(filepath.Join(dir, kind+".m3u8"), []byte(playlist+"#EXT-X-ENDLIST\n"), 0644); err != nil {
				t.Fatal(err)
			}
		}
		master := "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"Audio\",DEFAULT=YES,URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO=\"audio\"\nvideo.m3u8\n"
		if err := os.WriteFile(filepath.Join(dir, "master.m3u8"), []byte(master), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

// Explicitly opt in: CI never consumes a developer's GPU or private media.
func TestNVENCReferenceMedia(t *testing.T) {
	name := os.Getenv("SPARKLE_ENCODE_SAMPLE")
	if name == "" {
		t.Skip("SPARKLE_ENCODE_SAMPLE is required for physical GPU testing")
	}
	ffmpeg, ffprobe := os.Getenv("FFMPEG"), os.Getenv("FFPROBE")
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	if ffprobe == "" {
		ffprobe = "ffprobe"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	f, err := os.Open(name)
	if err != nil {
		t.Fatal("sample unavailable")
	}
	defer f.Close()
	input, closeInput, err := inputURL(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	defer closeInput()
	p, err := probe(ctx, ffprobe, input)
	if err != nil {
		t.Fatal(err)
	}
	for _, codec := range []string{"av1", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			dir := t.TempDir()
			args := encodeArgs(input, dir, codec, 0, 3, Profile{22, "p3", 144}, p)
			if err := run(ctx, ffmpeg, args, nil); err != nil {
				t.Fatal(err)
			}
			out, err := probe(ctx, ffprobe, filepath.Join(dir, "video.mp4"))
			if err != nil {
				t.Fatal(err)
			}
			if out.output() != p.output() {
				t.Fatalf("source %s output %s", p.output(), out.output())
			}
			if out.video().Codec != codec {
				t.Fatalf("codec %s", out.video().Codec)
			}
			for _, side := range out.video().SideData {
				if side.Profile != 0 {
					t.Fatal("encoded video incorrectly retains Dolby configuration")
				}
			}
			t.Logf("%s: %s %dx%d %s", codec, out.output(), out.video().Width, out.video().Height, out.video().Transfer)
		})
	}
}
