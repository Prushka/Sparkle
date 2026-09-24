// Package plex is a read-only Plex metadata client and confined local file resolver.
package plex

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("media is unavailable")
var ErrUnavailable = errors.New("Plex is unavailable; check the backend configuration and connection")

type Mapping struct {
	Plex  string `json:"plex"`
	Local string `json:"local"`
}
type Options struct{ URL, Token, LibraryIDs, Mappings, CacheDir string }
type cacheEntry struct {
	data  []byte
	until time.Time
}
type Client struct {
	base       *url.URL
	token      string
	allowed    map[string]bool
	mappings   []Mapping
	http       *http.Client
	mu         sync.Mutex
	cache      map[string]cacheEntry
	cacheBytes int
	requests   chan struct{}
	identity   string
	machineID  string
	initMu     sync.Mutex
}

func New(opts Options) (*Client, error) {
	if opts.URL == "" && opts.Token == "" && opts.Mappings == "" {
		return nil, nil
	}
	u, err := url.Parse(opts.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("PLEX_URL must be an HTTP(S) server URL without credentials or query parameters")
	}
	if opts.Token == "" {
		return nil, errors.New("PLEX_TOKEN is required")
	}
	var mappings []Mapping
	if json.Unmarshal([]byte(opts.Mappings), &mappings) != nil || len(mappings) == 0 {
		return nil, errors.New("PLEX_PATH_MAPPINGS must be a nonempty JSON array; use forward slashes in Windows paths")
	}
	for i := range mappings {
		m := &mappings[i]
		m.Plex = strings.TrimRight(strings.ReplaceAll(m.Plex, "\\", "/"), "/")
		if m.Plex == "" || (!path.IsAbs(m.Plex) && !regexp.MustCompile(`^[A-Za-z]:/`).MatchString(m.Plex)) || m.Local == "" || !filepath.IsAbs(m.Local) || path.Clean(m.Plex) != m.Plex {
			return nil, errors.New("Plex mappings require clean absolute roots")
		}
		m.Local, err = filepath.Abs(m.Local)
		if err != nil {
			return nil, errors.New("invalid local media root")
		}
		info, e := os.Stat(m.Local)
		if e != nil || !info.IsDir() {
			return nil, fmt.Errorf("local media mapping %d is not an accessible directory", i+1)
		}
	}
	sort.Slice(mappings, func(i, j int) bool { return len(mappings[i].Plex) > len(mappings[j].Plex) })
	allowed := map[string]bool{}
	for _, id := range strings.Split(opts.LibraryIDs, ",") {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if !digits.MatchString(id) {
			return nil, errors.New("PLEX_LIBRARY_IDS must contain numeric section IDs")
		}
		allowed[id] = true
	}
	return &Client{base: u, token: opts.Token, allowed: allowed, mappings: mappings, cache: map[string]cacheEntry{}, requests: make(chan struct{}, 8), http: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

var digits = regexp.MustCompile(`^[0-9]+$`)
var mediaID = regexp.MustCompile(`^plex-([a-f0-9]{12})-([0-9]+)-([0-9]+)$`)

func (c *Client) get(ctx context.Context, endpoint string, query url.Values, target any) error {
	// Deliberate allowlist: Plex has GET endpoints that mutate state too.
	if endpoint != "/identity" && endpoint != "/library/sections" && !regexp.MustCompile(`^/library/(sections/[0-9]+/all|metadata/[0-9]+(/children)?)$`).MatchString(endpoint) {
		return ErrNotFound
	}
	key := endpoint + "?" + query.Encode()
	c.mu.Lock()
	entry, ok := c.cache[key]
	c.mu.Unlock()
	if ok && time.Now().Before(entry.until) {
		return json.Unmarshal(entry.data, target)
	}
	select {
	case c.requests <- struct{}{}:
		defer func() { <-c.requests }()
	case <-ctx.Done():
		return ErrUnavailable
	}
	u := *c.base
	u.Path = strings.TrimRight(u.Path, "/") + endpoint
	u.RawQuery = query.Encode()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	req.Header.Set("X-Plex-Token", c.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Plex-Product", "Sparkle")
	req.Header.Set("X-Plex-Client-Identifier", "sparkle-readonly")
	res, err := c.http.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return ErrNotFound
	}
	if res.StatusCode != 200 {
		return ErrUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 8*1024*1024+1))
	if err != nil || len(data) > 8*1024*1024 {
		return ErrUnavailable
	}
	if json.Unmarshal(data, target) != nil {
		return ErrUnavailable
	}
	c.mu.Lock()
	if old, exists := c.cache[key]; exists {
		c.cacheBytes -= len(old.data)
		delete(c.cache, key)
	}
	for k, v := range c.cache {
		if time.Now().After(v.until) || len(c.cache) >= 256 || c.cacheBytes+len(data) > 32*1024*1024 {
			c.cacheBytes -= len(v.data)
			delete(c.cache, k)
		}
	}
	c.cache[key] = cacheEntry{data, time.Now().Add(time.Minute)}
	c.cacheBytes += len(data)
	c.mu.Unlock()
	return nil
}

func (c *Client) Identity(ctx context.Context) (string, error) {
	if _, err := c.MachineIdentifier(ctx); err != nil {
		return "", err
	}
	c.initMu.Lock()
	defer c.initMu.Unlock()
	return c.identity, nil
}

// MachineIdentifier is used only by server-side Plex membership verification.
func (c *Client) MachineIdentifier(ctx context.Context) (string, error) {
	c.initMu.Lock()
	defer c.initMu.Unlock()
	if c.machineID != "" {
		return c.machineID, nil
	}
	var r Response
	if err := c.get(ctx, "/identity", nil, &r); err != nil {
		return "", err
	}
	if r.Container.MachineIdentifier == "" {
		return "", ErrUnavailable
	}
	h := sha256.Sum256([]byte(r.Container.MachineIdentifier))
	c.identity = fmt.Sprintf("%x", h[:6])
	c.machineID = r.Container.MachineIdentifier
	return c.machineID, nil
}

func (c *Client) ID(ctx context.Context, key string, version int64) (string, error) {
	server, err := c.Identity(ctx)
	if err != nil {
		return "", err
	}
	if !digits.MatchString(key) {
		return "", ErrNotFound
	}
	return fmt.Sprintf("plex-%s-%s-%d", server, key, version), nil
}

func (c *Client) parseID(ctx context.Context, id string) (string, int64, error) {
	m := mediaID.FindStringSubmatch(id)
	if m == nil {
		return "", 0, ErrNotFound
	}
	server, err := c.Identity(ctx)
	if err != nil {
		return "", 0, err
	}
	if m[1] != server {
		return "", 0, ErrNotFound
	}
	version, err := strconv.ParseInt(m[3], 10, 64)
	if err != nil {
		return "", 0, ErrNotFound
	}
	return m[2], version, nil
}

func (c *Client) Sections(ctx context.Context) ([]Section, error) {
	var r Response
	if err := c.get(ctx, "/library/sections", nil, &r); err != nil {
		return nil, err
	}
	result := []Section{}
	for _, s := range r.Container.Sections {
		if (s.Type == "movie" || s.Type == "show") && (len(c.allowed) == 0 || c.allowed[s.Key]) {
			result = append(result, s)
		}
	}
	return result, nil
}

func (c *Client) permits(ctx context.Context, section string) bool {
	sections, err := c.Sections(ctx)
	if err != nil {
		return false
	}
	for _, s := range sections {
		if s.Key == section {
			return true
		}
	}
	return false
}

func (c *Client) Page(ctx context.Context, section, parent, query, order string, offset, size int) ([]Metadata, int, error) {
	return c.page(ctx, section, parent, query, order, offset, size, nil)
}

// ChildAt requests a single season/episode index without enumerating a show.
// Callers still validate the returned index and reject truncated results from
// servers which ignore the filter.
func (c *Client) ChildAt(ctx context.Context, parent string, index int) ([]Metadata, int, error) {
	return c.page(ctx, "", parent, "", "", 0, 100, &index)
}

func (c *Client) page(ctx context.Context, section, parent, query, order string, offset, size int, index *int) ([]Metadata, int, error) {
	if offset < 0 || size < 1 || size > 100 {
		return nil, 0, ErrNotFound
	}
	endpoint := "/library/sections/" + section + "/all"
	if parent != "" {
		key, _, err := c.parseID(ctx, parent)
		if err != nil {
			return nil, 0, err
		}
		item, _, err := c.Item(ctx, parent)
		if err != nil {
			return nil, 0, err
		}
		section = item.SectionID
		endpoint = "/library/metadata/" + key + "/children"
	}
	if !c.permits(ctx, section) {
		return nil, 0, ErrNotFound
	}
	q := url.Values{"X-Plex-Container-Start": {strconv.Itoa(offset)}, "X-Plex-Container-Size": {strconv.Itoa(size)}}
	if index != nil {
		q.Set("index", strconv.Itoa(*index))
	}
	if query != "" {
		q.Set("title", query)
	}
	if order != "" && parent == "" {
		q.Set("sort", order)
	}
	var r Response
	if err := c.get(ctx, endpoint, q, &r); err != nil {
		return nil, 0, err
	}
	if len(r.Container.Metadata) > size || (offset > 0 && r.Container.Offset != offset) {
		return nil, 0, errors.New("Plex did not honor bounded pagination")
	}
	for i := range r.Container.Metadata {
		if r.Container.Metadata[i].SectionID == "" {
			r.Container.Metadata[i].SectionID = section
		}
		if r.Container.Metadata[i].SectionID != section {
			return nil, 0, ErrNotFound
		}
	}
	total := r.Container.TotalSize
	if total == 0 {
		total = offset + len(r.Container.Metadata)
	}
	return r.Container.Metadata, total, nil
}

func (c *Client) Item(ctx context.Context, id string) (Metadata, int64, error) {
	key, version, err := c.parseID(ctx, id)
	if err != nil {
		return Metadata{}, 0, err
	}
	var r Response
	if err = c.get(ctx, "/library/metadata/"+key, url.Values{"includeChapters": {"1"}}, &r); err != nil {
		return Metadata{}, 0, err
	}
	if len(r.Container.Metadata) != 1 {
		return Metadata{}, 0, ErrNotFound
	}
	m := r.Container.Metadata[0]
	if m.Key != key {
		return Metadata{}, 0, ErrNotFound
	}
	if m.SectionID == "" {
		m.SectionID = r.Container.SectionID
	}
	if !c.permits(ctx, m.SectionID) {
		return Metadata{}, 0, ErrNotFound
	}
	return m, version, nil
}

func (c *Client) Open(file string) (*os.File, error) {
	file = strings.ReplaceAll(file, "\\", "/")
	for _, m := range c.mappings {
		if !strings.HasPrefix(file, m.Plex+"/") {
			continue
		}
		relative := strings.TrimPrefix(file, m.Plex+"/")
		if relative == "" || strings.Contains(relative, ":") || path.Clean(relative) != relative || !filepath.IsLocal(filepath.FromSlash(relative)) {
			return nil, ErrNotFound
		}
		root, err := os.OpenRoot(m.Local)
		if err != nil {
			return nil, ErrNotFound
		}
		defer root.Close()
		f, err := root.Open(filepath.FromSlash(relative))
		if err != nil {
			return nil, ErrNotFound
		}
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			f.Close()
			return nil, ErrNotFound
		}
		return f, nil
	}
	return nil, ErrNotFound
}

