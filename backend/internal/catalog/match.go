package catalog

import (
	"context"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"Sparkle/internal/plex"
)

type matchIdentity struct {
	Kind, Title, EpisodeTitle string
	Year, Season, Episode     int
}
type enrichment struct {
	Poster, Backdrop, Summary string
	Year                      int
}
type matchEntry struct {
	value enrichment
	until time.Time
	done  chan struct{}
}

var movieYearRE = regexp.MustCompile(`^(.*?)\s*[\[(]((?:18|19|20|21)[0-9]{2})[\])](?:[ ._-].*)?$`)
var strictEpisodeRE = regexp.MustCompile(`(?i)^(.*?) - S([0-9]+)E([0-9]+) - (.+)$`)
var episodeMarkerRE = regexp.MustCompile(`(?i)\bS[0-9]+E[0-9]+`)
var releaseSuffixRE = regexp.MustCompile(`(?i)[ ._-]+(?:WEBDL|WEB-DL|WEBRip|BluRay|BDRip|BRRip|HDTV|DVD|Remux|[0-9]{3,4}p)(?:[ ._-].*)?$`)

func stripMediaExtension(title string) string {
	switch strings.ToLower(path.Ext(title)) {
	case ".mkv", ".mp4", ".m4v", ".avi", ".mov", ".webm", ".ts":
		title = strings.TrimSuffix(title, path.Ext(title))
	}
	return strings.TrimSpace(title)
}

func identityFromTitle(title string) matchIdentity {
	title = stripMediaExtension(title)
	if m := strictEpisodeRE.FindStringSubmatch(title); m != nil {
		season, _ := strconv.Atoi(m[2])
		episode, _ := strconv.Atoi(m[3])
		return seriesIdentity(matchIdentity{Kind: "episode", Title: m[1], Season: season, Episode: episode, EpisodeTitle: releaseSuffixRE.ReplaceAllString(m[4], "")})
	}
	if episodeMarkerRE.MatchString(title) {
		return matchIdentity{}
	}
	if m := movieYearRE.FindStringSubmatch(title); m != nil {
		year, _ := strconv.Atoi(m[2])
		return matchIdentity{Kind: "movie", Title: strings.TrimSpace(m[1]), Year: year}
	}
	// Bare movie names and multi-episode filenames cannot identify a work safely.
	return matchIdentity{}
}

func seriesIdentity(id matchIdentity) matchIdentity {
	if m := movieYearRE.FindStringSubmatch(id.Title); m != nil {
		id.Title = strings.TrimSpace(m[1])
		id.Year, _ = strconv.Atoi(m[2])
	}
	return id
}

func normalizedTitle(title string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(title), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}), " ")
}

func searchTitle(title string) string {
	// Plex title search is literal. Use the prefix before punctuation so a colon
	// versus a filename's dash does not prevent retrieval; compare full names below.
	for i, r := range title {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && !unicode.IsSpace(r) && i >= 3 {
			return strings.TrimSpace(title[:i])
		}
	}
	return title
}

func sameTitle(id matchIdentity, m plex.Metadata) bool {
	want := normalizedTitle(id.Title)
	return want != "" && (want == normalizedTitle(m.Title) || want == normalizedTitle(m.OriginalTitle)) &&
		(id.Year == 0 || id.Year == m.Year)
}

