package encode

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func testCache(t *testing.T) *cache {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	c, err := newCache(ctx, t.TempDir(), maxJobBytes*3, time.Hour, 2)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cancel(); c.close() })
	return c
}
func key(n string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(n))) }
func TestCacheSharesBuildAndSurvivesFirstWaiterCancellation(t *testing.T) {
	c := testCache(t)
	var calls atomic.Int32
	started := make(chan struct{})
	finish := make(chan struct{})
	build := func(ctx context.Context, dir string) error {
		calls.Add(1)
		close(started)
		select {
		case <-finish:
			return os.WriteFile(filepath.Join(dir, "video.mp4"), []byte("encoded"), 0644)
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	first, cancel := context.WithCancel(context.Background())
	done := make(chan error, 2)
	go func() {
		_, release, err := c.acquire(first, key("shared"), build)
		if release != nil {
			release()
		}
		done <- err
	}()
	<-started
	go func() {
		_, release, err := c.acquire(context.Background(), key("shared"), build)
		if release != nil {
			release()
		}
		done <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		c.mu.Lock()
		n := c.jobs[key("shared")].waiters
		c.mu.Unlock()
		if n == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("second viewer did not join")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	close(finish)
	a, b := <-done, <-done
	if (a == nil) == (b == nil) {
		t.Fatalf("expected one cancellation: %v %v", a, b)
	}
	_, release, err := c.acquire(context.Background(), key("shared"), build)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if calls.Load() != 1 {
		t.Fatalf("duplicate encode: %d", calls.Load())
	}
}
func TestCacheCancelsAbandonedJobAndBoundsReservations(t *testing.T) {
	c := testCache(t)
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	stopped := make(chan struct{})
	go c.acquire(ctx, key("abandon"), func(ctx context.Context, dir string) error {
		close(started)
		<-ctx.Done()
		close(stopped)
		return ctx.Err()
	})
	<-started
	cancel()
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("abandoned encoder kept running")
	}
	c.mu.Lock()
	c.reserved = c.maxBytes
	c.mu.Unlock()
	if _, _, err := c.acquire(context.Background(), key("full"), nil); err != errBusy {
		t.Fatalf("unbounded reservation: %v", err)
	}
	c.mu.Lock()
	c.reserved = 0
	c.mu.Unlock()
}
func TestCacheEvictionKeepsActiveResponsesAndDoesNotTraverse(t *testing.T) {
	c := testCache(t)
	build := func(ctx context.Context, dir string) error {
		return os.WriteFile(filepath.Join(dir, "video.mp4"), []byte("original-cache"), 0644)
	}
	_, release, err := c.acquire(context.Background(), key("old"), build)
	if err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	c.files[key("old")].used = time.Now().Add(-2 * time.Hour)
	c.prune(0)
	_, exists := c.files[key("old")]
	c.mu.Unlock()
	if !exists {
		t.Fatal("evicted active response")
	}
	release()
	c.mu.Lock()
	c.prune(0)
	_, exists = c.files[key("old")]
	c.mu.Unlock()
	if exists {
		t.Fatal("expired unpinned entry survived")
	}
	if _, _, err := c.acquire(context.Background(), "../escape", build); err == nil {
		t.Fatal("accepted traversal")
	}
}
