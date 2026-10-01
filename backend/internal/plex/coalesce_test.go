package plex

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConcurrentMetadataMissesShareUpstreamRequest(t *testing.T) {
	var requests atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		// Hold a cold response while the other viewers request the same page.
		time.Sleep(50 * time.Millisecond)
		fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"shared"}}`)
	}, []Mapping{{"/media", t.TempDir()}})
	var group sync.WaitGroup
	start := make(chan struct{})
	for range 32 {
		group.Go(func() {
			<-start
			var response Response
			if err := c.get(context.Background(), "/library/sections", nil, &response); err != nil || response.Container.MachineIdentifier != "shared" {
				t.Errorf("shared response = %q, %v", response.Container.MachineIdentifier, err)
			}
		})
	}
	close(start)
	group.Wait()
	if requests.Load() != 1 {
		t.Fatalf("32 concurrent cold reads made %d upstream requests", requests.Load())
	}
	if len(c.pending) != 0 {
		t.Fatal("completed requests retained")
	}
}

func TestMetadataWaiterCancelsIndependently(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		fmt.Fprint(w, `{"MediaContainer":{}}`)
	}, []Mapping{{"/media", t.TempDir()}})
	done := make(chan error, 1)
	go func() { done <- c.get(context.Background(), "/library/sections", nil, &Response{}) }()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err := c.get(ctx, "/library/sections", nil, &Response{})
	close(release)
	if !errors.Is(err, ErrUnavailable) || <-done != nil || requests.Load() != 1 {
		t.Fatalf("waiter cancellation affected shared request: %v, requests=%d", err, requests.Load())
	}
}

func TestCancelledMetadataLeaderDoesNotPoisonOtherViewers(t *testing.T) {
	started := make(chan struct{})
	var requests atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			close(started)
			<-r.Context().Done()
			return
		}
		fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"retried"}}`)
	}, []Mapping{{"/media", t.TempDir()}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- c.get(ctx, "/library/sections", nil, &Response{}) }()
	<-started
	time.AfterFunc(20*time.Millisecond, cancel)
	var response Response
	if err := c.get(context.Background(), "/library/sections", nil, &response); err != nil || response.Container.MachineIdentifier != "retried" {
		t.Fatalf("surviving viewer failed: %#v, %v", response, err)
	}
	if <-done == nil || requests.Load() != 2 || len(c.pending) != 0 {
		t.Fatalf("cancelled request not released: requests=%d", requests.Load())
	}
}

func TestMetadataErrorsAreNotCached(t *testing.T) {
	for _, status := range []int{404, 500, 200} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var requests atomic.Int32
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.WriteHeader(status)
				fmt.Fprint(w, "invalid metadata")
			}, []Mapping{{"/media", t.TempDir()}})
			for range 2 {
				if c.get(context.Background(), "/library/sections", nil, &Response{}) == nil {
					t.Fatal("invalid response accepted")
				}
			}
			if requests.Load() != 2 || len(c.cache) != 0 || len(c.pending) != 0 {
				t.Fatal("failed request was cached or retained")
			}
		})
	}
}
