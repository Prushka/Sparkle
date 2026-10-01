package encode

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"Sparkle/internal/config"
	"Sparkle/internal/plex"
)

func previewFixture(t *testing.T) (*Service, *http.ServeMux, string, string, *source) {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "video.mkv")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/identity":
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"previews"}}`)
		case "/library/sections":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"}]}}`)
		case "/library/metadata/1":
			fmt.Fprint(w, `{"MediaContainer":{"Metadata":[{"ratingKey":"1","librarySectionID":"1","Media":[{"id":10,"Part":[{"id":20,"file":"/media/video.mkv"}]}]}]}}`)
		default:
			t.Errorf("unexpected Plex access: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	mappings, _ := json.Marshal([]plex.Mapping{{Plex: "/media", Local: root}})
	p, err := plex.New(plex.Options{URL: upstream.URL, Token: "private-fixture-token", LibraryIDs: "1", Mappings: string(mappings)})
	if err != nil {
		t.Fatal(err)
	}
	id, err := p.ID(context.Background(), "1", 10)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	c, err := newSizedCache(ctx, t.TempDir(), 128<<20, time.Hour, 2, previewMaxBytes, 15*time.Second, 50*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{plex: p, previews: c, cancel: cancel, sources: map[string]*source{}, probes: make(chan struct{}, 2), options: Options{FFmpeg: "missing-ffmpeg", FFprobe: "missing-ffprobe"}}
	t.Cleanup(s.Close)
	info, _ := os.Stat(path)
	k := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:20:%d:%d", id, info.Size(), info.ModTime().UnixNano()))))
	// Preview admission must be independent of unsupported audio.
	src := &source{key: k, duration: 12, probe: Probe{Streams: []Stream{{Type: "video", Codec: "h264"}, {Type: "audio", Channels: 100}}}, used: time.Now()}
	s.sources[k] = src
	mux := http.NewServeMux()
	s.Register(mux)
	return s, mux, "/media/" + id + "/parts/20/preview/", path, src
}

func TestPreviewRouteCacheValidatorsAndInvalidation(t *testing.T) {
	s, mux, base, path, src := previewFixture(t)
	get := func(method, suffix, etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, base+suffix, nil)
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	for _, frame := range []string{"-1.jpg", "01.jpg", "1.5.jpg", "3.jpg", "999999999.jpg", "1.png"} {
		if w := get("GET", frame, ""); w.Code != 404 {
			t.Fatalf("%s = %d", frame, w.Code)
		}
	}
	w := get("HEAD", "1.jpg", "")
	if w.Code != 200 || w.Body.Len() != 0 || len(s.previews.files) != 0 || len(s.previews.jobs) != 0 {
		t.Fatal("HEAD started extraction", w.Code)
	}
	etag := w.Header().Get("ETag")
	if w = get("GET", "1.jpg", etag); w.Code != 304 {
		t.Fatal("validator started extraction", w.Code)
	}
	k := strings.Trim(etag, `"`)
	pixels := image.NewRGBA(image.Rect(0, 0, 160, 90))
	pixels.Set(1, 1, color.White)
	var data bytes.Buffer
	if err := jpeg.Encode(&data, pixels, nil); err != nil {
		t.Fatal(err)
	}
	_, release, err := s.previews.acquire(context.Background(), k, func(_ context.Context, dir string) error {
		return os.WriteFile(filepath.Join(dir, "preview.jpg"), data.Bytes(), 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	release()
	w = get("GET", "1.jpg", "")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data.Bytes()) || w.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("cache not served: %d", w.Code)
	}
	if len(s.codecs) != 0 || s.cache != nil {
		t.Fatal("preview required video encoder")
	}
	if strings.Contains(w.Body.String(), "private-fixture-token") {
		t.Fatal("credential leaked")
	}
	if err = os.WriteFile(path, []byte("replacement file"), 0600); err != nil {
		t.Fatal(err)
	}
	w = get("GET", "1.jpg", etag)
	if w.Code == 304 || bytes.Equal(w.Body.Bytes(), data.Bytes()) {
		t.Fatal("replaced source reused image")
	}
	src.duration = 0 // No cached entry can authorize a different part/version.
	r := httptest.NewRequest("GET", strings.Replace(base, "/20/", "/21/", 1)+"1.jpg", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code == 200 {
		t.Fatal("accepted wrong part")
	}
}

func TestPreviewSizeReservationsAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c, err := newSizedCache(ctx, t.TempDir(), 2*previewMaxBytes, time.Hour, 1, previewMaxBytes, time.Second, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	if _, _, err = c.acquire(ctx, key("oversize"), func(_ context.Context, dir string) error {
		return os.WriteFile(filepath.Join(dir, "preview.jpg"), make([]byte, previewMaxBytes+1), 0600)
	}); err == nil {
		t.Fatal("oversize image accepted")
	}
	started, stopped := make(chan struct{}), make(chan struct{})
	request, stop := context.WithCancel(ctx)
	go c.acquire(request, key("cancel"), func(job context.Context, _ string) error {
		close(started)
		<-job.Done()
		close(stopped)
		return job.Err()
	})
	<-started
	stop()
	select {
	case <-stopped:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("abandoned preview was not cancelled promptly")
	}
}

// Opt-in integration uses actual SDR/PQ/HLG media and the production extractor.
// Files are never modified; generated images stay in the caller's fixture cache.
func TestPreviewFFmpegFixtures(t *testing.T) {
	root := os.Getenv("SPARKLE_PREVIEW_FIXTURE_DIR")
	if root == "" {
		t.Skip("SPARKLE_PREVIEW_FIXTURE_DIR is required")
	}
	ffmpeg, ffprobe := os.Getenv("FFMPEG"), os.Getenv("FFPROBE")
	if ffmpeg == "" || ffprobe == "" || !filepath.IsAbs(root) {
		t.Fatal("absolute fixture root and FFMPEG/FFPROBE are required")
	}
	for _, name := range []string{"bt709", "smpte2084", "arib-std-b67"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			file, err := os.Open(filepath.Join(root, name, "original.mkv"))
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			input, closeInput, err := inputURL(ctx, file)
			if err != nil {
				t.Fatal(err)
			}
			defer closeInput()
			p, err := probe(ctx, ffprobe, input)
			if err != nil {
				t.Fatal(err)
			}
			duration, _ := strconv.ParseFloat(p.Format.Duration, 64)
			for _, seconds := range []float64{0, 5, float64(int((duration-0.1)/5) * 5)} {
				output := filepath.Join(root, name, fmt.Sprintf("preview-%d.jpg", int(seconds)))
				start := time.Now()
				if err = renderPreview(ctx, ffmpeg, input, output, seconds, p.video()); err != nil {
					t.Fatal(err)
				}
				t.Logf("%s %.0fs: %s", name, seconds, time.Since(start))
			}
		})
	}
}

// Opt-in local qualification. Uses only named IDs, configured read-only Plex
// mappings, confined handles and a disposable cache. No paths/tokens in evidence.
func TestPreviewPlexMedia(t *testing.T) {
	ids := strings.Fields(os.Getenv("SPARKLE_PREVIEW_MEDIA_IDS"))
	if len(ids) == 0 {
		t.Skip("SPARKLE_PREVIEW_MEDIA_IDS is required")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal("invalid qualification configuration")
	}
	p, err := plex.New(plex.Options{URL: cfg.PlexURL, Token: cfg.PlexToken, LibraryIDs: cfg.PlexLibraryIDs, Mappings: cfg.PlexMappings})
	if err != nil {
		t.Fatal("Plex unavailable")
	}
	s, err := New(context.Background(), p, Options{PreviewsEnabled: true, PreviewDir: t.TempDir(), FFmpeg: cfg.FFmpeg, FFprobe: cfg.FFprobe})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	mux := http.NewServeMux()
	s.Register(mux)
	for _, id := range ids {
		t.Run(id, func(t *testing.T) {
			m, version, err := p.Item(context.Background(), id)
			if err != nil {
				t.Fatal("metadata unavailable")
			}
			part := ""
			for _, v := range m.Media {
				if v.ID == version && len(v.Parts) > 0 {
					part = strconv.FormatInt(v.Parts[0].ID, 10)
				}
			}
			src, file, err := s.resolveSource(context.Background(), id, part)
			if err != nil {
				t.Fatal("source unavailable")
			}
			file.Close()
			t.Logf("%s: %dx%d %s", m.Title, src.probe.video().Width, src.probe.video().Height, src.probe.output())
			for _, fraction := range []float64{0.1, 0.5, 0.9} {
				frame := int(src.duration*fraction) / previewInterval
				path := fmt.Sprintf("/media/%s/parts/%s/preview/%d.jpg", id, part, frame)
				for _, temperature := range []string{"cold", "cached"} {
					w := httptest.NewRecorder()
					start := time.Now()
					mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
					elapsed := time.Since(start)
					if w.Code != 200 {
						t.Fatalf("%s %.0f%%: HTTP %d", temperature, fraction*100, w.Code)
					}
					if _, err = jpeg.DecodeConfig(bytes.NewReader(w.Body.Bytes())); err != nil {
						t.Fatal("invalid JPEG")
					}
					t.Logf("%s %.0f%%: %s, %d bytes", temperature, fraction*100, elapsed, w.Body.Len())
				}
			}
		})
	}
}
