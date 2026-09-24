//go:build !windows

package lifecycle

import "context"

func WatchShutdown(ctx context.Context, cancel context.CancelFunc) error { return nil }