// ValidateWritable rejects writable destinations inside mapped roots, including
// destinations whose existing parent is a symlink/junction into a media root.
func (c *Client) ValidateWritable(dir string) error {
	if c == nil {
		return nil
	}
	full, err := filepath.Abs(dir)
	if err != nil {
		return errors.New("invalid writable directory")
	}
	resolved := full
	tail := []string{}
	for {
		real, e := filepath.EvalSymlinks(resolved)
		if e == nil {
			resolved = real
			break
		}
		parent := filepath.Dir(resolved)
		if parent == resolved {
			return errors.New("cannot resolve writable directory")
		}
		tail = append(tail, filepath.Base(resolved))
		resolved = parent
	}
	for i := len(tail) - 1; i >= 0; i-- {
		resolved = filepath.Join(resolved, tail[i])
	}
	for _, m := range c.mappings {
		root, e := filepath.EvalSymlinks(m.Local)
		if e != nil {
			return errors.New("cannot resolve media root")
		}
		rel, e := filepath.Rel(root, resolved)
		if e == nil && (rel == "." || filepath.IsLocal(rel)) {
			return errors.New("writable directories must be outside read-only media roots")
		}
	}
	return nil
}

func (c *Client) File(ctx context.Context, id, partID string) (*os.File, error) {
	m, version, err := c.Item(ctx, id)
	if err != nil {
		return nil, err
	}
	for _, v := range m.Media {
		if v.ID != version {
			continue
		}
		for _, p := range v.Parts {
			if strconv.FormatInt(p.ID, 10) == partID {
				return c.Open(p.File)
			}
		}
	}
	return nil, ErrNotFound
}

