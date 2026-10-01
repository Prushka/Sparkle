package encode

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image/jpeg"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"Sparkle/internal/plex"
)

const previewInterval = 5
const previewMaxBytes = 256 << 10
const previewRevision = "preview-jpeg-sdr-v1"

// Previews have their own small cache and two bounded extraction workers. They neither
// need an NVENC session nor compete for the video encoder's pipeline slots.
func (s *Service) preview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-cache")
	if s.previews == nil || s.plex == nil {
		http.NotFound(w, r)
		return
	}
	frame := r.PathValue("frame")
	n, err := strconv.Atoi(strings.TrimSuffix(frame, ".jpg"))
	if err != nil || n < 0 || n > 7*24*3600/previewInterval || frame != strconv.Itoa(n)+".jpg" {
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	src, file, err := s.resolveSource(ctx, r.PathValue("id"), r.PathValue("partId"))
	if err != nil {
		if errors.Is(err, plex.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		previewFailure(w)
		return
	}
	defer file.Close()
	seconds := float64(n * previewInterval)
	if seconds >= src.duration {
		http.NotFound(w, r)
		return
	}
	info, err := file.Stat()
	if err != nil {
		previewFailure(w)
		return
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s:%d", previewRevision, s.revision, src.key, n))))
	w.Header().Set("ETag", `"`+key+`"`)
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Authentication and the source fingerprint are checked even for validators.
	if r.Header.Get("If-None-Match") == `"`+key+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	// A HEAD probe must never start an image job.
	if r.Method == http.MethodHead {
		return
	}
	_, release, err := s.previews.acquire(ctx, key, func(jobCtx context.Context, dir string) error {
		// The job owns its handle; cancelling its first waiter cannot break another.
		input, err := s.plex.File(jobCtx, r.PathValue("id"), r.PathValue("partId"))
		if err != nil {
			return err
		}
		defer input.Close()
		current, err := input.Stat()
		if err != nil || current.Size() != info.Size() || !current.ModTime().Equal(info.ModTime()) {
			return errEncode
		}
		url, closeInput, err := inputURL(jobCtx, input)
		if err != nil {
			return err
		}
		defer closeInput()
		return renderPreview(jobCtx, s.options.FFmpeg, url, filepath.Join(dir, "preview.jpg"), seconds, src.probe.video())
	})
	if err != nil {
		previewFailure(w)
		return
	}
	defer release()
	image, err := s.previews.root.Open(key + "/preview.jpg")
	if err != nil {
		previewFailure(w)
		return
	}
	defer image.Close()
	if ctx.Err() != nil {
		return
	}
	http.ServeContent(w, r, "preview.jpg", info.ModTime(), image)
}

func previewFailure(w http.ResponseWriter) {
	w.Header().Del("ETag")
	w.Header().Set("Retry-After", "5")
	w.Header().Set("Cache-Control", "private, no-store")
	http.Error(w, "Preview unavailable", http.StatusServiceUnavailable)
}

func previewArgs(input, output string, seconds float64, video Stream) []string {
	// Accurate input seeking decodes only the preceding GOP. Scale before the
	// floating-point HDR conversion, keeping expensive color work at preview size.
	filter := "scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1"
	if video.dolby5() {
		// Profile 5 has no ordinary YCbCr base. libplacebo must apply the RPU;
		// never serve the unreshaped green/purple image on filter failure.
		filter = "libplacebo=w=320:h=180:force_original_aspect_ratio=decrease:force_divisible_by=2:apply_dolbyvision=1:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=pc:format=yuv420p,setsar=1"
	} else if video.Transfer == "smpte2084" || video.Transfer == "arib-std-b67" {
		filter += ",zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=2,zscale=p=bt709:t=bt709:m=bt709:r=full,format=yuvj420p"
	} else {
		filter += ",format=yuvj420p"
	}
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2", "-filter_threads", "1"}
	args = append(args, inputRestrictions(input)...)
	if !video.dolby5() {
		args = append(args, "-hwaccel", "auto")
		if video.Codec == "av1" {
			args = append(args, "-c:v", "av1")
		}
	}
	args = append(args, "-ss", fmt.Sprintf("%.3f", seconds), "-i", input, "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-vf", filter, "-c:v", "mjpeg", "-threads", "1", "-q:v", "4", "-f", "image2", "-update", "1", output)
	return args
}

func renderPreview(ctx context.Context, binary, input, output string, seconds float64, video Stream) error {
	args := previewArgs(input, output, seconds, video)
	if err := run(ctx, binary, args, nil); err != nil {
		if ctx.Err() != nil {
			return err
		}
		if err = run(ctx, binary, softwareDecodeInput(args), nil); err != nil {
			return err
		}
	}
	f, err := os.Open(output)
	if err != nil {
		return errEncode
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() > previewMaxBytes {
		return errEncode
	}
	image, err := jpeg.DecodeConfig(f)
	if err != nil || image.Width < 1 || image.Height < 1 || image.Width > 320 || image.Height > 180 {
		return errEncode
	}
	return nil
}
