package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	EncodeEnabled     bool
	FFmpeg            string
	FFprobe           string
	EncodeCacheBytes  int64
	EncodeCacheTTL    time.Duration
	EncodeConcurrency int64
	EncodeQuality     int64
	EncodePreset      string
	EncodeAudioKbps   int64
	PlexURL           string
	PlexToken         string
	PlexMappings      string
	PlexLibraryIDs    string
	MediaCacheDir     string
	PFPDir            string
	Addr              string
	OutputDir         string
	JobsCacheTTL      time.Duration
	MaxPFPBytes       int64
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		FFmpeg:            getenv("FFMPEG", "ffmpeg"),
		FFprobe:           getenv("FFPROBE", "ffprobe"),
		EncodeCacheBytes:  20 << 30,
		EncodeCacheTTL:    24 * time.Hour,
		EncodeConcurrency: 2,
		EncodeQuality:     22,
		EncodePreset:      getenv("ENCODE_PRESET", "p7"),
		EncodeAudioKbps:   144,
		PlexURL:           os.Getenv("PLEX_URL"),
		PlexToken:         os.Getenv("PLEX_TOKEN"),
		PlexMappings:      os.Getenv("PLEX_PATH_MAPPINGS"),
		PlexLibraryIDs:    os.Getenv("PLEX_LIBRARY_IDS"),
		MediaCacheDir:     getenv("MEDIA_CACHE_DIR", "./cache/media"),
		PFPDir:            getenv("PFP_DIR", "./data/pfp"),
		Addr:              getenv("ADDR", ":1323"),
		OutputDir:         getenv("OUTPUT", "./output"),
		JobsCacheTTL:      30 * time.Minute,
		MaxPFPBytes:       12_000_000,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		ShutdownTimeout:   10 * time.Second,
	}

	if os.Getenv("ADDR") == "" {
		if port := os.Getenv("PORT"); port != "" {
			cfg.Addr = ":" + port
		}
	}

	var err error
	if value := os.Getenv("ENCODE_ENABLED"); value != "" {
		cfg.EncodeEnabled, err = strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("ENCODE_ENABLED must be true or false")
		}
	}
	for name, target := range map[string]*int64{"ENCODE_CACHE_BYTES": &cfg.EncodeCacheBytes, "ENCODE_CONCURRENCY": &cfg.EncodeConcurrency, "ENCODE_QUALITY": &cfg.EncodeQuality, "ENCODE_AUDIO_KBPS": &cfg.EncodeAudioKbps} {
		*target, err = int64Env(name, *target)
		if err != nil {
			return Config{}, err
		}
	}
	if cfg.EncodeCacheTTL, err = durationEnv("ENCODE_CACHE_TTL", cfg.EncodeCacheTTL); err != nil {
		return Config{}, err
	}
	if cfg.EncodeCacheBytes < 512<<20 || cfg.EncodeConcurrency < 1 || cfg.EncodeConcurrency > 8 || cfg.EncodeQuality < 0 || cfg.EncodeQuality > 51 || cfg.EncodeAudioKbps < 32 || cfg.EncodeAudioKbps > 512 || len(cfg.EncodePreset) != 2 || cfg.EncodePreset[0] != 'p' || cfg.EncodePreset[1] < '1' || cfg.EncodePreset[1] > '7' {
		return Config{}, fmt.Errorf("invalid encoder settings")
	}
	if cfg.JobsCacheTTL, err = durationEnv("JOBS_CACHE_TTL", cfg.JobsCacheTTL); err != nil {
		return Config{}, err
	}
	if cfg.ReadHeaderTimeout, err = durationEnv("READ_HEADER_TIMEOUT", cfg.ReadHeaderTimeout); err != nil {
		return Config{}, err
	}
	if cfg.ReadTimeout, err = durationEnv("READ_TIMEOUT", cfg.ReadTimeout); err != nil {
		return Config{}, err
	}
	if cfg.WriteTimeout, err = durationEnv("WRITE_TIMEOUT", cfg.WriteTimeout); err != nil {
		return Config{}, err
	}
	if cfg.IdleTimeout, err = durationEnv("IDLE_TIMEOUT", cfg.IdleTimeout); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = durationEnv("SHUTDOWN_TIMEOUT", cfg.ShutdownTimeout); err != nil {
		return Config{}, err
	}
	if cfg.MaxPFPBytes, err = int64Env("MAX_PFP_BYTES", cfg.MaxPFPBytes); err != nil {
		return Config{}, err
	}
	if cfg.OutputDir == "" {
		return Config{}, fmt.Errorf("OUTPUT must not be empty")
	}
	if cfg.MaxPFPBytes <= 0 {
		return Config{}, fmt.Errorf("MAX_PFP_BYTES must be greater than zero")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func durationEnv(key string, fallback time.Duration) (time.Duration, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("%s must be greater than zero", key)
	}
	return value, nil
}

func int64Env(key string, fallback int64) (int64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return value, nil
}
