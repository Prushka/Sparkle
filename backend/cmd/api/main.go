package main

import (
	"Sparkle/internal/catalog"
	"Sparkle/internal/config"
	"Sparkle/internal/encode"
	"Sparkle/internal/jobs"
	"Sparkle/internal/lifecycle"
	"Sparkle/internal/plex"
	"Sparkle/internal/plexauth"
	"Sparkle/internal/realtime"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const cachePruneCooldown = 3 * time.Minute

type cachePruner struct {
	jobStore *jobs.Store

	mu         sync.Mutex
	lastPruned time.Time
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}

	jobStore := jobs.NewStore(cfg.OutputDir, cfg.JobsCacheTTL)
	plexClient, err := plex.New(plex.Options{URL: cfg.PlexURL, Token: cfg.PlexToken, Mappings: cfg.PlexMappings, LibraryIDs: cfg.PlexLibraryIDs})
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}
	for _, dir := range []string{cfg.PFPDir, cfg.MediaCacheDir, cfg.PlexAuthSessionDir} {
		if err := plexClient.ValidateWritable(dir); err != nil {
			log.Fatalf("configuration error: %v", err)
		}
	}
	mediaCatalog := catalog.New(jobStore, plexClient, cfg.MediaCacheDir)
	var identity func(context.Context) (string, error)
	if plexClient != nil {
		identity = plexClient.MachineIdentifier
	}
	auth, err := plexauth.New(plexauth.Options{Identity: identity, Origins: cfg.PlexAuthOrigins, Secure: cfg.PlexAuthCookieSecure, SameSite: cfg.PlexAuthCookieSameSite,
		SessionDir: cfg.PlexAuthSessionDir, PublicDirs: []string{cfg.OutputDir, cfg.PFPDir}})
	if err != nil {
		log.Fatalf("authentication configuration error: %v", err)
	}
	defer auth.Close()
	hub := realtime.NewHub(realtime.Options{
		OutputDir:      cfg.OutputDir,
		PFPDir:         cfg.PFPDir,
		MaxUploadBytes: cfg.MaxPFPBytes,
		AuthorizeMedia: auth.RequireMedia,
		CanAccessMedia: auth.CanAccess,
		CheckOrigin:    auth.OriginAllowed,
		AccountProfile: auth.Profile,
	})
	pruner := &cachePruner{jobStore: jobStore}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := lifecycle.WatchShutdown(ctx, stop); err != nil {
		log.Fatal("could not connect to Windows launcher shutdown event")
	}
	encoder, err := encode.New(ctx, plexClient, encode.Options{Enabled: cfg.EncodeEnabled, FFmpeg: cfg.FFmpeg, FFprobe: cfg.FFprobe, Dir: filepath.Join(cfg.MediaCacheDir, "encoded"), MaxBytes: cfg.EncodeCacheBytes, TTL: cfg.EncodeCacheTTL, Concurrency: int(cfg.EncodeConcurrency), Profile: encode.Profile{Quality: int(cfg.EncodeQuality), Preset: cfg.EncodePreset, AudioKbps: int(cfg.EncodeAudioKbps)}})
	if err != nil {
		log.Fatalf("encoder configuration error: %v", err)
	}
	defer encoder.Close()
	jobStore.RefreshAsync(ctx)
	go hub.Run(ctx)

	mux := http.NewServeMux()
	auth.Register(mux)
	mediaCatalog.Register(mux)
	encoder.Register(mux)
	mux.Handle("GET /static/pfp/", auth.ProfileImages(profileFiles(cfg.PFPDir, cfg.OutputDir)))
	mux.Handle("GET /static/", staticFiles(cfg.OutputDir))
	mux.HandleFunc("GET /all", handleAll(jobStore))
	mux.HandleFunc("GET /media/{id}", mediaCatalog.Media)
	mux.HandleFunc("POST /cache/prune", pruner.Handle)
	mux.HandleFunc("POST /rooms", hub.HandleCreateRoom)
	mux.HandleFunc("GET /rooms/{room}", hub.HandleGetRoom)
	mux.HandleFunc("GET /share/rooms/{room}", hub.HandleRoomPreview)
	mux.HandleFunc("PUT /rooms/{room}", hub.HandleUpdateRoom)
	mux.HandleFunc("POST /pfp/{id}", hub.HandlePFP)
	mux.HandleFunc("GET /sync/{room}/{id}", hub.HandleWebSocket)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           auth.Middleware(withCompression(mux)),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	errs := make(chan error, 1)
	go func() {
		log.Printf("sparkle backend listening on %s", cfg.Addr)
		errs <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
	case err := <-errs:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
		return
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
	hub.Close()
	log.Print("sparkle backend stopped")
}

