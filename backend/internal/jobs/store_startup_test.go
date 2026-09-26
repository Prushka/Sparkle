package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"
)

func TestColdReadersJoinStartupScan(t *testing.T) {
	for _, failScan := range []bool{false, true} {
		name := "success"
		if failScan {
			name = "failure"
		}
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				output := t.TempDir()
				if failScan {
					output += "\x00" // Invalid on Windows and Unix, unlike permission fixtures.
				} else {
					writeModernJob(t, output, "first", "First Movie")
				}
				store := NewStore(output, time.Hour)
				// Hold the startup scan before its I/O begins so every reader
				// encounters an in-flight scan, without timing-dependent sleeps.
				pending := &refreshCall{done: make(chan struct{})}
				store.refreshing = pending
				defer func() {
					select {
					case <-pending.done:
					default:
						store.refresh(context.Background(), pending)
					}
				}()

				type result struct {
					payload []byte
					etag    string
					err     error
				}
				const readers = 8
				results := make(chan result, readers)
				for range readers {
					go func() {
						payload, etag, err := store.Payload(context.Background())
						results <- result{payload, etag, err}
					}()
				}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				canceled := make(chan error, 1)
				go func() {
					_, _, err := store.Payload(ctx)
					canceled <- err
				}()
				synctest.Wait()
				if len(results) != 0 || len(canceled) != 0 {
					t.Fatal("cold request returned before the startup scan finished")
				}
				cancel()
				synctest.Wait()
				if err := <-canceled; !errors.Is(err, context.Canceled) {
					t.Fatalf("canceled reader error = %v", err)
				}
				store.RefreshAsync(context.Background())
				synctest.Wait()
				if store.refreshing != pending || len(results) != 0 {
					t.Fatal("readers and background refresh did not share the startup scan")
				}
				store.refresh(context.Background(), pending)
				synctest.Wait()
				for range readers {
					got := <-results
					if failScan {
						if got.err == nil || got.err.Error() != "processed library is unavailable" || got.payload != nil || got.etag != "" {
							t.Fatalf("failed scan returned %#v", got)
						}
					} else if got.err != nil || string(got.payload) != string(store.cached) || got.etag == "" || got.etag != store.etag {
						t.Fatalf("reader did not receive the completed scan: %#v", got)
					}
				}
			})
		})
	}
}

func TestColdScanFailureCanRetry(t *testing.T) {
	output := t.TempDir()
	store := NewStore(output+"\x00", time.Hour)
	payload, etag, err := store.Payload(context.Background())
	if err == nil || err.Error() != "processed library is unavailable" || payload != nil || etag != "" {
		t.Fatalf("failed first scan = %s, %q, %v; want a safe error without a cached result", payload, etag, err)
	}
	writeModernJob(t, output, "first", "First Movie")
	store.outputDir = output
	payload, etag, err = store.Payload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	if err := json.Unmarshal(payload, &records); err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0]["Id"] != "first" || etag == "" {
		t.Fatalf("retry returned %s, ETag = %q", payload, etag)
	}
}

func TestScannedEmptyCatalogIsCached(t *testing.T) {
	for _, missing := range []bool{false, true} {
		name := "empty"
		if missing {
			name = "missing"
		}
		t.Run(name, func(t *testing.T) {
			output := t.TempDir()
			if missing {
				output = filepath.Join(output, "output")
			}
			store := NewStore(output, time.Hour)
			payload, etag, err := store.Payload(context.Background())
			if err != nil || string(payload) != "[]" || etag == "" {
				t.Fatalf("empty scan = %s, %q, %v", payload, etag, err)
			}
			if err := os.MkdirAll(output, 0o755); err != nil {
				t.Fatal(err)
			}
			writeModernJob(t, output, "first", "First Movie")
			cached, cachedETag, err := store.Payload(context.Background())
			if err != nil || string(cached) != "[]" || cachedETag != etag {
				t.Fatalf("empty cache was not reused before expiry: %s, %q, %v", cached, cachedETag, err)
			}
			store.Prune()
			waitForPayloadJobs(t, store, 1)
		})
	}
}