// Multiple library copies are equivalent only when Plex gives them the same
// canonical identity. Similar names or equal years alone never break a tie.
func uniqueMatch(items []plex.Metadata) (plex.Metadata, bool) {
	if len(items) == 0 {
		return plex.Metadata{}, false
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	first := items[0]
	for _, m := range items[1:] {
		if m.Key != first.Key && (first.GUID == "" || first.GUID != m.GUID) {
			return plex.Metadata{}, false
		}
	}
	return first, true
}

func (s *Service) findMatch(ctx context.Context, id matchIdentity) (enrichment, error) {
	sections, err := s.plex.Sections(ctx)
	if err != nil {
		return enrichment{}, err
	}
	kind := "show"
	if id.Kind == "movie" {
		kind = "movie"
	}
	candidates := []plex.Metadata{}
	for _, section := range sections {
		if section.Type != kind {
			continue
		}
		items, total, err := s.plex.Page(ctx, section.Key, "", searchTitle(id.Title), "titleSort:asc", 0, 32)
		if err != nil {
			return enrichment{}, err
		}
		// Unseen candidates could disambiguate a remake: never guess from a prefix.
		if total > len(items) {
			return enrichment{}, nil
		}
		for _, m := range items {
			if m.Type == kind && sameTitle(id, m) {
				candidates = append(candidates, m)
			}
		}
	}
	m, ok := uniqueMatch(candidates)
	if !ok {
		return enrichment{}, nil
	}
	show := m
	for _, step := range []struct {
		kind  string
		index int
	}{{"season", id.Season}, {"episode", id.Episode}} {
		if id.Kind == "movie" || id.Kind == "show" || (step.kind == "episode" && id.Kind != "episode") {
			break
		}
		parent, err := s.plex.ID(ctx, m.Key, 0)
		if err != nil {
			return enrichment{}, err
		}
		children, total, err := s.plex.ChildAt(ctx, parent, step.index)
		if err != nil {
			return enrichment{}, err
		}
		if total > len(children) {
			return enrichment{}, nil
		}
		matches := []plex.Metadata{}
		for _, child := range children {
			if child.Type == step.kind && child.Index == step.index && (child.ParentKey == "" || child.ParentKey == m.Key) &&
				(step.kind != "episode" || (child.ParentIndex == id.Season && normalizedTitle(child.Title) == normalizedTitle(id.EpisodeTitle))) {
				matches = append(matches, child)
			}
		}
		m, ok = uniqueMatch(matches)
		if !ok {
			return enrichment{}, nil
		}
	}
	canonical, err := s.plex.ID(ctx, m.Key, 0)
	if err != nil {
		return enrichment{}, err
	}
	value := enrichment{Summary: m.Summary, Year: m.Year}
	if m.Thumb != "" || m.ParentThumb != "" {
		value.Poster = "/media/" + canonical + "/artwork/poster"
	}
	if m.Art != "" {
		value.Backdrop = "/media/" + canonical + "/artwork/backdrop"
	}
	if id.Kind == "season" && value.Summary == "" {
		value.Summary = show.Summary
	}
	if len(value.Summary) > 8192 {
		value.Summary = strings.ToValidUTF8(value.Summary[:8192], "")
	}
	return value, nil
}

func (s *Service) matchingArtwork(ctx context.Context, id matchIdentity) enrichment {
	if ctx.Err() != nil || s.plex == nil || id.Kind == "" || id.Title == "" || len(id.Title) > 200 {
		return enrichment{}
	}
	id = seriesIdentity(id)
	s.matchMu.Lock()
	if entry, ok := s.matches[id]; ok {
		if entry.done != nil {
			s.matchMu.Unlock()
			select {
			case <-entry.done:
				return s.matchingArtwork(ctx, id)
			case <-ctx.Done():
				return enrichment{}
			}
		}
		if time.Now().Before(entry.until) {
			s.matchMu.Unlock()
			return entry.value
		}
		delete(s.matches, id)
	}
	if len(s.matches) >= 256 {
		var oldest matchIdentity
		var until time.Time
		for key, entry := range s.matches {
			if entry.done == nil && (until.IsZero() || entry.until.Before(until)) {
				oldest = key
				until = entry.until
			}
		}
		if until.IsZero() {
			s.matchMu.Unlock()
			return enrichment{}
		}
		delete(s.matches, oldest)
	}
	done := make(chan struct{})
	s.matches[id] = matchEntry{done: done}
	s.matchMu.Unlock()
	value, err := s.findMatch(ctx, id)
	s.matchMu.Lock()
	if err != nil {
		delete(s.matches, id)
	} else {
		s.matches[id] = matchEntry{value: value, until: time.Now().Add(5 * time.Minute)}
	}
	close(done)
	s.matchMu.Unlock()
	return value
}

func (s *Service) enrichPage(ctx context.Context, items []Item) {
	if s.plex == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	work := make(chan int)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range work {
				value := s.matchingArtwork(ctx, items[i].match)
				if value.Poster != "" {
					items[i].Poster = s.publicArtworkURL(value.Poster)
				}
				if value.Summary != "" {
					items[i].Summary = value.Summary
				}
				if value.Year > 0 {
					items[i].Year = value.Year
				}
			}
		}()
	}
	for i := range items {
		if items[i].Source == "processed" {
			select {
			case work <- i:
			case <-ctx.Done():
				close(work)
				wg.Wait()
				return
			}
		}
	}
	close(work)
	wg.Wait()
}
