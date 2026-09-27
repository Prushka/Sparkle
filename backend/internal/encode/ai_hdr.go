package encode

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const aiHDRVersion = "ai-hdr-1600-v2"
const aiHDRPeak = 1600

var errAIHDR = errors.New("AI HDR is unavailable; check NVEncC, NVIDIA TrueHDR, libplacebo and the GPU")
var errHDRMetadata = errors.New("AI HDR cannot safely interpret this video's color metadata")

func aiHDRToolRevision(binary string) string {
	name, err := exec.LookPath(binary)
	if err != nil {
		return "unavailable"
	}
	// NVEncC's filters live in separately versioned DLLs. Invalidate enhanced
	// derivatives when either the executable or an adjacent dependency changes.
	entries, _ := os.ReadDir(filepath.Dir(name))
	identity := ""
	for _, entry := range entries {
		if entry.IsDir() || (entry.Name() != filepath.Base(name) && !strings.EqualFold(filepath.Ext(entry.Name()), ".dll")) {
			continue
		}
		if info, err := entry.Info(); err == nil {
			identity += fmt.Sprintf("%s:%d:%d;", entry.Name(), info.Size(), info.ModTime().UnixNano())
		}
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(identity)))
}

// ffprobe reports container configuration and decoded bitstream SEI separately.
// Mastering maximum describes a display, not the brightest pixel in the movie.
type HDRSideData struct {
	Type          string  `json:"side_data_type"`
	Profile       int     `json:"dv_profile"`
	Compatibility int     `json:"dv_bl_signal_compatibility_id"`
	Enhancement   int     `json:"el_present_flag"`
	MaxLuminance  string  `json:"max_luminance"`
	MinLuminance  string  `json:"min_luminance"`
	MaxContent    float64 `json:"max_content"`
	MaxAverage    float64 `json:"max_average"`
}

type hdrPlan struct {
	Mode                                    string
	Transfer, Primaries, Matrix, Range      string
	SourcePeak                              float64
	MasteringPeak, ContentPeak, AveragePeak float64
	DolbyProfile                            int
	Dynamic, Enhancement                    bool
}

func rational(value string) float64 {
	parts := strings.Split(value, "/")
	n, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || len(parts) > 2 {
		return 0
	}
	if len(parts) == 2 {
		d, err := strconv.ParseFloat(parts[1], 64)
		if err != nil || d <= 0 {
			return 0
		}
		n /= d
	}
	if !isFinitePositive(n) {
		return 0
	}
	return n
}

func knownColor(s string) bool { return s != "" && s != "unknown" && s != "unspecified" }

