package catalog

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"Sparkle/internal/jobs"
	"Sparkle/internal/plex"
)

type Item struct {
	ID        string  `json:"id"`
	Source    string  `json:"source"`
	LibraryID string  `json:"libraryId,omitempty"`
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	SortTitle string  `json:"sortTitle"`
	Summary   string  `json:"summary,omitempty"`
	Poster    string  `json:"poster,omitempty"`
	Year      int     `json:"year,omitempty"`
	AddedAt   int64   `json:"addedAt"`
	Duration  float64 `json:"duration"`
	Index     int     `json:"index,omitempty"`
	ParentID  string  `json:"parentId,omitempty"`
	Children  int     `json:"children,omitempty"`
	match     matchIdentity
}
type Page struct {
	Items      []Item   `json:"items"`
	NextCursor string   `json:"nextCursor,omitempty"`
	Total      int      `json:"total"`
	Warnings   []string `json:"warnings,omitempty"`
}
type Service struct {
	jobs    *jobs.Store
	plex    *plex.Client
	secret  []byte
	artwork *artCache
	matchMu sync.Mutex
	matches map[matchIdentity]matchEntry
}

func New(j *jobs.Store, p *plex.Client, cacheDir string) *Service {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(err)
	}
	return &Service{jobs: j, plex: p, secret: secret, artwork: newArtCache(cacheDir), matches: map[matchIdentity]matchEntry{}}
}

type query struct {
	Source, Library, Kind, Search, Sort, Parent string
	Limit                                       int
}
type cursor struct {
	Query   query          `json:"q"`
	Offsets map[string]int `json:"o"`
	Expires int64          `json:"e"`
}

