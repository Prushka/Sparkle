package encode

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAIHDRGPUResident(t *testing.T) {
	nvencc := os.Getenv("SPARKLE_TEST_NVENCC")
	if nvencc == "" {
		t.Skip("requires NVIDIA GPU")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	opts := Options{FFmpeg: "ffmpeg", FFprobe: "ffprobe", NVEncC: nvencc, Profile: Profile{24, "p3", 144}}
	for _, transfer := range []string{"smpte2084", "arib-std-b67", "bt709"} {
		t.Run(transfer, func(t *testing.T) {
			input := filepath.Join(t.TempDir(), "source.mkv")
			primaries, matrix, pixfmt := "bt2020", "bt2020nc", "yuv420p10le"
			if transfer == "bt709" {
				primaries, matrix, pixfmt = "bt709", "bt709", "yuv420p"
			}
			// Colored patches with repeated bright/dark scene changes expose tone
			// curve, peak-detector history and color shifts independently of the
			// different encoders' treatment of high-frequency test-pattern edges.
			pattern := "geq=lum='if(lt(mod(T,8),4),if(lt(X,W/2),64,512),if(lt(X,W/2),256,768))':cb='if(lt(Y,H/2),480,544)':cr='if(lt(X,W/2),512,480)'"
			if transfer == "bt709" {
				pattern = "geq=lum='if(lt(mod(T,8),4),if(lt(X,W/2),16,128),if(lt(X,W/2),64,192))':cb='if(lt(Y,H/2),120,136)':cr='if(lt(X,W/2),128,120)'"
			}
			filter := fmt.Sprintf("format=%s,%s,setparams=color_primaries=%s:color_trc=%s:colorspace=%s:range=limited", pixfmt, pattern, primaries, transfer, matrix)
			if err := run(ctx, opts.FFmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "25", "-vf", filter, "-c:v", "hevc_nvenc", "-preset", "p3", "-g", "240", input}, nil); err != nil {
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
			if !gpuHDRSource(p.video(), plan) {
				t.Fatal("not admitted")
			}
			for _, codec := range []string{"av1", "hevc"} {
				for _, segment := range []int{0, 1, 2} {
					dir := t.TempDir()
					began := time.Now()
					if err := runGPUHDR(ctx, opts, input, dir, codec, segment, 25, p, plan); err != nil {
						t.Fatalf("%s segment %d: %v", codec, segment, err)
					}
					t.Logf("%s segment %d: %s", codec, segment, time.Since(began))
					if segment == 1 {
						reference := t.TempDir()
						if err := runAIHDRReferenceVideo(ctx, opts, input, reference, codec, segment, 25, p, plan); err != nil {
							t.Fatal(err)
						}
						for _, at := range []string{"0", "1.5", "3.958", "4", "4.042", "6", "8", "8.042", "11.5"} {
							compareHDRPixels(t, ctx, opts.FFmpeg, reference, dir, at)
						}
					}
				}
			}
		})
	}
}

func TestGPUHDRSourceGate(t *testing.T) {
	for _, tt := range []struct {
		name, transfer, primaries, matrix, colorRange, pixfmt, codec string
		dolby                                                        int
		want                                                         bool
	}{
		{"PQ", "smpte2084", "bt2020", "bt2020nc", "tv", "yuv420p10le", "hevc", 0, true},
		{"HLG", "arib-std-b67", "bt2020", "bt2020nc", "tv", "yuv420p10le", "av1", 0, true},
		{"SDR", "bt709", "bt709", "bt709", "tv", "yuv420p", "h264", 0, true},
		{"full-range", "smpte2084", "bt2020", "bt2020nc", "pc", "yuv420p10le", "hevc", 0, false},
		{"other-primaries", "smpte2084", "smpte432", "bt2020nc", "tv", "yuv420p10le", "hevc", 0, false},
		{"constant-luminance", "smpte2084", "bt2020", "bt2020c", "tv", "yuv420p10le", "hevc", 0, false},
		{"SDR-normalization", "bt709", "bt2020", "bt2020nc", "tv", "yuv420p10le", "hevc", 0, false},
		{"SDR-gamma", "gamma22", "bt709", "bt709", "tv", "yuv420p", "h264", 0, false},
		{"444", "smpte2084", "bt2020", "bt2020nc", "tv", "yuv444p10le", "hevc", 0, false},
		{"DV5", "smpte2084", "bt2020", "bt2020nc", "tv", "yuv420p10le", "hevc", 5, false},
		{"software-decode", "bt709", "bt709", "bt709", "tv", "yuv420p", "ffv1", 0, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			video := Stream{Transfer: tt.transfer, Primaries: tt.primaries, Space: tt.matrix, Range: tt.colorRange, PixelFormat: tt.pixfmt, Codec: tt.codec}
			plan, err := planHDR(video, nil)
			if err != nil {
				t.Fatal(err)
			}
			plan.DolbyProfile = tt.dolby
			if gpuHDRSource(video, plan) != tt.want {
				t.Fatal("incorrect normalization bypass")
			}
		})
	}
}

