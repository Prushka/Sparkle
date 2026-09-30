package encode

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestHDRClassification(t *testing.T) {
	base := Stream{Transfer: "bt709", Primaries: "bt709", Space: "bt709", Range: "tv"}
	tests := []struct {
		name   string
		video  Stream
		frames []Stream
		mode   string
		peak   float64
	}{
		{"SDR", base, nil, "nvidia-truehdr", 1000},
		{"missing-transfer", Stream{Primaries: "bt709", Space: "bt709"}, nil, "", 0},
		{"conflicting-frame", base, []Stream{{Transfer: "smpte2084"}}, "", 0},
		{"bitstream-HDR", Stream{}, []Stream{{Transfer: "smpte2084", SideData: []HDRSideData{{MaxLuminance: "10000000/10000", MaxContent: 400, MaxAverage: 100}}}}, "hdr-expansion", 400},
		{"HLG", Stream{Transfer: "arib-std-b67"}, nil, "hdr-expansion", 1000},
		{"PQ-zero-CLL", Stream{Transfer: "smpte2084", SideData: []HDRSideData{{MaxLuminance: "1000/1"}}}, nil, "hdr-expansion", 1000},
		{"DV5", Stream{SideData: []HDRSideData{{Profile: 5}}}, nil, "hdr-expansion", 1000},
		{"DV7", Stream{SideData: []HDRSideData{{Profile: 7, Enhancement: 1}}}, nil, "hdr-expansion", 1000},
		{"DV8HLG", Stream{SideData: []HDRSideData{{Profile: 8, Compatibility: 4}}}, nil, "hdr-expansion", 1000},
		{"unsafe-matrix", Stream{Transfer: "bt709", Primaries: "bt709", Space: "bt709,evil=true"}, nil, "", 0},
		{"contradictory-HDR", base, []Stream{{SideData: []HDRSideData{{MaxLuminance: "1000/1"}}}}, "", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := planHDR(tt.video, tt.frames)
			if tt.mode == "" {
				if err == nil {
					t.Fatal("expected rejection")
				}
				return
			}
			if err != nil || p.Mode != tt.mode || p.SourcePeak != tt.peak {
				t.Fatalf("%+v %v", p, err)
			}
		})
	}
}

func TestHDRUntaggedHDAVC(t *testing.T) {
	base := Stream{Codec: "h264", PixelFormat: "yuv420p", Width: 1920, Height: 1080}
	for _, tc := range []struct {
		name   string
		change func(*Stream, *Stream)
		want   bool
	}{
		{"untagged", func(v, f *Stream) {}, true},
		{"partial-709", func(v, f *Stream) { v.Primaries = "bt709"; f.Space = "bt709" }, true},
		{"unknown-tags", func(v, f *Stream) { v.Transfer = "unknown"; f.Primaries = "unspecified" }, true},
		{"720p", func(v, f *Stream) { v.Width = 1280; v.Height = 720 }, true},
		{"10-bit", func(v, f *Stream) { v.PixelFormat = "yuv420p10le" }, false},
		{"decoded-10-bit", func(v, f *Stream) { f.PixelFormat = "yuv420p10le" }, false},
		{"missing-decoded-format", func(v, f *Stream) { f.PixelFormat = "" }, false},
		{"bit-depth-conflict", func(v, f *Stream) { v.BitDepth = "10" }, false},
		{"HEVC", func(v, f *Stream) { v.Codec = "hevc" }, false},
		{"UHD", func(v, f *Stream) { v.Width = 3840; v.Height = 2160 }, false},
		{"SD", func(v, f *Stream) { v.Width = 720; v.Height = 480 }, false},
		{"wide-gamut", func(v, f *Stream) { f.Primaries = "bt2020" }, false},
		{"other-matrix", func(v, f *Stream) { v.Space = "smpte170m" }, false},
		{"full-range", func(v, f *Stream) { f.Range = "pc" }, false},
		{"zero-mastering", func(v, f *Stream) { f.SideData = []HDRSideData{{Type: "Mastering display metadata"}} }, false},
		{"zero-CLL", func(v, f *Stream) { v.SideData = []HDRSideData{{Type: "Content light level metadata"}} }, false},
		{"dynamic-HDR", func(v, f *Stream) { f.SideData = []HDRSideData{{Type: "HDR Dynamic Metadata SMPTE2094-40 (HDR10+)"}} }, false},
		{"conflicting-colors", func(v, f *Stream) { v.Primaries = "bt709"; f.Primaries = "bt2020" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, frame := base, Stream{PixelFormat: "yuv420p"}
			tc.change(&v, &frame)
			plan, err := planHDR(v, []Stream{frame})
			if !tc.want {
				if err == nil {
					t.Fatalf("accepted ambiguous color metadata: %+v", plan)
				}
				return
			}
			if err != nil || !plan.AssumedSDR || plan.Mode != "nvidia-truehdr" || plan.Transfer != "bt709" || plan.Primaries != "bt709" || plan.Matrix != "bt709" || plan.Range != "tv" {
				t.Fatalf("SDR assumption: %+v %v", plan, err)
			}
		})
	}
	if _, err := planHDR(base, nil); err == nil {
		t.Fatal("inferred SDR without decoded-frame evidence")
	}
}