func (s *Service) encodeCursor(c cursor) string {
	b, _ := json.Marshal(c)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + hex.EncodeToString(mac.Sum(nil))
}
func (s *Service) decodeCursor(raw string, q query) (cursor, error) {
	c := cursor{Query: q, Offsets: map[string]int{}, Expires: time.Now().Add(15 * time.Minute).Unix()}
	if raw == "" {
		return c, nil
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || len(raw) > 8192 {
		return c, errors.New("invalid page cursor")
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return c, errors.New("invalid page cursor")
	}
	sig, err := hex.DecodeString(parts[1])
	mac := hmac.New(sha256.New, s.secret)
	mac.Write(b)
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) || json.Unmarshal(b, &c) != nil || c.Query != q || c.Expires < time.Now().Unix() {
		return c, errors.New("page cursor expired or filters changed; refresh the library")
	}
	return c, nil
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /library/sources", s.sources)
	mux.HandleFunc("GET /library/items", s.browse)
	mux.HandleFunc("GET /library/items/{id}/children", s.browse)
	mux.HandleFunc("GET /media/{id}/parts/{partId}/file", s.file)
	mux.HandleFunc("GET /media/{id}/artwork/{kind}", s.art)
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func (s *Service) sources(w http.ResponseWriter, r *http.Request) {
	sources := []map[string]string{{"id": "processed", "title": "Encoded", "source": "processed"}}
	warnings := []string{}
	if s.plex != nil {
		sections, err := s.plex.Sections(r.Context())
		if err != nil {
			warnings = append(warnings, err.Error())
		} else {
			for _, section := range sections {
				sources = append(sources, map[string]string{"id": section.Key, "title": section.Title, "source": "plex", "kind": section.Type})
			}
		}
	}
	jsonResponse(w, 200, map[string]any{"sources": sources, "warnings": warnings})
}

func parseQuery(r *http.Request) (query, error) {
	v := r.URL.Query()
	q := query{Source: v.Get("source"), Library: v.Get("libraryId"), Kind: v.Get("kind"), Search: strings.TrimSpace(v.Get("query")), Sort: v.Get("sort"), Parent: r.PathValue("id"), Limit: 48}
	if q.Source == "" {
		q.Source = "all"
	}
	if q.Kind == "" {
		q.Kind = "all"
	}
	if q.Sort == "" {
		q.Sort = "recent-desc"
	}
	if v.Get("limit") != "" {
		n, err := strconv.Atoi(v.Get("limit"))
		if err != nil || n < 1 || n > 100 {
			return q, errors.New("limit must be between 1 and 100")
		}
		q.Limit = n
	}
	if q.Source != "all" && q.Source != "processed" && q.Source != "plex" {
		return q, errors.New("invalid source")
	}
	if q.Kind != "all" && q.Kind != "movies" && q.Kind != "shows" {
		return q, errors.New("invalid media kind")
	}
	if _, ok := plexSort[q.Sort]; !ok {
		return q, errors.New("invalid sort")
	}
	if len(q.Search) > 200 {
		return q, errors.New("search is too long")
	}
	return q, nil
}

var plexSort = map[string]string{"recent-desc": "addedAt:desc", "recent-asc": "addedAt:asc", "title-asc": "titleSort:asc", "title-desc": "titleSort:desc", "duration-desc": "duration:desc", "duration-asc": "duration:asc"}

func (s *Service) browse(w http.ResponseWriter, r *http.Request) {
	q, err := parseQuery(r)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	c, err := s.decodeCursor(r.URL.Query().Get("cursor"), q)
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	type batch struct {
		key   string
		items []Item
		total int
		err   error
	}
	batches := []batch{}
	if q.Source != "plex" && q.Library == "" && !strings.HasPrefix(q.Parent, "plex-") {
		items, e := s.processed(r.Context(), q)
		total := len(items)
		off := c.Offsets["processed"]
		if off > len(items) {
			off = len(items)
		}
		end := min(off+q.Limit, len(items))
		batches = append(batches, batch{"processed", items[off:end], total, e})
	}
	if s.plex != nil && q.Source != "processed" && !strings.HasPrefix(q.Parent, "processed-") {
		sections, e := s.plex.Sections(r.Context())
		if e != nil {
			batches = append(batches, batch{err: e})
		} else {
			var wg sync.WaitGroup
			var mu sync.Mutex
			semaphore := make(chan struct{}, 4)
			for _, section := range sections {
				if q.Library != "" && q.Library != section.Key {
					continue
				}
				if q.Parent == "" && ((q.Kind == "movies" && section.Type != "movie") || (q.Kind == "shows" && section.Type != "show")) {
					continue
				}
				if q.Parent != "" {
					parent, _, e := s.plex.Item(r.Context(), q.Parent)
					if e != nil {
						mu.Lock()
						batches = append(batches, batch{err: e})
						mu.Unlock()
						break
					}
					if parent.SectionID != section.Key {
						continue
					}
				}
				wg.Add(1)
				go func(section plex.Section) {
					defer wg.Done()
					semaphore <- struct{}{}
					defer func() { <-semaphore }()
					key := "plex-" + section.Key
					metadata, total, e := s.plex.Page(r.Context(), section.Key, q.Parent, q.Search, plexSort[q.Sort], c.Offsets[key], q.Limit)
					items := []Item{}
					if e == nil {
						for _, m := range metadata {
							item, er := s.plexItem(r.Context(), m)
							if er != nil {
								e = er
								break
							}
							items = append(items, item)
						}
					}
					mu.Lock()
					batches = append(batches, batch{key, items, total, e})
					mu.Unlock()
				}(section)
			}
			wg.Wait()
		}
	}
	page := Page{Items: []Item{}}
	totals := map[string]int{}
	sort.Slice(batches, func(i, j int) bool { return batches[i].key < batches[j].key })
	positions := make([]int, len(batches))
	for _, b := range batches {
		if b.err != nil {
			page.Warnings = append(page.Warnings, b.err.Error())
			continue
		}
		page.Total += b.total
		totals[b.key] = b.total
	}
	// Merge only the head of each source. Plex's locale/natural collation may
	// differ from Go's comparison; re-sorting a source page can consume a
	// non-prefix and skip/duplicate titles on the following cursor.
	for len(page.Items) < q.Limit {
		best := -1
		for i, b := range batches {
			if b.err != nil || positions[i] >= len(b.items) {
				continue
			}
			if best < 0 || less(b.items[positions[i]], batches[best].items[positions[best]], q) {
				best = i
			}
		}
		if best < 0 {
			break
		}
		b := batches[best]
		page.Items = append(page.Items, b.items[positions[best]])
		positions[best]++
		c.Offsets[b.key]++
	}
	for key, total := range totals {
		if c.Offsets[key] < total {
			page.NextCursor = s.encodeCursor(c)
			break
		}
	}
	if len(page.Items) == 0 && len(page.Warnings) > 0 {
		fail(w, 503, page.Warnings[0])
		return
	}
	s.enrichPage(r.Context(), page.Items)
	jsonResponse(w, 200, page)
}

func less(a, b Item, q query) bool {
	if q.Parent != "" && a.Index != b.Index {
		return a.Index < b.Index
	}
	var cmp int
	switch q.Sort {
	case "title-asc", "title-desc":
		cmp = strings.Compare(strings.ToLower(a.SortTitle), strings.ToLower(b.SortTitle))
	case "duration-asc", "duration-desc":
		if a.Duration < b.Duration {
			cmp = -1
		} else if a.Duration > b.Duration {
			cmp = 1
		}
	default:
		if a.AddedAt < b.AddedAt {
			cmp = -1
		} else if a.AddedAt > b.AddedAt {
			cmp = 1
		}
	}
	if cmp == 0 {
		return a.ID < b.ID
	}
	if strings.HasSuffix(q.Sort, "desc") {
		return cmp > 0
	}
	return cmp < 0
}

func (s *Service) plexItem(ctx context.Context, m plex.Metadata) (Item, error) {
	version := int64(0)
	if len(m.Media) > 0 {
		version = m.Media[0].ID
	}
	id, err := s.plex.ID(ctx, m.Key, version)
	if err != nil {
		return Item{}, err
	}
	titleSort := m.SortTitle
	if titleSort == "" {
		titleSort = m.Title
	}
	return Item{ID: id, Source: "plex", LibraryID: m.SectionID, Kind: m.Type, Title: m.Title, SortTitle: titleSort, Summary: m.Summary, Poster: "/media/" + id + "/artwork/poster", Year: m.Year, AddedAt: m.AddedAt, Duration: m.Duration / 1000, Index: m.Index, Children: m.ChildCount}, nil
}

var episodeRE = regexp.MustCompile(`(?i)^(.*?) - S([0-9]+)E([0-9]+)(?:[^ ]*) - (.*)$`)

func str(m map[string]any, key string) string { v, _ := m[key].(string); return v }
func number(m map[string]any, key string) float64 {
	switch v := m[key].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	}
	return 0
}
func processedGroup(title string) string {
	hash := sha256.Sum256([]byte(strings.ToLower(title)))
	return fmt.Sprintf("processed-show-%x", hash[:10])
}
func (s *Service) processed(ctx context.Context, q query) ([]Item, error) {
	data, err := s.jobs.JSON(ctx)
	if err != nil {
		return nil, errors.New("processed library is unavailable")
	}
	var records []map[string]any
	if json.Unmarshal(data, &records) != nil {
		return nil, errors.New("invalid processed catalog")
	}
	items := []Item{}
	groups := map[string]Item{}
	for _, job := range records {
		if state := str(job, "State"); state != "" && state != "complete" {
			continue
		}
		title := str(job, "Input")
		title = strings.TrimSuffix(title, ".mkv")
		id := str(job, "Id")
		item := Item{ID: id, Source: "processed", Kind: "movie", Title: title, SortTitle: title, AddedAt: int64(number(job, "JobModTime")), Duration: number(job, "Duration"), Poster: "/static/" + url.PathEscape(id) + "/poster.jpg"}
		item.match = identityFromTitle(title)
		item.Year = item.match.Year
		match := episodeRE.FindStringSubmatch(title)
		if match != nil {
			season, _ := strconv.Atoi(match[2])
			episode, _ := strconv.Atoi(match[3])
			showID := processedGroup(match[1])
			seasonID := showID + "-" + strconv.Itoa(season)
			item.Kind = "episode"
			item.Index = episode
			item.Title = fmt.Sprintf("S%02dE%02d · %s", season, episode, match[4])
			item.ParentID = seasonID
			if q.Parent == seasonID {
				if q.Search == "" || strings.Contains(strings.ToLower(item.Title), strings.ToLower(q.Search)) {
					items = append(items, item)
				}
				continue
			}
			if q.Parent == showID {
				if _, ok := groups[seasonID]; !ok {
					groups[seasonID] = Item{ID: seasonID, Source: "processed", Kind: "season", Title: fmt.Sprintf("Season %d", season), SortTitle: match[1], Index: season, Poster: item.Poster, match: matchIdentity{Kind: "season", Title: match[1], Season: season}}
				}
				continue
			}
			if q.Parent != "" || q.Kind == "movies" {
				continue
			}
			g := groups[showID]
			if g.ID == "" {
				g = Item{ID: showID, Source: "processed", Kind: "show", Title: match[1], SortTitle: match[1], Poster: item.Poster, match: matchIdentity{Kind: "show", Title: match[1]}}
			}
			g.Children++
			g.Duration += item.Duration
			g.AddedAt = max(g.AddedAt, item.AddedAt)
			groups[showID] = g
			continue
		}
		if q.Parent == "" && q.Kind != "shows" {
			items = append(items, item)
		}
	}
	for _, g := range groups {
		items = append(items, g)
	}
	filtered := items[:0]
	for _, item := range items {
		if q.Search == "" || strings.Contains(strings.ToLower(item.Title), strings.ToLower(q.Search)) {
			filtered = append(filtered, item)
		}
	}
	sort.Slice(filtered, func(i, j int) bool { return less(filtered[i], filtered[j], q) })
	return filtered, nil
}

