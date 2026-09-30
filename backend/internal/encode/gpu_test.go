package encode

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Generate deterministic tones through the real segment encoder for the browser
// PCM continuity test. Nothing is written to Plex/media roots; callers opt into
// an explicit disposable fixture directory and a physical NVENC GPU.
func TestNVENCAudioContinuityFixture(t *testing.T) {
	nvencAudioFixture(t, false, false)
}

func TestNVENCSurroundAudioFixture(t *testing.T) {
	nvencAudioFixture(t, true, false)
}

func TestNVENCLayoutAudioFixture(t *testing.T) {
	nvencAudioFixture(t, true, true)
}

type layoutFixture struct {
	Layout   string   `json:"layout"`
	Channels int      `json:"channels"`
	Width    int      `json:"width"`
	Targets  []string `json:"targets"`
	Tones    []int    `json:"tones"`
	Track    int      `json:"track"`
}

func nvencAudioFixture(t *testing.T, surround, extended bool) {
	t.Helper()
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
	args := []string{"-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000"}
	tones := []int{440, 550, 660, 60, 770, 880, 990, 1100}
	layouts := []string{}
	wantChannels := []int{1, 1}
	if surround {
		layouts = []string{"5.1", "7.1", "5.1(side)"}
		wantChannels = append(wantChannels, 6, 8, 8)
	}
	extra := []layoutFixture{}
	if extended {
		// Expected destinations are independent of the production mix planner.
		for _, tc := range []struct {
			layout, targets string
			width           int
		}{
			{"2.1", "FL FR LFE", 6},
			{"4.0", "FL FR FC BC", 7},
			{"4.1", "FL FR FC LFE BC", 7},
			{"quad(side)", "FL FR SL SR", 8},
			{"6.1(back)", "FL FR FC LFE BL BR BC", 8},
			{"7.1(wide)", "FL FR FC LFE BL BR FL FR", 8},
			{"7.1(wide-side)", "FL FR FC LFE FL FR SL SR", 8},
			{"7.1.4", "FL FR FC LFE BL BR SL SR FL FR BL BR", 8},
			{"22.2", "FL FR FC LFE BL BR FL FR BC SL SR FC FL FC FR BL BC BR LFE SL SR FC FL FR", 8},
			{"unknown", "FL FR FL FR FL FR FL FR FL FR FL FR", 2},
		} {
			positions := strings.Fields(tc.targets)
			f := layoutFixture{Layout: tc.layout, Channels: len(positions), Width: tc.width, Targets: positions, Track: len(wantChannels)}
			for i, target := range positions {
				hz := 280 + 80*i
				if target == "LFE" {
					hz = 60 + i
				}
				f.Tones = append(f.Tones, hz)
			}
			extra = append(extra, f)
			wantChannels = append(wantChannels, tc.width)
		}
	}
	for _, layout := range layouts {
		count := 6
		if layout == "7.1" {
			count = 8
		}
		expressions := []string{}
		for _, hz := range tones[:count] {
			expressions = append(expressions, fmt.Sprintf("0.025*sin(2*PI*%d*t)", hz))
		}
		args = append(args, "-f", "lavfi", "-i", "aevalsrc="+strings.Join(expressions, "|")+":s=48000:c="+layout)
	}
	for _, f := range extra {
		expressions := []string{}
		for _, hz := range f.Tones {
			// Leave enough analysis headroom after two bounded downmixes (e.g.
			// 22.2 -> 7.1 -> mono), while each source remains below full scale.
			expressions = append(expressions, fmt.Sprintf("0.1*sin(2*PI*%d*t)", hz))
		}
		layout := f.Layout
		if layout == "unknown" {
			layout = "7.1.4"
		}
		args = append(args, "-f", "lavfi", "-i", "aevalsrc="+strings.Join(expressions, "|")+":s=48000:c="+layout)
	}
	args = append(args, "-t", "30", "-map", "0:v")
	for i := range wantChannels {
		args = append(args, "-map", fmt.Sprintf("%d:a", i+1))
	}
	args = append(args, "-c:v", "ffv1", "-c:a", "pcm_s16le")
	if surround {
		// Matroska PCM drops speaker masks. WavPack and AC-3 retain them.
		args = append(args, "-c:a", "wavpack", "-c:a:4", "ac3", "-b:a:4", "640k")
	}
	for _, f := range extra {
		if f.Layout == "unknown" {
			// PCM intentionally strips the unknown case's mask.
			args = append(args, fmt.Sprintf("-c:a:%d", f.Track), "pcm_s16le")
		}
	}
	args = append(args, input)
	if err := run(ctx, ffmpeg, args, nil); err != nil {
		t.Fatal(err)
	}
	p, err := probe(ctx, ffprobe, input)
	if err != nil {
		t.Fatal(err)
	}
	if surround && p.Streams[5].ChannelLayout != "5.1(side)" {
		t.Fatal("fixture lost its side speaker positions")
	}
	for _, f := range extra {
		stream := p.Streams[f.Track+1]
		layout := f.Layout
		if layout == "unknown" {
			layout = ""
		}
		if stream.ChannelLayout != layout || stream.Channels != f.Channels {
			t.Fatalf("fixture lost layout %s: %s (%d)", f.Layout, stream.ChannelLayout, stream.Channels)
		}
	}
	for _, codec := range []string{"av1", "hevc"} {
		dir := filepath.Join(root, codec)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		for segment := 0; segment*SegmentSeconds < 30; segment++ {
			chunk := t.TempDir()
			if err := run(ctx, ffmpeg, encodeArgs(input, chunk, codec, segment, 30, Profile{Quality: 22, Preset: "p3", AudioSurroundKbpsPerChannel: 80}, p), nil); err != nil {
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
					packetsPerTrack := int(math.Min(SegmentSeconds, 30-float64(segment*SegmentSeconds)) * 50)
					for track := range wantChannels {
						if counts[track] != packetsPerTrack {
							t.Fatalf("unexpected audio packet count: %v", counts)
						}
					}
					encoded, err := probe(ctx, ffprobe, name)
					if err != nil {
						t.Fatal(err)
					}
					if len(encoded.Streams) != len(wantChannels) {
						t.Fatalf("lost encoded audio tracks: %+v", encoded.Streams)
					}
					for i, channels := range wantChannels {
						if encoded.Streams[i].Channels != channels {
							t.Fatalf("track %d: expected %d channels, got %d", i, channels, encoded.Streams[i].Channels)
						}
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
			playlist := fmt.Sprintf("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:%d\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"%s-init.mp4\"\n", SegmentSeconds, kind)
			for n := 0; n*SegmentSeconds < 30; n++ {
				playlist += fmt.Sprintf("#EXTINF:%.6f,\n%s-%d.m4s\n", math.Min(SegmentSeconds, 30-float64(n*SegmentSeconds)), kind, n)
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
	if extended {
		sources := []int{}
		for _, stream := range p.Streams {
			if stream.Type == "audio" {
				sources = append(sources, stream.Channels)
			}
		}
		metadata, err := json.Marshal(map[string]any{"fixtures": extra, "sourceChannels": sources, "encodedChannels": wantChannels, "audioTracks": p.audioPlans()})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "layout-fixtures.json"), metadata, 0644); err != nil {
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
			args := encodeArgs(input, dir, codec, 0, 3, Profile{Quality: 22, Preset: "p3", AudioSurroundKbpsPerChannel: 80}, p)
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
