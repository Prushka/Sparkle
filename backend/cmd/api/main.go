package main

import (
	"Sparkle/internal/config"
	"Sparkle/internal/jobs"
	"Sparkle/internal/realtime"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	hub := realtime.NewHub(realtime.Options{
		OutputDir:      cfg.OutputDir,
		MaxUploadBytes: cfg.MaxPFPBytes,
	})
	pruner := &cachePruner{jobStore: jobStore}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go hub.Run(ctx)

	mux := http.NewServeMux()
	mux.Handle("GET /static/", staticFiles(cfg.OutputDir))
	mux.HandleFunc("GET /all", handleAll(jobStore))
	mux.HandleFunc("GET /media/{id}", handleMedia(jobStore))
	mux.HandleFunc("POST /cache/prune", pruner.Handle)
	mux.HandleFunc("POST /rooms", hub.HandleCreateRoom)
	mux.HandleFunc("GET /rooms/{room}", hub.HandleGetRoom)
	mux.HandleFunc("PUT /rooms/{room}", hub.HandleUpdateRoom)
	mux.HandleFunc("POST /pfp/{id}", hub.HandlePFP)
	mux.HandleFunc("GET /sync/{room}/{id}", hub.HandleWebSocket)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           withCompression(withCORS(mux)),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	errs := make(chan error, 1)
	go func() {
		log.Printf("sparkle backend listening on %s; output=%s", cfg.Addr, cfg.OutputDir)
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

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
		w.Header().Set("Access-Control-Expose-Headers", "ETag, Retry-After")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func staticFiles(outputDir string) http.Handler {
	files := http.StripPrefix("/static/", http.FileServer(http.Dir(outputDir)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/static/pfp/") {
			w.Header().Set("Cache-Control", "no-store, no-cache, max-age=0")
			w.Header().Set("Pragma", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		files.ServeHTTP(w, r)
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
