package encode

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"Sparkle/internal/plex"
)

type Options struct {
	Enabled              bool
	FFmpeg, FFprobe, Dir string
	MaxBytes             int64
	TTL                  time.Duration
	Concurrency          int
	Profile              Profile
}
type source struct {
	probe    Probe
	duration float64
	key      string
	used     time.Time
	bytes    int
}
type Service struct {
	options     Options
	plex        *plex.Client
	cache       *cache
	codecs      []string
	revision    string
	cancel      context.CancelFunc
	mu          sync.Mutex
	sources     map[string]*source
	sourceBytes int
	probes      chan struct{}
}

func New(ctx context.Context, p *plex.Client, opts Options) (*Service, error) {
	ctx, cancel := context.WithCancel(ctx)
	s := &Service{options: opts, plex: p, codecs: []string{}, cancel: cancel, sources: map[string]*source{}, probes: make(chan struct{}, 2)}
	if !opts.Enabled || p == nil {
		return s, nil
	}
	if !validProfile(opts.Profile) {
		cancel()
		return nil, errors.New("invalid server encoder profile")
	}
	if err := p.ValidateWritable(opts.Dir); err != nil {
		cancel()
		return nil, err
	}
	c, err := newCache(ctx, opts.Dir, opts.MaxBytes, opts.TTL, opts.Concurrency)
	if err != nil {
		cancel()
		return nil, err
	}
	s.cache = c
	s.revision = toolRevision(ctx, opts.FFmpeg) + toolRevision(ctx, opts.FFprobe)
	s.codecs = capabilities(ctx, opts.FFmpeg, opts.Dir)
	return s, nil
}
func (s *Service) Close() {
	s.cancel()
	if s.cache != nil {
		s.cache.close()
	}
}
func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /encoding/capabilities", s.capabilities)
	mux.HandleFunc("GET /media/{id}/parts/{partId}/encoded/{codec}/{resource}", s.serve)
}
func (s *Service) capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"codecs": s.codecs, "segmentSeconds": SegmentSeconds, "quality": s.options.Profile.Quality, "preset": s.options.Profile.Preset, "audioKbps": s.options.Profile.AudioKbps})
}
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, err error) {
	status := http.StatusUnprocessableEntity
	if errors.Is(err, errBusy) {
		status = 503
		w.Header().Set("Retry-After", "2")
	}
	if errors.Is(err, plex.ErrNotFound) {
		status = 404
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func (s *Service) resolve(ctx context.Context, id, part string) (*source, *os.File, error) {
	file, err := s.plex.File(ctx, id, part)
	if err != nil {
		return nil, nil, err
	}
	failed := true
	defer func() {
		if failed {
			file.Close()
		}
	}()
	info, err := file.Stat()
	if err != nil {
		return nil, nil, errEncode
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d:%d", id, part, info.Size(), info.ModTime().UnixNano()))))
	s.mu.Lock()
	cached := s.sources[key]
	if cached != nil {
		cached.used = time.Now()
	}
	s.mu.Unlock()
	if cached != nil {
		failed = false
		return cached, file, nil
	}
	select {
	case s.probes <- struct{}{}:
		defer func() { <-s.probes }()
	case <-ctx.Done():
		return nil, nil, errEncode
	}
	// The same source can be requested concurrently by video, audio and captions.
	s.mu.Lock()
	cached = s.sources[key]
	s.mu.Unlock()
	if cached != nil {
		failed = false
		return cached, file, nil
	}
	url, closeInput, err := inputURL(ctx, file)
	if err != nil {
		return nil, nil, err
	}
	defer closeInput()
	p, err := probe(ctx, s.options.FFprobe, url)
	if err != nil {
		return nil, nil, err
	}
	if p.count("video") == 0 || p.count("audio") > 24 || p.count("subtitle") > 64 {
		return nil, nil, errEncode
	}
	duration, _ := strconv.ParseFloat(p.Format.Duration, 64)
	if !isFinitePositive(duration) || duration > 7*24*3600 {
		return nil, nil, errors.New("This media has no reliable encoded timeline")
	}
	encodedProbe, _ := json.Marshal(p)
	cached = &source{probe: p, duration: duration, key: key, used: time.Now(), bytes: len(encodedProbe)}
	s.mu.Lock()
	for len(s.sources) > 0 && (len(s.sources) >= 64 || s.sourceBytes+cached.bytes > 32<<20) {
		oldest := ""
		for k, v := range s.sources {
			if oldest == "" || v.used.Before(s.sources[oldest].used) {
				oldest = k
			}
		}
		s.sourceBytes -= s.sources[oldest].bytes
		delete(s.sources, oldest)
	}
	if old := s.sources[key]; old != nil {
		s.sourceBytes -= old.bytes
	}
	s.sources[key] = cached
	s.sourceBytes += cached.bytes
	s.mu.Unlock()
	failed = false
	return cached, file, nil
}
func isFinitePositive(v float64) bool { return v > 0 && !math.IsNaN(v) && !math.IsInf(v, 0) }

type chunkIndex struct {
	Video int64 `json:"video"`
	Audio int64 `json:"audio"`
}

func (s *Service) serve(w http.ResponseWriter, r *http.Request) {
	codec := r.PathValue("codec")
	allowed := false
	for _, c := range s.codecs {
		if c == codec {
			allowed = true
		}
	}
	if !allowed {
		failure(w, errors.New("This server's NVIDIA encoder is unavailable"))
		return
	}
	resource := r.PathValue("resource")
	if resource != "manifest" && resource != "fonts.json" && resource != "video.m3u8" && resource != "audio.m3u8" && resource != "video-init.mp4" && resource != "audio-init.mp4" && !segmentResource.MatchString(resource) {
		http.NotFound(w, r)
		return
	}
	// Encoding can outlive the API's ordinary 30-second response deadline.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(3 * time.Minute))
	source, file, err := s.resolve(r.Context(), r.PathValue("id"), r.PathValue("partId"))
	if err != nil {
		failure(w, err)
		return
	}
	defer file.Close()
	if fingerprint := r.URL.Query().Get("v"); fingerprint != "" && fingerprint != source.key {
		http.Error(w, "Media changed; reload playback", 409)
		return
	}
	if resource == "fonts.json" {
		fonts := [][]byte{}
		total := 0
		for _, track := range source.probe.Streams {
			if track.Type == "attachment" && (track.Codec == "ttf" || track.Codec == "otf") {
				data, err := unhex(track.Extra)
				if err == nil {
					total += len(data)
					if total <= 16<<20 {
						fonts = append(fonts, data)
					}
				}
			}
		}
		etag := fmt.Sprintf(`"fonts-%s"`, source.key)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
		w.Header().Set("ETag", etag)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(304)
			return
		}
		if r.Method != "HEAD" {
			_ = json.NewEncoder(w).Encode(fonts)
		}
		return
	}
	if resource == "manifest" {
		hasFonts := false
		tracks := []map[string]any{}
		index := 0
		for _, track := range source.probe.Streams {
			if track.Type == "attachment" && (track.Codec == "ttf" || track.Codec == "otf") {
				hasFonts = true
			}
			if track.Type == "subtitle" {
				title := track.Tags["title"]
				if title == "" {
					title = track.Tags["language"]
				}
				if title == "" {
					title = fmt.Sprintf("Subtitle %d", index+1)
				}
				tracks = append(tracks, map[string]any{"id": index, "title": title})
				index++
			}
		}
		video := source.probe.video()
		writeJSON(w, map[string]any{"fingerprint": source.key, "codec": codec, "output": source.probe.output(), "duration": source.duration, "width": video.Width, "height": video.Height, "audio": source.probe.count("audio") > 0, "subtitleTracks": tracks, "hasFonts": hasFonts, "segmentSeconds": SegmentSeconds})
		return
	}
	if strings.HasSuffix(resource, ".m3u8") {
		kind := strings.TrimSuffix(resource, ".m3u8")
		if kind == "audio" && source.probe.count("audio") == 0 {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "private, no-cache")
		_, _ = fmt.Fprintf(w, "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:%d\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI=\"%s-init.mp4?v=%s\"\n", SegmentSeconds, kind, source.key)
		for n := 0; n < int(math.Ceil(source.duration/SegmentSeconds)); n++ {
			_, _ = fmt.Fprintf(w, "#EXTINF:%.6f,\n%s-%d.m4s?v=%s\n", math.Min(SegmentSeconds, source.duration-float64(n*SegmentSeconds)), kind, n, source.key)
		}
		_, _ = io.WriteString(w, "#EXT-X-ENDLIST\n")
		return
	}
	kind, number, initial := parseResource(resource)
	if number < 0 || float64(number*SegmentSeconds) >= source.duration {
		http.NotFound(w, r)
		return
	}
	if kind == "audio" && source.probe.count("audio") == 0 {
		http.NotFound(w, r)
		return
	}
	cacheCodec := codec
	if kind == "subtitles" {
		cacheCodec = "subtitles"
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s:%s:%+v:%d", profileVersion, s.revision, source.key, cacheCodec, s.options.Profile, number))))
	originalInfo, err := file.Stat()
	if err != nil {
		failure(w, errEncode)
		return
	}
	_, release, err := s.cache.acquire(r.Context(), key, func(ctx context.Context, dir string) error {
		// A shared job must own a handle independently of its first HTTP waiter.
		input, err := s.plex.File(ctx, r.PathValue("id"), r.PathValue("partId"))
		if err != nil {
			return err
		}
		defer input.Close()
		current, err := input.Stat()
		if err != nil || current.Size() != originalInfo.Size() || !current.ModTime().Equal(originalInfo.ModTime()) {
			return errEncode
		}
		url, closeInput, err := inputURL(ctx, input)
		if err != nil {
			return err
		}
		defer closeInput()
		if kind == "subtitles" {
			return subtitleJSON(ctx, s.options.FFprobe, url, dir, float64(number*SegmentSeconds), source.probe)
		}
		args := encodeArgs(url, dir, codec, number, source.duration, s.options.Profile, source.probe)
		if err = run(ctx, s.options.FFmpeg, args, nil); err != nil {
			if ctx.Err() != nil {
				return err
			}
			if err = run(ctx, s.options.FFmpeg, softwareInput(args), nil); err != nil {
				return err
			}
		}
		index := chunkIndex{}
		index.Video, err = shiftFragments(filepath.Join(dir, "video.mp4"), float64(number*SegmentSeconds))
		if err != nil {
			return err
		}
		if source.probe.count("audio") > 0 {
			index.Audio, err = shiftFragments(filepath.Join(dir, "audio.mp4"), float64(number*SegmentSeconds))
			if err != nil {
				return err
			}
		}
		data, _ := json.Marshal(index)
		return os.WriteFile(filepath.Join(dir, "index.json"), data, 0644)
	})
	if err != nil {
		if r.Context().Err() == nil {
			failure(w, errEncodePublic(err))
		}
		return
	}
	defer release()
	if kind == "subtitles" {
		f, err := s.cache.root.Open(key + "/subtitles.json")
		if err != nil {
			failure(w, errEncode)
			return
		}
		serveOpenFile(w, r, f, 0, 0, "application/json", key)
		return
	}
	indexFile, err := s.cache.root.Open(key + "/index.json")
	if err != nil {
		failure(w, errEncode)
		return
	}
	data, err := io.ReadAll(io.LimitReader(indexFile, 4096))
	_ = indexFile.Close()
	var index chunkIndex
	if err != nil || json.Unmarshal(data, &index) != nil {
		failure(w, errEncode)
		return
	}
	offset := index.Video
	if kind == "audio" {
		offset = index.Audio
	}
	f, err := s.cache.root.Open(key + "/" + kind + ".mp4")
	if err != nil {
		failure(w, errEncode)
		return
	}
	if initial {
		serveOpenFile(w, r, f, 0, offset, "video/mp4", key)
	} else {
		serveOpenFile(w, r, f, offset, 0, "video/mp4", key)
	}
}
func errEncodePublic(err error) error {
	if errors.Is(err, errBusy) {
		return errBusy
	}
	return errEncode
}
func serveOpenFile(w http.ResponseWriter, r *http.Request, f *os.File, offset, length int64, mime, key string) {
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		failure(w, errEncode)
		return
	}
	if length == 0 {
		length = info.Size() - offset
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	w.Header().Set("ETag", fmt.Sprintf(`"%s-%d-%d"`, key, offset, length))
	http.ServeContent(w, r, "encoded", info.ModTime(), io.NewSectionReader(f, offset, length))
}