// RawJob keeps the legacy processed response intact while adding an explicit
// source/Raw descriptor understood by the frontend adapter.
func (s *Service) RawJob(ctx context.Context, id string) (map[string]any, error) {
	if s.plex == nil {
		return nil, plex.ErrNotFound
	}
	m, version, err := s.plex.Item(ctx, id)
	if err != nil {
		return nil, err
	}
	if m.Type != "movie" && m.Type != "episode" {
		return nil, plex.ErrNotFound
	}
	var selected *plex.Media
	versions := []map[string]any{}
	for i := range m.Media {
		v := &m.Media[i]
		vid, e := s.plex.ID(ctx, m.Key, v.ID)
		if e != nil {
			return nil, e
		}
		versions = append(versions, map[string]any{"id": vid, "label": fmt.Sprintf("%dp · %s · %s", v.Height, strings.ToUpper(v.VideoCodec), strings.ToUpper(v.AudioCodec))})
		if v.ID == version || (version == 0 && selected == nil) {
			selected = v
		}
	}
	if selected == nil || len(selected.Parts) == 0 {
		return nil, plex.ErrNotFound
	}
	canonical, _ := s.plex.ID(ctx, m.Key, selected.ID)
	parts := []map[string]any{}
	offset := float64(0)
	for _, p := range selected.Parts {
		duration := p.Duration / 1000
		if duration == 0 && len(selected.Parts) == 1 {
			duration = selected.Duration / 1000
			if duration == 0 {
				duration = m.Duration / 1000
			}
		}
		if duration <= 0 {
			return nil, errors.New("This media version has no reliable part timeline; choose another version")
		}
		parts = append(parts, map[string]any{"id": strconv.FormatInt(p.ID, 10), "url": "/media/" + canonical + "/parts/" + strconv.FormatInt(p.ID, 10) + "/file", "size": p.Size, "duration": duration, "start": offset, "streams": p.Streams})
		offset += duration
	}
	duration := offset
	title := map[string]any{"titleId": canonical, "title": m.Title, "id": canonical, "modTime": m.AddedAt}
	if m.Type == "episode" {
		showID, _ := s.plex.ID(ctx, m.GrandparentKey, 0)
		title["titleId"] = showID
		title["title"] = m.GrandparentTitle
		title["episode"] = map[string]any{"title": m.Title, "id": canonical, "season": m.ParentIndex, "episode": m.Index, "se": fmt.Sprintf("S%02dE%02d", m.ParentIndex, m.Index)}
	}
	chapters := []map[string]any{}
	for _, ch := range m.Chapters {
		chapters = append(chapters, map[string]any{"start": ch.Start / 1000, "end": ch.End / 1000, "tags": map[string]string{"title": ch.Title}})
	}
	return map[string]any{"Id": canonical, "Source": "plex", "Input": m.Title, "State": "complete", "Title": title, "Summary": m.Summary, "Poster": "/media/" + canonical + "/artwork/poster", "Duration": duration, "width": selected.Width, "height": selected.Height, "JobModTime": m.AddedAt, "EncodedCodecs": []string{}, "MappedAudio": map[string]any{}, "Files": map[string]int{}, "Streams": []any{}, "DominantColors": []string{}, "Chapters": chapters, "Raw": map[string]any{"container": selected.Container, "videoCodec": selected.VideoCodec, "parts": parts, "versions": versions}}, nil
}