func (c *Client) Artwork(ctx context.Context, id, kind string) ([]byte, string, error) {
	m, _, err := c.Item(ctx, id)
	if err != nil {
		return nil, "", err
	}
	p := m.Thumb
	if kind == "backdrop" {
		p = m.Art
	} else if kind != "poster" {
		return nil, "", ErrNotFound
	}
	if p == "" {
		p = m.ParentThumb
	}
	if !regexp.MustCompile(`^/library/metadata/[0-9]+/(thumb|art)(/[0-9]+)?$`).MatchString(p) {
		return nil, "", ErrNotFound
	}
	select {
	case c.requests <- struct{}{}:
		defer func() { <-c.requests }()
	case <-ctx.Done():
		return nil, "", ErrUnavailable
	}
	u := *c.base
	u.Path = strings.TrimRight(u.Path, "/") + p
	req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	req.Header.Set("X-Plex-Token", c.token)
	r, err := c.http.Do(req)
	if err != nil {
		return nil, "", ErrUnavailable
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, "", ErrNotFound
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 12*1024*1024+1))
	if err != nil || len(data) > 12*1024*1024 {
		return nil, "", ErrUnavailable
	}
	contentType := http.DetectContentType(data)
	if contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp" {
		return nil, "", ErrNotFound
	}
	return data, contentType, nil
}