// Opt-in: uses synthetic local frames, never Plex or the user's originals.
func TestAIHDRGPU(t *testing.T) {
	nvencc := os.Getenv("SPARKLE_TEST_NVENCC")
	if nvencc == "" {
		t.Skip("set SPARKLE_TEST_NVENCC for NVIDIA TrueHDR/libplacebo qualification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	opts := Options{FFmpeg: "ffmpeg", FFprobe: "ffprobe", NVEncC: nvencc, Dir: t.TempDir(), Profile: Profile{Quality: 24, Preset: "p3", AudioSurroundKbpsPerChannel: 80}}
	const fixtureDuration = 2*SegmentSeconds + 1
	if got := aiHDRCapabilities(ctx, opts, []string{"av1", "hevc"}); len(got) != 2 {
		t.Fatalf("AI HDR capability probe: %v", got)
	}
	for _, transfer := range []string{"bt709", "smpte2084", "arib-std-b67"} {
		t.Run(transfer, func(t *testing.T) {
			input := filepath.Join(opts.Dir, transfer+".mkv")
			primaries, matrix, pixfmt := "bt2020", "bt2020nc", "yuv420p10le"
			if transfer == "bt709" {
				primaries, matrix, pixfmt = "bt709", "bt709", "yuv420p"
			}
			args := []string{"-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", strconv.Itoa(fixtureDuration), "-vf", fmt.Sprintf("format=%s,setparams=color_primaries=%s:color_trc=%s:colorspace=%s:range=limited", pixfmt, primaries, transfer, matrix), "-c:v", "hevc_nvenc", "-preset", "p3", "-color_trc", transfer, "-color_primaries", primaries, "-colorspace", matrix, "-color_range", "tv", "-c:a", "pcm_s16le", input}
			if err := run(ctx, opts.FFmpeg, args, nil); err != nil {
				t.Fatal(err)
			}
			p, err := probe(ctx, opts.FFprobe, input)
			if err != nil {
				t.Fatal(err)
			}
			plan, err := probeHDR(ctx, opts.FFprobe, input, p.video())
			if err != nil {
				t.Fatal(err)
			}
			export := os.Getenv("SPARKLE_AI_HDR_FIXTURE_DIR")
			if export != "" {
				if !filepath.IsAbs(export) {
					t.Fatal("fixture export must be absolute")
				}
				if err := os.MkdirAll(filepath.Join(export, transfer), 0755); err != nil {
					t.Fatal(err)
				}
				metadata, _ := json.Marshal(map[string]int{"duration": fixtureDuration, "segmentSeconds": SegmentSeconds})
				if err := os.WriteFile(filepath.Join(export, "fixture.json"), metadata, 0644); err != nil {
					t.Fatal(err)
				}
				data, _ := os.ReadFile(input)
				if err := os.WriteFile(filepath.Join(export, transfer, "original.mkv"), data, 0644); err != nil {
					t.Fatal(err)
				}
			}
			for _, codec := range []string{"av1", "hevc"} {
				for _, segment := range []int{0, 1, 2} {
					dir := t.TempDir()
					began := time.Now()
					if err := runAIHDR(ctx, opts, input, dir, codec, segment, fixtureDuration, p, plan); err != nil {
						t.Fatalf("%s segment %d: %v", codec, segment, err)
					}
					video := filepath.Join(dir, "video.mp4")
					out, err := probe(ctx, opts.FFprobe, video)
					if err != nil {
						t.Fatal(err)
					}
					v := out.video()
					if v.Transfer != "smpte2084" || v.Primaries != "bt2020" || v.Space != "bt2020nc" {
						t.Fatalf("output color: %+v", v)
					}
					found := false
					for _, d := range v.SideData {
						if rational(d.MaxLuminance) == 1600 {
							found = true
						}
					}
					if !found {
						t.Fatalf("missing 1600-nit mastering: %+v", v.SideData)
					}
					offset, err := shiftFragments(video, float64(segment*SegmentSeconds))
					if err != nil {
						t.Fatal(err)
					}
					packets := &limitedBuffer{limit: 1 << 20}
					if err := run(ctx, opts.FFprobe, []string{"-v", "error", "-show_packets", "-show_entries", "packet=pts_time", "-of", "json", video}, packets); err != nil {
						t.Fatal(err)
					}
					var timing struct {
						Packets []struct {
							PTS string `json:"pts_time"`
						} `json:"packets"`
					}
					if err := json.Unmarshal(packets.Bytes(), &timing); err != nil {
						t.Fatal(err)
					}
					if len(timing.Packets) != int(math.Min(SegmentSeconds, fixtureDuration-float64(segment*SegmentSeconds))*24) {
						t.Fatalf("frame count segment %d: %d", segment, len(timing.Packets))
					}
					for i, p := range timing.Packets {
						at, _ := strconv.ParseFloat(p.PTS, 64)
						want := float64(segment*SegmentSeconds) + float64(i)/24
						if math.Abs(at-want) > 0.002 {
							t.Fatalf("timestamp %f want %f", at, want)
						}
					}
					if export != "" {
						dest := filepath.Join(export, transfer, codec)
						if err := os.MkdirAll(dest, 0755); err != nil {
							t.Fatal(err)
						}
						for _, kind := range []string{"video", "audio"} {
							name := filepath.Join(dir, kind+".mp4")
							off := offset
							if kind == "audio" {
								if err := clearOpusPreSkip(name); err != nil {
									t.Fatal(err)
								}
								off, err = shiftFragments(name, float64(segment*SegmentSeconds))
								if err != nil {
									t.Fatal(err)
								}
							}
							data, err := os.ReadFile(name)
							if err != nil {
								t.Fatal(err)
							}
							if segment == 0 {
								if err := os.WriteFile(filepath.Join(dest, kind+"-init.mp4"), data[:off], 0644); err != nil {
									t.Fatal(err)
								}
							}
							if err := os.WriteFile(filepath.Join(dest, fmt.Sprintf("%s-%d.m4s", kind, segment)), data[off:], 0644); err != nil {
								t.Fatal(err)
							}
						}
					}
					t.Logf("%s segment %d %s", codec, segment, time.Since(began))
				}
			}
		})
	}
}

func TestAIHDRExpandsPixels(t *testing.T) {
	nvencc := os.Getenv("SPARKLE_TEST_NVENCC")
	if nvencc == "" {
		t.Skip("requires NVIDIA GPU")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	opts := Options{FFmpeg: "ffmpeg", FFprobe: "ffprobe", NVEncC: nvencc, Profile: Profile{Quality: 24, Preset: "p3", AudioSurroundKbpsPerChannel: 80}}
	dir := t.TempDir()
	input := filepath.Join(dir, "low-peak.mkv")
	// A ~100-nit PQ highlight on black. Static mastering alone must not
	// prevent expansion of an intentionally restrained HDR grade.
	filter := "format=yuv420p10le,geq=lum='if(lt(X,W/2),64,512)':cb=512:cr=512,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=limited"
	if err := run(ctx, opts.FFmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "color=size=320x180:rate=24", "-t", "6", "-vf", filter, "-c:v", "hevc_nvenc", "-preset", "p3", input}, nil); err != nil {
		t.Fatal(err)
	}
	p, err := probe(ctx, opts.FFprobe, input)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := probeHDR(ctx, opts.FFprobe, input, p.video())
	if err != nil {
		t.Fatal(err)
	}
	peak := func(name string) float64 {
		b := &limitedBuffer{limit: 1 << 20}
		if err := run(ctx, opts.FFmpeg, []string{"-v", "error", "-ss", "3", "-i", name, "-frames:v", "1", "-vf", "zscale=t=linear:p=bt2020:m=gbr:npl=100,format=gbrpf32le", "-f", "rawvideo", "pipe:1"}, b); err != nil {
			t.Fatal(err)
		}
		if b.Len() != 320*180*12 {
			t.Fatalf("unexpected pixels: %d", b.Len())
		}
		maxNits := 0.0
		for i := 0; i < b.Len(); i += 4 {
			maxNits = math.Max(maxNits, 100*float64(math.Float32frombits(binary.LittleEndian.Uint32(b.Bytes()[i:]))))
		}
		return maxNits
	}
	before := peak(input)
	for _, codec := range []string{"av1", "hevc"} {
		out := t.TempDir()
		if err := runAIHDR(ctx, opts, input, out, codec, 0, 6, p, plan); err != nil {
			t.Fatal(err)
		}
		after := peak(filepath.Join(out, "video.mp4"))
		t.Logf("%s %.2f -> %.2f nits", codec, before, after)
		if after < before*1.5 || after > 1800 {
			t.Fatalf("unexpected expanded peak %.2f", after)
		}
	}
}

// Optional manual qualification of a read-only source chosen by the operator.
func TestAIHDRSource(t *testing.T) {
	input, nvencc := os.Getenv("SPARKLE_AI_HDR_SOURCE"), os.Getenv("SPARKLE_TEST_NVENCC")
	if input == "" || nvencc == "" {
		t.Skip("requires explicit source and NVIDIA executable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	opts := Options{FFmpeg: "ffmpeg", FFprobe: "ffprobe", NVEncC: nvencc, Profile: Profile{Quality: 24, Preset: "p3", AudioSurroundKbpsPerChannel: 80}}
	f, err := os.Open(input)
	if err != nil {
		t.Fatal("source unavailable")
	}
	defer f.Close()
	url, closeInput, err := inputURL(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	defer closeInput()
	p, err := probe(ctx, opts.FFprobe, url)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := probeHDR(ctx, opts.FFprobe, url, p.video())
	if err != nil {
		t.Fatal(err)
	}
	duration, _ := strconv.ParseFloat(p.Format.Duration, 64)
	segment := min(120/SegmentSeconds, max(0, int(duration/SegmentSeconds)-1))
	t.Logf("source %dx%d; mode %s; mastering %.1f MaxCLL %.1f MaxFALL %.1f; Dolby %d; dynamic %v; assumed SDR %v", p.video().Width, p.video().Height, plan.Mode, plan.MasteringPeak, plan.ContentPeak, plan.AveragePeak, plan.DolbyProfile, plan.Dynamic, plan.AssumedSDR)
	for _, codec := range []string{"av1", "hevc"} {
		dir := t.TempDir()
		began := time.Now()
		// Qualify the production selector, including bounded-window/decoder
		// fallback. TestAIHDRGPUResident exercises the fast path independently.
		if err := runAIHDR(ctx, opts, url, dir, codec, segment, duration, p, plan); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s %d seconds rendered in %s", codec, SegmentSeconds, time.Since(began))
		out, err := probe(ctx, opts.FFprobe, filepath.Join(dir, "video.mp4"))
		if err != nil {
			t.Fatal(err)
		}
		grade, err := probeHDR(ctx, opts.FFprobe, filepath.Join(dir, "video.mp4"), out.video())
		if err != nil || out.video().Codec != codec || out.video().PixelFormat != "yuv420p10le" || grade.Transfer != "smpte2084" || grade.Primaries != "bt2020" || grade.Matrix != "bt2020nc" || grade.MasteringPeak != 1600 || grade.DolbyProfile != 0 || grade.Dynamic {
			t.Fatalf("invalid enhanced HDR10 output: %+v %v", grade, err)
		}
		if gpuHDRSource(p.video(), plan) {
			reference := t.TempDir()
			decode, filter, encode := aiHDRCommands(url, reference, codec, segment, duration, opts.Profile, plan)
			// This independent pixel oracle decodes from the beginning before
			// discarding the pre-roll. Input-side seeking in some HEVC MP4
			// reference files loses parameter sets and can compare
			// a later scene even though the production GPU window is correct.
			for i, arg := range decode {
				if arg == "-ss" {
					seek := append([]string{}, decode[i:i+2]...)
					decode = append(decode[:i], decode[i+2:]...)
					for j, arg := range decode {
						if arg == "-i" {
							decode = append(append(append([]string{}, decode[:j+2]...), seek...), decode[j+2:]...)
							break
						}
					}
					break
				}
			}
			if err := runPipeline(ctx, []processStep{{opts.FFmpeg, decode}, {opts.NVEncC, filter}, {opts.FFmpeg, encode}}); err != nil {
				t.Fatal(err)
			}
			for _, at := range []string{"1.5", "6", "11.5"} {
				compareHDRPixels(t, ctx, opts.FFmpeg, reference, dir, at)
			}
		}
	}
}
