package encode

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

const maxJobBytes int64 = 256 << 20

var cacheName = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errBusy = errors.New("Server encoder is busy; try again shortly")

type cached struct {
	bytes   int64
	used    time.Time
	readers int
}
type work struct {
	done      chan struct{}
	cancel    context.CancelFunc
	waiters   int
	err       error
	abandoned bool
}
type cache struct {
	ctx         context.Context
	dir         string
	root        *os.Root
	maxBytes    int64
	ttl         time.Duration
	slots       chan struct{}
	mu          sync.Mutex
	files       map[string]*cached
	jobs        map[string]*work
	bytes       int64
	reserved    int64
	wg          sync.WaitGroup
	jobBytes    int64
	jobTimeout  time.Duration
	cancelDelay time.Duration
}

func newCache(ctx context.Context, dir string, maxBytes int64, ttl time.Duration, concurrent int) (*cache, error) {
	return newSizedCache(ctx, dir, maxBytes, ttl, concurrent, maxJobBytes, 2*time.Minute, time.Second)
}

func newSizedCache(ctx context.Context, dir string, maxBytes int64, ttl time.Duration, concurrent int, jobBytes int64, jobTimeout, cancelDelay time.Duration) (*cache, error) {
	if jobBytes <= 0 || maxBytes < jobBytes*2 || concurrent < 1 || concurrent > 32 || ttl <= 0 || jobTimeout <= 0 {
		return nil, errors.New("invalid encoder cache limits")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, errors.New("cannot create encoder cache")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, errors.New("cannot open encoder cache")
	}
	c := &cache{ctx: ctx, dir: dir, root: root, maxBytes: maxBytes, ttl: ttl, slots: make(chan struct{}, concurrent), files: map[string]*cached{}, jobs: map[string]*work{}, jobBytes: jobBytes, jobTimeout: jobTimeout, cancelDelay: cancelDelay}
	entries, err := os.ReadDir(dir)
	if err != nil {
		root.Close()
		return nil, errEncode
	}
	for _, e := range entries {
		if !cacheName.MatchString(e.Name()) || !e.IsDir() {
			continue
		}
		info, err := root.Stat(e.Name() + "/complete")
		if err != nil {
			_ = root.RemoveAll(e.Name())
			continue
		}
		size, err := directorySize(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		c.files[e.Name()] = &cached{bytes: size, used: info.ModTime()}
		c.bytes += size
	}
	c.prune(0)
	return c, nil
}
func directorySize(dir string) (int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	var size int64
	for _, e := range entries {
		if e.IsDir() || e.Type()&os.ModeSymlink != 0 {
			return 0, errEncode
		}
		info, err := e.Info()
		if err != nil {
			return 0, err
		}
		size += info.Size()
	}
	return size, nil
}

// Caller owns mu (or is still constructing the cache). Never evict a response
// being served or an in-progress job. The count limit bounds in-memory state too.
func (c *cache) prune(reserve int64) {
	keys := make([]string, 0, len(c.files))
	for key := range c.files {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return c.files[keys[i]].used.Before(c.files[keys[j]].used) })
	for _, key := range keys {
		f := c.files[key]
		if f.readers > 0 {
			continue
		}
		if time.Since(f.used) < c.ttl && c.bytes+c.reserved+reserve <= c.maxBytes && len(c.files) < 4096 {
			continue
		}
		if c.root.RemoveAll(key) == nil {
			c.bytes -= f.bytes
			delete(c.files, key)
		}
	}
}

// Acquire returns a pinned directory and release function. A job is shared by
// every viewer (and both audio/video requests), independent of room/client IDs.
func (c *cache) acquire(ctx context.Context, key string, build func(context.Context, string) error) (string, func(), error) {
	if !cacheName.MatchString(key) {
		return "", nil, errEncode
	}
retry:
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	c.mu.Lock()
	if c.ctx.Err() != nil {
		c.mu.Unlock()
		return "", nil, errEncode
	}
	if f := c.files[key]; f != nil {
		f.readers++
		f.used = time.Now()
		c.mu.Unlock()
		return filepath.Join(c.dir, key), func() { c.mu.Lock(); f.readers--; c.mu.Unlock() }, nil
	}
	j := c.jobs[key]
	if j != nil && j.abandoned {
		// A cancelled FFmpeg process may still be releasing its directory and
		// GPU slot. Wait for cleanup, then share a fresh job with other returners.
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return "", nil, ctx.Err()
		case <-j.done:
			goto retry
		}
	}
	if j == nil {
		c.prune(c.jobBytes)
		if len(c.jobs) >= 32 || c.bytes+c.reserved+c.jobBytes > c.maxBytes {
			c.mu.Unlock()
			return "", nil, errBusy
		}
		jobCtx, cancel := context.WithTimeout(c.ctx, c.jobTimeout)
		j = &work{done: make(chan struct{}), cancel: cancel}
		c.jobs[key] = j
		c.reserved += c.jobBytes
		c.wg.Add(1)
		go c.build(jobCtx, key, j, build)
	}
	j.waiters++
	c.mu.Unlock()
	select {
	case <-ctx.Done():
	case <-j.done:
	}
	c.mu.Lock()
	j.waiters--
	if j.waiters == 0 {
		// Give the corresponding audio/video request time to attach after an
		// interrupted range probe; abandoned seeks then stop consuming the GPU.
		time.AfterFunc(c.cancelDelay, func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			if c.jobs[key] == j && j.waiters == 0 {
				j.abandoned = true
				j.cancel()
			}
		})
	}
	err := j.err
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	if err == nil {
		if f := c.files[key]; f != nil {
			f.readers++
			f.used = time.Now()
			c.mu.Unlock()
			return filepath.Join(c.dir, key), func() { c.mu.Lock(); f.readers--; c.mu.Unlock() }, nil
		}
		err = errEncode
	}
	c.mu.Unlock()
	return "", nil, err
}
func (c *cache) build(ctx context.Context, key string, j *work, build func(context.Context, string) error) {
	defer c.wg.Done()
	defer j.cancel()
	err := func() error {
		select {
		case c.slots <- struct{}{}:
			defer func() { <-c.slots }()
		case <-ctx.Done():
			return ctx.Err()
		}
		if err := c.root.Mkdir(key, 0755); err != nil {
			return errEncode
		}
		dir := filepath.Join(c.dir, key)
		limited, cancel := context.WithCancel(ctx)
		defer cancel()
		finished := make(chan struct{})
		defer close(finished)
		go func() {
			ticker := time.NewTicker(250 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-finished:
					return
				case <-limited.Done():
					return
				case <-ticker.C:
					if size, _ := directorySize(dir); size > c.jobBytes {
						cancel()
						return
					}
				}
			}
		}()
		if err := build(limited, dir); err != nil {
			return err
		}
		if limited.Err() != nil {
			return limited.Err()
		}
		size, err := directorySize(dir)
		if err != nil || size > c.jobBytes {
			return errEncode
		}
		f, err := c.root.Create(key + "/complete")
		if err != nil {
			return errEncode
		}
		if err = f.Close(); err != nil {
			return errEncode
		}
		c.mu.Lock()
		c.files[key] = &cached{bytes: size, used: time.Now()}
		c.bytes += size
		c.mu.Unlock()
		return nil
	}()
	if err != nil {
		_ = c.root.RemoveAll(key)
	}
	c.mu.Lock()
	c.reserved -= c.jobBytes
	j.err = err
	delete(c.jobs, key)
	close(j.done)
	c.mu.Unlock()
}
func (c *cache) close() { c.wg.Wait(); _ = c.root.Close() }
