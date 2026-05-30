package main

import (
	"Sparkle/internal/config"
	"Sparkle/internal/jobs"
	"Sparkle/internal/realtime"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go hub.Run(ctx)

	mux := http.NewServeMux()
	mux.Handle("GET /static/", staticFiles(cfg.OutputDir))
	mux.HandleFunc("GET /all", handleAll(jobStore))
	mux.HandleFunc("POST /pfp/{id}", hub.HandlePFP)
	mux.HandleFunc("GET /sync/{room}/{id}", hub.HandleWebSocket)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           withCORS(mux),
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

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

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
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
