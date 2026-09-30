package encode

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Only bypass zscale where its normalization is an identity. Other SDR color
// spaces, full range, and Dolby Vision Profile 5 retain the reference pipeline.
func gpuHDRSource(video Stream, plan hdrPlan) bool {
	if !containsCodec([]string{"hevc", "h264", "av1"}, video.Codec) || plan.DolbyProfile == 5 || plan.Range != "tv" {
		return false
	}
	if plan.Mode == "sdr-expansion" {
		return plan.Primaries == "bt709" && plan.Matrix == "bt709" && plan.Transfer == "bt709" && video.PixelFormat == "yuv420p"
	}
	return plan.Primaries == "bt2020" && plan.Matrix == "bt2020nc" && video.PixelFormat == "yuv420p10le"
}

type hdrPacket struct {
	PTS   string `json:"pts_time"`
	Flags string `json:"flags"`
}

func hdrPackets(ctx context.Context, ffprobe, input string) ([]hdrPacket, error) {
	data := &limitedBuffer{limit: 2 << 20}
	if err := run(ctx, ffprobe, []string{"-v", "error", "-protocol_whitelist", "file", "-select_streams", "v:0", "-show_packets", "-show_entries", "packet=pts_time,flags", "-of", "json", input}, data); err != nil {
		return nil, err
	}
	var result struct {
		Packets []hdrPacket `json:"packets"`
	}
	if json.Unmarshal(data.Bytes(), &result) != nil || len(result.Packets) == 0 || len(result.Packets) > 16384 {
		return nil, errAIHDR
	}
	return result.Packets, nil
}

func packetTimes(packets []hdrPacket) ([]float64, error) {
	pts := make([]float64, len(packets))
	for i, p := range packets {
		value, err := strconv.ParseFloat(p.PTS, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, errAIHDR
		}
		pts[i] = value
	}
	sort.Float64s(pts)
	for i := 1; i < len(pts); i++ {
		if pts[i] <= pts[i-1] {
			return nil, errAIHDR
		}
	}
	return pts, nil
}

