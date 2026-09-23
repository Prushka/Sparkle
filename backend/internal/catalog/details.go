package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"Sparkle/internal/plex"
)

// MediaDetails is shared by both catalogs. Legacy capitalized job fields remain
// alongside these fields so existing processed clients and links keep working.
type MediaDetails struct {
	Item
	Artwork  map[string]string `json:"artwork"`
	Versions any               `json:"versions"`
	Parts    any               `json:"parts"`
	Tracks   any               `json:"tracks"`
	Chapters any               `json:"chapters"`
}

func (s *Service) Details(ctx context.Context, id string) (map[string]any, error) {
	var job map[string]any
	if strings.HasPrefix(id, "plex-") {
		raw, err := s.RawJob(ctx, id)
		if err != nil {
			return nil, err
		}
		job = raw
	} else {
		payload, _, err := s.jobs.Job(ctx, id)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &job); err != nil {
			return nil, err
		}
		lookup, cancel := context.WithTimeout(ctx, 4*time.Second)
		match := s.matchingArtwork(lookup, identityFromTitle(str(job, "Input")))
		cancel()
		if match.Poster != "" {
			job["Poster"] = match.Poster
		}
		if match.Summary != "" {
			job["Summary"] = match.Summary
		}
		if match.Year > 0 {
			job["Year"] = match.Year
		}
		if match.Backdrop != "" {
			job["Backdrop"] = match.Backdrop
		}
	}
	canonical := str(job, "Id")
	source := str(job, "Source")
	if source == "" {
		source = "processed"
	}
	title := str(job, "Input")
	poster := str(job, "Poster")
	if poster == "" {
		poster = "/static/" + canonical + "/poster.jpg"
	}
	details := MediaDetails{Item: Item{ID: canonical, Source: source, Kind: "movie", Title: title, SortTitle: title, Summary: str(job, "Summary"), Poster: poster, Duration: number(job, "Duration"), AddedAt: int64(number(job, "JobModTime"))}, Artwork: map[string]string{"poster": poster}, Versions: []any{}, Parts: []any{}, Tracks: job["Streams"], Chapters: job["Chapters"]}
	if raw, ok := job["Raw"].(map[string]any); ok {
		metadata, _, err := s.plex.Item(ctx, canonical)
		if err != nil {
			return nil, err
		}
		details.Item, err = s.plexItem(ctx, metadata)
		if err != nil {
			return nil, err
		}
		details.ID = canonical
		details.Duration = number(job, "Duration")
		if metadata.ParentKey != "" {
			details.ParentID, _ = s.plex.ID(ctx, metadata.ParentKey, 0)
		}
		details.Versions = raw["versions"]
		details.Parts = raw["parts"]
		details.Artwork["backdrop"] = "/media/" + canonical + "/artwork/backdrop"
		tracks := []any{}
		for _, part := range raw["parts"].([]map[string]any) {
			tracks = append(tracks, map[string]any{"partId": part["id"], "streams": part["streams"]})
		}
		details.Tracks = tracks
	} else {
		details.Year = int(number(job, "Year"))
		if backdrop := str(job, "Backdrop"); backdrop != "" {
			details.Artwork["backdrop"] = backdrop
		}
		if match := episodeRE.FindStringSubmatch(title); match != nil {
			details.Kind = "episode"
		}
		details.Versions = []any{map[string]any{"id": canonical, "label": "Encoded", "codecs": job["EncodedCodecs"]}}
	}
	b, _ := json.Marshal(details)
	fields := map[string]any{}
	_ = json.Unmarshal(b, &fields)
	for k, v := range fields {
		job[k] = v
	}
	return job, nil
}

func (s *Service) Media(w http.ResponseWriter, r *http.Request) {
	job, err := s.Details(r.Context(), r.PathValue("id"))
	if err != nil {
		status := http.StatusNotFound
		if errors.Is(err, plex.ErrUnavailable) {
			status = http.StatusServiceUnavailable
		}
		fail(w, status, "Media is unavailable")
		return
	}
	payload, err := json.Marshal(job)
	if err != nil {
		fail(w, 500, "Media is unavailable")
		return
	}
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(payload))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(304)
		return
	}
	_, _ = w.Write(payload)
}