func (p *cachePruner) Handle(w http.ResponseWriter, _ *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	if !p.lastPruned.IsZero() {
		retryAfter := cachePruneCooldown - now.Sub(p.lastPruned)
		if retryAfter > 0 {
			w.Header().Set("Retry-After", strconvSeconds(retryAfter))
			writeJSONStatus(w, http.StatusTooManyRequests, map[string]any{
				"ok":              false,
				"cooldownSeconds": int(retryAfter.Seconds()) + 1,
			})
			return
		}
	}

	p.jobStore.Prune()
	p.lastPruned = now
	writeJSON(w, map[string]any{
		"ok":       true,
		"prunedAt": now.UnixMilli(),
	})
}

func handleAll(store *jobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, etag, err := store.Payload(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		if etag != "" {
			w.Header().Set("ETag", etag)
			if r.Header.Get("If-None-Match") == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		_, _ = w.Write(payload)
	}
}

func handleMedia(store *jobs.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		mediaID := strings.TrimSpace(r.PathValue("id"))
		if mediaID == "" {
			http.Error(w, "media id is required", http.StatusBadRequest)
			return
		}

		payload, etag, err := store.Job(r.Context(), mediaID)
		if err != nil {
			if errors.Is(err, jobs.ErrJobNotFound) {
				http.NotFound(w, r)
				return
			}
			writeJSONError(w, http.StatusInternalServerError, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		if etag != "" {
			w.Header().Set("ETag", etag)
			if r.Header.Get("If-None-Match") == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		_, _ = w.Write(payload)
	}
}

type gzipResponseWriter struct {
	http.ResponseWriter
	writer      *gzip.Writer
	wroteHeader bool
	compress    bool
}

func allowsResponseBody(status int) bool {
	return status >= http.StatusOK &&
		status != http.StatusNoContent &&
		status != http.StatusNotModified
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	if allowsResponseBody(status) {
		gzipWriter, err := gzip.NewWriterLevel(w.ResponseWriter, gzip.BestSpeed)
		if err == nil {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Del("Content-Length")
			w.writer = gzipWriter
			w.compress = true
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(payload []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.compress && w.writer != nil {
		return w.writer.Write(payload)
	}
	return w.ResponseWriter.Write(payload)
}

func withCompression(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "" ||
			strings.Contains(r.URL.Path, "/parts/") ||
			strings.Contains(r.URL.Path, "/artwork/") ||
			r.Header.Get("Range") != "" ||
			strings.HasPrefix(r.URL.Path, "/static/") ||
			!strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Add("Vary", "Accept-Encoding")
		gzipWriter := &gzipResponseWriter{ResponseWriter: w}
		defer func() {
			if gzipWriter.writer != nil {
				_ = gzipWriter.writer.Close()
			}
		}()

		next.ServeHTTP(gzipWriter, r)
	})
}

func staticFiles(outputDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/static/")
		// Job JSON and processing logs may contain private source paths. Only
		// playback assets are public; metadata is served by the sanitized API.
		ext := strings.ToLower(filepath.Ext(name))
		allowed := map[string]bool{".mp4": true, ".m4a": true, ".webm": true, ".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".vtt": true, ".ass": true, ".ssa": true, ".srt": true, ".sup": true, ".ttf": true, ".otf": true, ".woff": true, ".woff2": true}
		if !allowed[ext] || !filepath.IsLocal(name) || strings.ContainsAny(name, "\\:") {
			http.NotFound(w, r)
			return
		}
		root, err := os.OpenRoot(outputDir)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer root.Close()
		f, err := root.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		// Media responses can legitimately take longer than the API write
		// deadline when a client is buffering or seeking through a large file.
		// Clear the per-request deadline for this response only; API endpoints
		// retain the server-level WriteTimeout protection.
		_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		if strings.HasPrefix(r.URL.Path, "/static/pfp/") {
			w.Header().Set("Cache-Control", "no-store, no-cache, max-age=0")
			w.Header().Set("Pragma", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		http.ServeContent(w, r, filepath.Base(name), info.ModTime(), f)
	})
}

func profileFiles(pfpDir, outputDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/static/pfp/")
		if name == "" || filepath.Base(name) != name || !strings.HasSuffix(name, ".png") || strings.ContainsAny(name, "/\\:") {
			http.NotFound(w, r)
			return
		}
		for _, dir := range []string{pfpDir, filepath.Join(outputDir, "pfp")} {
			root, err := os.OpenRoot(dir)
			if err != nil {
				continue
			}
			f, err := root.Open(name)
			_ = root.Close()
			if err != nil {
				continue
			}
			info, err := f.Stat()
			if err != nil || !info.Mode().IsRegular() {
				_ = f.Close()
				continue
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "image/png")
			http.ServeContent(w, r, name, info.ModTime(), f)
			_ = f.Close()
			return
		}
		http.NotFound(w, r)
	})
}

func writeJSONError(w http.ResponseWriter, status int, err error) {
	writeJSONStatus(w, status, map[string]string{"error": err.Error()})
}

func writeJSON(w http.ResponseWriter, payload any) {
	writeJSONStatus(w, http.StatusOK, payload)
}

func writeJSONStatus(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func strconvSeconds(duration time.Duration) string {
	seconds := int(duration.Seconds()) + 1
	if seconds < 1 {
		seconds = 1
	}
	return strconv.Itoa(seconds)
}