func containsCodec(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

func (s *Service) hdrPlan(ctx context.Context, source *source, file *os.File) (hdrPlan, error) {
	source.hdrMu.Lock()
	defer source.hdrMu.Unlock()
	if source.hdr != nil {
		return *source.hdr, nil
	}
	select {
	case s.probes <- struct{}{}:
		defer func() { <-s.probes }()
	case <-ctx.Done():
		return hdrPlan{}, errEncode
	}
	url, closeInput, err := inputURL(ctx, file)
	if err != nil {
		return hdrPlan{}, err
	}
	defer closeInput()
	p, err := probeHDR(ctx, s.options.FFprobe, url, source.probe.video())
	if err == nil {
		source.hdr = &p
	}
	return p, err
}

func planHDR(video Stream, frames []Stream) (hdrPlan, error) {
	p := hdrPlan{Transfer: video.Transfer, Primaries: video.Primaries, Matrix: video.Space, Range: video.Range}
	all := append([]Stream{video}, frames...)
	for _, frame := range all {
		for _, pair := range []struct {
			target *string
			value  string
		}{
			{&p.Transfer, frame.Transfer}, {&p.Primaries, frame.Primaries}, {&p.Matrix, frame.Space}, {&p.Range, frame.Range},
		} {
			if !knownColor(pair.value) {
				continue
			}
			if knownColor(*pair.target) && *pair.target != pair.value {
				return p, errHDRMetadata
			}
			*pair.target = pair.value
		}
		for _, d := range frame.SideData {
			if d.Profile > 0 {
				if p.DolbyProfile != 0 && p.DolbyProfile != d.Profile {
					return p, errHDRMetadata
				}
				p.DolbyProfile = d.Profile
				p.Enhancement = d.Enhancement != 0
				if d.Profile == 8 && d.Compatibility == 4 && !knownColor(p.Transfer) {
					p.Transfer = "arib-std-b67"
				}
			}
			p.Dynamic = p.Dynamic || strings.Contains(d.Type, "2094-40") || strings.Contains(d.Type, "Dolby Vision") || strings.Contains(d.Type, "DOVI")
			p.MasteringPeak = max(p.MasteringPeak, rational(d.MaxLuminance))
			p.ContentPeak = max(p.ContentPeak, d.MaxContent)
			p.AveragePeak = max(p.AveragePeak, d.MaxAverage)
		}
	}
	if p.DolbyProfile != 0 && p.DolbyProfile != 5 && p.DolbyProfile != 7 && p.DolbyProfile != 8 {
		return p, errHDRMetadata
	}
	if p.DolbyProfile == 5 {
		p.Transfer, p.Primaries, p.Matrix, p.Range = "smpte2084", "bt2020", "bt2020nc", "tv"
	} else if p.DolbyProfile == 7 && !knownColor(p.Transfer) {
		p.Transfer = "smpte2084"
	}
	switch p.Transfer {
	case "smpte2084", "arib-std-b67":
		p.Mode = "hdr-expansion"
		if !knownColor(p.Primaries) {
			p.Primaries = "bt2020"
		}
		if !knownColor(p.Matrix) {
			p.Matrix = "bt2020nc"
		}
	case "bt709", "smpte170m", "bt470bg", "gamma22", "gamma28", "iec61966-2-1", "bt2020-10", "bt2020-12":
		if p.DolbyProfile != 0 || p.Dynamic || p.MasteringPeak > 203 || p.ContentPeak > 203 {
			return p, errHDRMetadata
		}
		p.Mode = "nvidia-truehdr"
	default:
		// An untagged source may be SDR, PQ or log. Never feed it blindly to TrueHDR.
		return p, errHDRMetadata
	}
	if !knownColor(p.Matrix) || !knownColor(p.Primaries) {
		return p, errHDRMetadata
	}
	// Metadata becomes filter option values, so allow only understood enums.
	if !containsCodec([]string{"bt709", "bt470bg", "smpte170m", "bt2020nc", "bt2020c"}, p.Matrix) ||
		!containsCodec([]string{"bt709", "bt470m", "bt470bg", "smpte170m", "smpte240m", "bt2020", "smpte431", "smpte432"}, p.Primaries) {
		return p, errHDRMetadata
	}
	if !knownColor(p.Range) {
		p.Range = "tv"
	}
	if p.Range != "tv" && p.Range != "pc" {
		return p, errHDRMetadata
	}
	// These are seeds/fallbacks only. The GPU analyzes actual frame luminance,
	// including low-peak grades with 1,000-nit mastering tags and zero MaxCLL.
	p.SourcePeak = 1000
	if p.MasteringPeak >= 203 && p.MasteringPeak <= 10000 {
		p.SourcePeak = p.MasteringPeak
	}
	if p.ContentPeak > 0 && p.ContentPeak <= 10000 && (p.AveragePeak == 0 || p.AveragePeak <= p.ContentPeak) {
		p.SourcePeak = p.ContentPeak
	}
	return p, nil
}

func probeHDR(ctx context.Context, binary, input string, video Stream) (hdrPlan, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	b := &limitedBuffer{limit: 2 << 20}
	args := append([]string{"-v", "error"}, inputRestrictions(input)...)
	args = append(args, "-select_streams", "v:0", "-read_intervals", "%+#8", "-show_frames", "-show_entries", "frame=color_range,color_space,color_primaries,color_transfer,pix_fmt:frame_side_data", "-of", "json", input)
	if err := run(ctx, binary, args, b); err != nil {
		return hdrPlan{}, err
	}
	var result struct {
		Frames []Stream `json:"frames"`
	}
	if json.Unmarshal(b.Bytes(), &result) != nil || len(result.Frames) == 0 {
		return hdrPlan{}, errHDRMetadata
	}
	return planHDR(video, result.Frames)
}

// Raw NUT pipes retain frame timestamps and precision, and never create a
// decoded intermediate file. NVEncC runs filters only; FFmpeg still owns NVENC,
// the precise trim, closed GOPs and the existing fragment timeline.
func aiHDRCommands(input, dir, codec string, segment int, duration float64, profile Profile, plan hdrPlan) (decode, filter, encode []string) {
	start := float64(segment * SegmentSeconds)
	length := math.Min(SegmentSeconds, duration-start)
	lead := math.Min(2, start)
	decode = append([]string{"-hide_banner", "-v", "error", "-nostdin"}, inputRestrictions(input)...)
	decode = append(decode, "-ss", fmt.Sprintf("%.6f", start-lead), "-i", input, "-t", fmt.Sprintf("%.6f", length+lead), "-map", "0:v:0", "-an", "-sn", "-dn")
	conversion := fmt.Sprintf("zscale=pin=%s:tin=%s:min=%s:rin=%s:p=bt2020:t=%s:m=bt2020nc:r=limited,format=yuv420p10le", plan.Primaries, plan.Transfer, plan.Matrix, plan.Range, plan.Transfer)
	if plan.DolbyProfile == 5 {
		conversion = "libplacebo=apply_dolbyvision=1:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=tv:format=yuv420p10le"
	}
	// Frame color metadata is explicit here: rawvideo/NUT does not reliably
	// transport it through NVEncC. Normalize SDR to Rec.709 before TrueHDR.
	if plan.Mode == "nvidia-truehdr" {
		trc := plan.Transfer
		if trc == "gamma22" {
			trc = "bt470m"
		}
		if trc == "gamma28" {
			trc = "bt470bg"
		}
		conversion = fmt.Sprintf("zscale=pin=%s:tin=%s:min=%s:rin=%s:p=bt709:t=bt709:m=bt709:r=limited,format=yuv420p", plan.Primaries, trc, plan.Matrix, plan.Range)
	}
	decode = append(decode, "-vf", conversion, "-fps_mode", "vfr", "-c:v", "rawvideo", "-f", "nut", "pipe:1")
	filter = []string{"--avsw", "--input-format", "nut", "--input-option", "protocol_whitelist:pipe", "-i", "-", "-o", "-", "-c", "raw", "--output-format", "nut", "--output-depth", "10", "--output-csp", "yuv444", "--avsync", "vfr", "--timebase", "1/90000", "--log-level", "error", "--colormatrix", "bt2020nc", "--colorprim", "bt2020", "--transfer", "smpte2084"}
	filter = append(filter, aiHDRFilters(plan)...)
	encode = []string{"-hide_banner", "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "pipe", "-f", "nut", "-i", "pipe:0", "-ss", fmt.Sprintf("%.6f", lead), "-t", fmt.Sprintf("%.6f", length), "-map_metadata", "-1", "-map_chapters", "-1"}
	encode = append(encode, videoArgs(codec, profile, Stream{})...)
	// Independent fragments and the Opus track share a zero presentation origin.
	// HEVC's default B-frame reorder delay would otherwise offset video by 2 frames.
	encode = append(encode, "-bf", "0")
	for i, arg := range encode {
		if arg == "-vf" {
			encode[i+1] += ",setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=limited"
		}
	}
	encode = append(encode, "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-color_range", "tv")
	encode = append(encode, fragmentArgs(start)...)
	encode = append(encode, filepath.Join(dir, "video.mp4"))
	return
}

// Both pipelines use exactly the same analysis, tone curve and gamut mapping.
func aiHDRFilters(plan hdrPlan) []string {
	matrix, primaries, transfer := "bt2020nc", "bt2020", plan.Transfer
	if plan.Mode == "nvidia-truehdr" {
		matrix, primaries, transfer = "bt709", "bt709", "bt709"
	}
	filter := []string{"--vpp-colorspace", fmt.Sprintf("matrix=%s:%s,colorprim=%s:%s,transfer=%s:%s", matrix, matrix, primaries, primaries, transfer, transfer)}
	if plan.Mode == "nvidia-truehdr" {
		filter = append(filter, "--vpp-ngx-truehdr", "maxluminance=1600,contrast=125,saturation=75,middlegray=44")
	} else {
		csp := "hdr10"
		if transfer == "arib-std-b67" {
			csp = "hlg"
		}
		filter = append(filter, "--vpp-libplacebo-tonemapping", fmt.Sprintf("src_csp=%s,dst_csp=hdr10,src_max=%.4f,dst_max=1600,dst_min=0.005,tonemapping_function=spline,inverse_tone_mapping=true,dynamic_peak_detection=true,smooth_period=8,knee_adaptation=0,gamut_mapping=perceptual,use_dovi=false", csp, plan.SourcePeak))
	}
	return filter
}

func runAIHDR(ctx context.Context, opts Options, input, dir, codec string, segment int, duration float64, source Probe, plan hdrPlan) error {
	if err := runAIHDRVideo(ctx, opts, input, dir, codec, segment, duration, source, plan); err != nil {
		return err
	}
	if err := writeHDRMastering(filepath.Join(dir, "video.mp4")); err != nil {
		return err
	}
	return runAIHDRAudio(ctx, opts, input, dir, codec, segment, duration, source)
}

func runAIHDRVideo(ctx context.Context, opts Options, input, dir, codec string, segment int, duration float64, source Probe, plan hdrPlan) error {
	if gpuHDRSource(source.video(), plan) {
		if err := runGPUHDR(ctx, opts, input, dir, codec, segment, duration, source, plan); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return errAIHDR
		}
	}
	return runAIHDRReferenceVideo(ctx, opts, input, dir, codec, segment, duration, source, plan)
}

// Preserve the normalized reference path for source formats/colors that cannot
// yet use the GPU path, and for decoders whose timestamps cannot be preserved.
func runAIHDRReferenceVideo(ctx context.Context, opts Options, input, dir, codec string, segment int, duration float64, source Probe, plan hdrPlan) error {
	decode, filter, encode := aiHDRCommands(input, dir, codec, segment, duration, opts.Profile, plan)
	if plan.DolbyProfile != 5 {
		for i, arg := range decode {
			if arg == "-i" {
				accel := []string{"-hwaccel", "auto"}
				if source.video().Codec == "av1" {
					accel = append(accel, "-c:v", "av1")
				}
				decode = append(append(append([]string{}, decode[:i]...), accel...), decode[i:]...)
				break
			}
		}
	}
	if err := runPipeline(ctx, []processStep{{opts.FFmpeg, decode}, {opts.NVEncC, filter}, {opts.FFmpeg, encode}}); err != nil {
		if ctx.Err() != nil || runPipeline(ctx, []processStep{{opts.FFmpeg, softwareDecodeInput(decode)}, {opts.NVEncC, filter}, {opts.FFmpeg, encode}}) != nil {
			return errAIHDR
		}
	}
	return nil
}

func runAIHDRAudio(ctx context.Context, opts Options, input, dir, codec string, segment int, duration float64, source Probe) error {
	if source.count("audio") > 0 {
		// Reuse the established Opus warm-up/trimming policy exactly, dropping
		// only its video output. The source remains a confined read-only handle.
		args := encodeArgs(input, dir, codec, segment, duration, opts.Profile, source)
		inputEnd, audioStart := 0, 0
		for i, arg := range args {
			if arg == "-i" {
				inputEnd = i + 2
			}
			if arg == filepath.Join(dir, "video.mp4") {
				audioStart = i + 1
				break
			}
		}
		if inputEnd == 0 || audioStart == 0 {
			return errEncode
		}
		args = append(args[:inputEnd:inputEnd], args[audioStart:]...)
		if err := run(ctx, opts.FFmpeg, softwareDecodeInput(args), nil); err != nil {
			return err
		}
	}
	return nil
}

func aiHDRCapabilities(ctx context.Context, opts Options, codecs []string) []string {
	available := []string{}
	for _, codec := range codecs {
		ok := true
		for _, transfer := range []string{"bt709", "smpte2084"} {
			check, cancel := context.WithTimeout(ctx, 30*time.Second)
			dir, err := os.MkdirTemp(opts.Dir, "ai-hdr-probe-")
			if err != nil {
				cancel()
				ok = false
				break
			}
			plan, _ := planHDR(Stream{Transfer: transfer, Primaries: "bt709", Space: "bt709", Range: "tv"}, nil)
			decode, filter, encode := aiHDRCommands("probe", dir, codec, 0, 0.125, opts.Profile, plan)
			decode = []string{"-v", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=256x144:rate=24", "-frames:v", "3", "-vf", "format=yuv420p10le", "-c:v", "rawvideo", "-f", "nut", "pipe:1"}
			err = runPipeline(check, []processStep{{opts.FFmpeg, decode}, {opts.NVEncC, filter}, {opts.FFmpeg, encode}})
			if err == nil {
				err = writeHDRMastering(filepath.Join(dir, "video.mp4"))
			}
			os.Remove(filepath.Join(dir, "video.mp4"))
			os.Remove(dir)
			cancel()
			if err != nil {
				ok = false
				break
			}
		}
		if ok {
			available = append(available, codec)
		}
	}
	return available
}