// Decode, scene-adaptive filtering and encoding share NVEncC GPU surfaces.
// FFmpeg only copies compressed packets at the boundaries. The transient input
// window is bounded, video-only, private to this job and removed before caching.
func runGPUHDR(ctx context.Context, opts Options, input, dir, codec string, segment int, duration float64, source Probe, plan hdrPlan) error {
	cleanup, err := writeNaturalHDRShader(dir)
	if err != nil {
		return err
	}
	defer cleanup()
	clip, encoded := filepath.Join(dir, "hdr-input.nut"), filepath.Join(dir, "hdr-encoded.mp4")
	defer os.Remove(clip)
	defer os.Remove(encoded)
	start := float64(segment * SegmentSeconds)
	end := math.Min(start+SegmentSeconds, duration)
	warm := math.Max(0, start-2)
	args := append([]string{"-v", "error", "-nostdin", "-y"}, inputRestrictions(input)...)
	args = append(args, "-ss", fmt.Sprintf("%.6f", warm), "-i", input, "-t", fmt.Sprintf("%.6f", end+0.5), "-copyts", "-start_at_zero", "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "copy")
	// The reference raw-frame pipe intentionally drops source SEI/RPU. Preserve
	// that behavior: the classified metadata seeds our identical GPU filter.
	units := map[string]string{"hevc": "39|40|62|63", "h264": "6", "av1": "5"}[source.video().Codec]
	args = append(args, "-bsf:v", "filter_units=remove_types="+units, "-avoid_negative_ts", "disabled", "-fs", strconv.FormatInt(maxJobBytes/2, 10), "-f", "nut", clip)
	if err := run(ctx, opts.FFmpeg, args, nil); err != nil {
		return err
	}
	info, err := os.Stat(clip)
	if err != nil || info.Size() >= maxJobBytes/2 {
		return errAIHDR
	}
	packets, err := hdrPackets(ctx, opts.FFprobe, clip)
	if err != nil {
		return err
	}
	pts, err := packetTimes(packets)
	if err != nil {
		return err
	}
	first := sort.Search(len(pts), func(i int) bool { return pts[i] >= warm-0.000001 })
	cut := sort.Search(len(pts), func(i int) bool { return pts[i] >= start-0.000001 })
	last := sort.Search(len(pts), func(i int) bool { return pts[i] >= end-0.000001 })
	if (first >= cut && start > 0) || cut >= last || first >= len(pts) || pts[first]-warm > 0.25 || pts[last-1] < end-0.25 {
		return fmt.Errorf("GPU window does not cover the segment: %w", errAIHDR)
	}
	if (last == len(pts) && end < duration-0.000001) || pts[0] < warm-30 {
		return errAIHDR
	}
	// NVEncC disables external keyframes with --trim. For constant frame rate,
	// a closed GOP exactly as long as the lead-in gives a decodable boundary.
	// Keep variable-frame-rate sources on the reference path instead of rounding
	// or dropping their frames to fit this optimization.
	fps := rational(source.video().FrameRate)
	if fps < 1 || fps > 240 {
		return errAIHDR
	}
	for i := first; i < last; i++ {
		if math.Abs(pts[i]-pts[first]-float64(i-first)/fps) > 0.002 {
			return errAIHDR
		}
	}
	gop := cut - first
	if gop == 0 {
		gop = int(math.Ceil(2 * fps))
	}
	// NVEncC's implicit maximum can otherwise cap QVBR at 20/24 Mbps. Keep a
	// generous ceiling rather than changing constant-quality encoding to a low
	// bitrate profile. The shared job byte budget still bounds these files.
	encode := []string{"--avhw", "--input-format", "nut", "--input-option", "protocol_whitelist:file", "-i", clip, "-o", encoded, "--trim", fmt.Sprintf("%d:%d", first, last-1), "--avsync", "vfr", "--timebase", "1/90000", "--codec", codec, "--preset", opts.Profile.Preset, "--tune", "hq", "--qvbr", strconv.Itoa(opts.Profile.Quality), "--max-bitrate", "500000", "--qp-init", fmt.Sprintf("%d:%d:%d", max(0, opts.Profile.Quality-2), opts.Profile.Quality, min(51, opts.Profile.Quality+2)), "--multipass", "none", "--bframes", "0", "--gop-len", strconv.Itoa(gop), "--strict-gop", "--output-depth", "10", "--output-csp", "yuv420", "--colormatrix", "bt2020nc", "--colorprim", "bt2020", "--transfer", "smpte2084", "--colorrange", "limited", "--log-level", "error"}
	encode = append(encode, aiHDRFilters(plan, dir)...)
	// Set mastering/light metadata in the final MP4, as in the reference path.
	// NVEncC --master-display also alters libplacebo's target gamut, changing
	// the grade even when dst_max is explicit. Do not set it on this process.
	if err := run(ctx, opts.NVEncC, encode, nil); err != nil {
		return err
	}
	// Verify actual output timestamps and the independently decodable boundary
	// before copying. An unsupported decoder/muxer uses the reference path.
	out, err := hdrPackets(ctx, opts.FFprobe, encoded)
	if err != nil || len(out) != last-first {
		return fmt.Errorf("GPU frame count %d, expected %d: %w", len(out), last-first, errAIHDR)
	}
	for i, p := range out {
		at, e := strconv.ParseFloat(p.PTS, 64)
		if e != nil || math.IsNaN(at) || math.IsInf(at, 0) || math.Abs(at-(pts[first+i]-pts[first])) > 0.002 {
			return fmt.Errorf("GPU timestamp %d is %.6f, expected %.6f: %w", i, at, pts[first+i]-pts[first], errAIHDR)
		}
	}
	if !strings.Contains(out[cut-first].Flags, "K") {
		return fmt.Errorf("GPU boundary frame %d is not a keyframe: %w", cut-first, errAIHDR)
	}
	if err := os.Remove(clip); err != nil {
		return errAIHDR
	}
	lead := pts[cut] - pts[first]
	mux := []string{"-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file", "-ss", fmt.Sprintf("%.6f", lead), "-i", encoded, "-t", fmt.Sprintf("%.6f", end-pts[cut]), "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "copy"}
	if codec == "hevc" {
		mux = append(mux, "-tag:v", "hvc1")
	}
	mux = append(mux, fragmentArgs(start)...)
	mux = append(mux, filepath.Join(dir, "video.mp4"))
	if err := run(ctx, opts.FFmpeg, mux, nil); err != nil {
		return err
	}
	final, err := hdrPackets(ctx, opts.FFprobe, filepath.Join(dir, "video.mp4"))
	if err != nil || len(final) != last-cut {
		return fmt.Errorf("final frame count %d expected %d: %w", len(final), last-cut, errAIHDR)
	}
	if !strings.Contains(final[0].Flags, "K") {
		return errAIHDR
	}
	for i, p := range final {
		at, e := strconv.ParseFloat(p.PTS, 64)
		// The fragmented MP4 muxer starts at zero; shiftFragments applies the
		// shared segment origin after this file is complete.
		if e != nil || math.IsNaN(at) || math.IsInf(at, 0) || math.Abs(at-(pts[cut+i]-pts[cut])) > 0.002 {
			return fmt.Errorf("final timestamp %d is %.6f expected %.6f: %w", i, at, pts[cut+i]-pts[cut], errAIHDR)
		}
	}
	return nil
}