func TestHDRPacketTimes(t *testing.T) {
	for _, value := range []string{"N/A", "NaN", "+Inf", "-Inf"} {
		if _, err := packetTimes([]hdrPacket{{PTS: value}}); err == nil {
			t.Fatalf("accepted %s", value)
		}
	}
	if _, err := packetTimes([]hdrPacket{{PTS: "1"}, {PTS: "1"}}); err == nil {
		t.Fatal("accepted duplicate timestamps")
	}
	pts, err := packetTimes([]hdrPacket{{PTS: "0.083"}, {PTS: "0"}, {PTS: "0.042"}})
	if err != nil || len(pts) != 3 || pts[0] != 0 || pts[1] != 0.042 {
		t.Fatalf("B-frame presentation order: %v %v", pts, err)
	}
}

func TestAIHDRGPUInputTiming(t *testing.T) {
	nvencc := os.Getenv("SPARKLE_TEST_NVENCC")
	if nvencc == "" {
		t.Skip("requires NVIDIA GPU")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	opts := Options{FFmpeg: "ffmpeg", FFprobe: "ffprobe", NVEncC: nvencc, Profile: Profile{24, "p3", 144}}
	for _, tt := range []struct {
		name, codec, fps, selectFrames string
		fast                           bool
	}{
		{"fractional-HEVC", "hevc", "24000/1001", "null", true},
		{"fractional-AV1", "av1", "30000/1001", "null", true},
		{"H264-SDR", "h264", "24", "null", true},
		{"VFR", "hevc", "24", "select='not(eq(mod(n,24),23))'", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			input := filepath.Join(t.TempDir(), "source.mkv")
			filter := tt.selectFrames + ",format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited"
			if err := run(ctx, opts.FFmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=" + tt.fps, "-t", "13", "-vf", filter, "-fps_mode", "vfr", "-c:v", tt.codec + "_nvenc", "-preset", "p3", "-g", "240", input}, nil); err != nil {
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
			for _, segment := range []int{0, 1} {
				dir := t.TempDir()
				err := runGPUHDR(ctx, opts, input, dir, "av1", segment, 13, p, plan)
				if (err == nil) != tt.fast {
					t.Fatalf("segment %d fast=%v: %v", segment, tt.fast, err)
				}
				for _, name := range []string{"hdr-input.nut", "hdr-encoded.mp4"} {
					if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
						t.Fatal("transient file retained")
					}
				}
				if !tt.fast {
					if err := runAIHDRVideo(ctx, opts, input, dir, "av1", segment, 13, p, plan); err != nil {
						t.Fatalf("reference fallback: %v", err)
					}
					out, err := hdrPackets(ctx, opts.FFprobe, filepath.Join(dir, "video.mp4"))
					want := 23
					if segment == 0 {
						want *= SegmentSeconds
					}
					if err != nil || len(out) != want {
						t.Fatalf("VFR frames %d want %d: %v", len(out), want, err)
					}
				}
			}
		})
	}
}

func hdrTestPixels(t *testing.T, ctx context.Context, ffmpeg, input, at string) []uint16 {
	t.Helper()
	b := &limitedBuffer{limit: 4 << 20}
	if err := run(ctx, ffmpeg, []string{"-v", "error", "-ss", at, "-i", input, "-frames:v", "1", "-vf", "scale=320:180:flags=area,format=gbrp16le", "-f", "rawvideo", "pipe:1"}, b); err != nil {
		t.Fatal(err)
	}
	if b.Len() != 320*180*6 {
		t.Fatalf("pixel buffer: %d", b.Len())
	}
	p := make([]uint16, b.Len()/2)
	for i := range p {
		p[i] = binary.LittleEndian.Uint16(b.Bytes()[i*2:])
	}
	return p
}

func compareHDRPixels(t *testing.T, ctx context.Context, ffmpeg, reference, actual, at string) {
	t.Helper()
	a := hdrTestPixels(t, ctx, ffmpeg, filepath.Join(reference, "video.mp4"), at)
	b := hdrTestPixels(t, ctx, ffmpeg, filepath.Join(actual, "video.mp4"), at)
	var squared, absolute, signed float64
	if len(a) != len(b) {
		t.Fatal("pixel count mismatch")
	}
	for i := range a {
		delta := float64(a[i]) - float64(b[i])
		squared += delta * delta
		absolute += math.Abs(delta)
		signed += delta
	}
	rmse := math.Sqrt(squared/float64(len(a))) / 65535
	mae, bias := absolute/float64(len(a))/65535, signed/float64(len(a))/65535
	t.Logf("%s seconds: RGB error mean %.5f RMS %.5f bias %.5f", at, mae, rmse, bias)
	if mae > 0.005 || rmse > 0.025 || math.Abs(bias) > 0.003 {
		t.Fatal("HDR color/reference mismatch")
	}
}
