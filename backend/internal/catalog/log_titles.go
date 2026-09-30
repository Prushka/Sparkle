package catalog

import (
	"fmt"
	"path"
	"strings"
	"time"
)

const maxLogTitles = 256

type logTitleEntry struct {
	title string
	used  time.Time
}

// Logs reuse titles from requested details. Logging never scans the library,
// contacts Plex, or reads original media files.
func (s *Service) LogMediaTitle(id string) string {
	s.logTitleMu.Lock()
	defer s.logTitleMu.Unlock()
	entry := s.logTitles[id]
	if entry.title != "" {
		entry.used = time.Now()
		s.logTitles[id] = entry
	}
	return entry.title
}

func (s *Service) rememberLogTitle(requestedID, canonicalID string, job map[string]any) {
	title := stripMediaExtension(path.Base(strings.ReplaceAll(str(job, "Input"), `\`, "/")))
	if structured, ok := job["Title"].(map[string]any); ok {
		title = str(structured, "title")
		if episode, ok := structured["episode"].(map[string]any); ok {
			title = fmt.Sprintf("%s - %s - %s", title, str(episode, "se"), str(episode, "title"))
		}
	}
	if runes := []rune(title); len(runes) > 300 {
		title = string(runes[:300])
	}
	s.logTitleMu.Lock()
	defer s.logTitleMu.Unlock()
	for _, id := range []string{requestedID, canonicalID} {
		if _, exists := s.logTitles[id]; !exists && len(s.logTitles) >= maxLogTitles {
			var oldest string
			for key, entry := range s.logTitles {
				if oldest == "" || entry.used.Before(s.logTitles[oldest].used) {
					oldest = key
				}
			}
			delete(s.logTitles, oldest)
		}
		s.logTitles[id] = logTitleEntry{title: title, used: time.Now()}
	}
}
