package encode

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// These are output invariants, not a CPU reimplementation of the grade. The
// actual GPU shader, color conversion, codec and independent job boundaries run.
func TestAIHDRNaturalGrade(t *testing.T) {
	nvencc := os.Getenv("SPARKLE_TEST_NVENCC")
	if nvencc == "" {
		t.Skip("requires NVIDIA GPU")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	opts := Options{FFmpeg: "ffmpeg", FFprobe: "ffprobe", NVEncC: nvencc, Profile: Profile{Quality: 18, Preset: "p3"}}
	for _, sdr := range []bool{false, true} {
		t.Run(map[bool]string{false: "PQ", true: "SDR"}[sdr], func(t *testing.T) {
			dir := t.TempDir()
			input := filepath.Join(dir, "patches.mkv")
			values := []float64{0, .1, 1, 10, 50, 100, 150, 200, 400, 800, 4000}
			transfer, primaries, matrix := "smpte2084", "bt2020", "bt2020nc"
			code := func(nits float64) float64 {
				p := math.Pow(nits/10000, 2610.0/16384)
				return 64 + 876*math.Pow((3424.0/4096+2413.0/128*p)/(1+2392.0/128*p), 2523.0/32)
			}
			variable := fmt.Sprintf("if(eq(N,144),%.5f,if(between(N,145,287),%.5f,%.5f))", code(4000), code(400), code(200))
			fadeStart, fadeEnd := code(200), code(400)
			if sdr {
				values = []float64{0, .02, .05, .1, .18, .3, .5, .7, .8, .9, 1}
				transfer, primaries, matrix = "bt709", "bt709", "bt709"
				code = func(v float64) float64 { return 64 + 876*v }
				variable = fmt.Sprintf("if(between(N,144,287),%.5f,%.5f)", code(1), code(.7))
				fadeStart, fadeEnd = code(.7), code(1)
			}
			variable = fmt.Sprintf("if(gte(N,288),%.5f+%.5f*(N-288)/312,%s)", fadeStart, fadeEnd-fadeStart, variable)
			expression := variable
			for i := len(values) - 1; i >= 0; i-- {
				expression = fmt.Sprintf("if(lt(X,%d),%.5f,%s)", (i+1)*32, code(values[i]), expression)
			}
			// Upper half: fixed patches and a changing light/one-frame flash.
			// Lower half: continuous code gradient to reveal clipping/reversals.
			vf := fmt.Sprintf("format=yuv420p10le,geq=lum='if(lt(Y,H/2),%s,64+876*X/(W-1))':cb=512:cr=512,setparams=color_primaries=%s:color_trc=%s:colorspace=%s:range=limited", expression, primaries, transfer, matrix)
			if err := run(ctx, opts.FFmpeg, []string{"-v", "error", "-y", "-f", "lavfi", "-i", "color=size=384x192:rate=24", "-t", "25", "-vf", vf, "-c:v", "hevc_nvenc", "-preset", "p3", "-rc", "constqp", "-qp", "0", "-g", "48", input}, nil); err != nil {
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
			for _, codec := range []string{"av1", "hevc"} {
				t.Run(codec, func(t *testing.T) {
					continuous := filepath.Join(dir, codec+"-continuous.mp4")
					cleanup, err := writeNaturalHDRShader(dir)
					if err != nil {
						t.Fatal(err)
					}
					defer cleanup()
					args := []string{"--avsw", "-i", input, "-o", continuous, "--codec", codec, "--preset", "p3", "--cqp", "18", "--bframes", "0", "--output-depth", "10", "--output-csp", "yuv420", "--colormatrix", "bt2020nc", "--colorprim", "bt2020", "--transfer", "smpte2084", "--colorrange", "limited", "--log-level", "error"}
					args = append(args, aiHDRFilters(plan, dir)...)
					if err := run(ctx, opts.NVEncC, args, nil); err != nil {
						t.Fatal(err)
					}
					frames := []int{0, 1, 24, 143, 144, 145, 264, 287, 288, 289, 312, 552, 575, 576, 577}
					whole := naturalHDRSamples(t, ctx, continuous, frames)
					for _, frame := range frames {
						samples := whole[frame]
						if samples[0] > .02 {
							t.Fatalf("lifted black: %.4f", samples[0])
						}
						for i := 1; i < 11; i++ {
							if samples[i]+.02 < samples[i-1] || samples[i] > 1650 {
								t.Fatalf("nonmonotonic or excessive patches: %v", samples)
							}
						}
						if !sdr {
							for i := 3; i <= 7; i++ {
								if math.Abs(samples[i]-values[i]) > .05*values[i] {
									t.Fatalf("midtone %g moved to %.3f at frame %d", values[i], samples[i], frame)
								}
							}
							if samples[8] < 415 || samples[8] > 505 || samples[9] < 840 || samples[9] > 1010 || samples[10] < 1400 {
								t.Fatalf("unbounded or missing highlight enhancement: %v", samples)
							}
						} else if samples[10] < 230 || samples[10] > 275 || samples[7] < 75 || samples[7] > 95 {
							t.Fatalf("SDR white/reference brightness: %v", samples)
						}
						// The moving light, flash and cut must not pump fixed patches,
						// including the highlights that receive bounded coverage gain.
						for i := 1; i <= 9; i++ {
							if math.Abs(samples[i]-whole[24][i]) > math.Max(.05, whole[24][i]*.025) {
								t.Fatalf("pumping patch %d frame %d: %.3f vs %.3f", i, frame, samples[i], whole[24][i])
							}
						}
					}
					t.Logf("fixed patches (nits): %v", whole[24])
					previous := whole[288][11]
					for _, frame := range []int{289, 312, 552, 575, 576, 577} {
						value := whole[frame][11]
						if value < previous*.985 {
							t.Fatalf("fade reverses at frame %d: %.3f -> %.3f", frame, previous, value)
						}
						previous = value
					}
					for segment := 0; segment < 3; segment++ {
						part := t.TempDir()
						if err := runAIHDRVideo(ctx, opts, input, part, codec, segment, 25, p, plan); err != nil {
							t.Fatal(err)
						}
						local := []int{}
						for _, frame := range frames {
							if frame/288 == segment {
								local = append(local, frame-segment*288)
							}
						}
						cut := naturalHDRSamples(t, ctx, filepath.Join(part, "video.mp4"), local)
						for _, frame := range local {
							for i, value := range cut[frame] {
								want := whole[frame+segment*288][i]
								if math.Abs(value-want) > math.Max(.1, want*.04) {
									t.Fatalf("segment %d frame %d patch %d: %.3f continuous %.3f", segment, frame, i, value, want)
								}
							}
						}
						if _, err := os.Stat(filepath.Join(part, "hdr-natural.glsl")); !os.IsNotExist(err) {
							t.Fatal("retained shader intermediate")
						}
					}
				})
			}
		})
	}
}

func naturalHDRSamples(t *testing.T, ctx context.Context, input string, frames []int) map[int][]float64 {
	t.Helper()
	selects := make([]string, len(frames))
	for i, frame := range frames {
		selects[i] = "eq(n," + strconv.Itoa(frame) + ")"
	}
	b := &limitedBuffer{limit: 20 << 20}
	vf := "select='" + strings.Join(selects, "+") + "',zscale=t=linear:p=bt2020:m=gbr:npl=100,format=gbrpf32le"
	if err := run(ctx, "ffmpeg", []string{"-v", "error", "-i", input, "-vf", vf, "-fps_mode", "vfr", "-f", "rawvideo", "pipe:1"}, b); err != nil {
		t.Fatal(err)
	}
	const width, height = 384, 192
	const plane = width * height * 4
	if b.Len() != len(frames)*plane*3 {
		t.Fatalf("sample frame count: %d, expected %d", b.Len()/(plane*3), len(frames))
	}
	result := make(map[int][]float64)
	for i, frame := range frames {
		luma := func(x, y int) float64 {
			at := i*plane*3 + (y*width+x)*4
			channel := func(p int) float64 {
				return 100 * float64(math.Float32frombits(binary.LittleEndian.Uint32(b.Bytes()[at+p*plane:])))
			}
			return .6780*channel(0) + .0593*channel(1) + .2627*channel(2)
		}
		samples := make([]float64, 12)
		for patch := range samples {
			for x := 12; x < 20; x++ {
				samples[patch] += luma(patch*32+x, 48) / 8
			}
		}
		previous := luma(3, 144)
		for x := 4; x < width-4; x++ {
			value := luma(x, 144)
			if value+math.Max(.1, previous*.025) < previous || value > 1650 {
				t.Fatalf("gradient reversal/clipping frame %d x%d: %.3f -> %.3f", frame, x, previous, value)
			}
			previous = value
		}
		result[frame] = samples
	}
	return result
}
