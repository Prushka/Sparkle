package lifecycle

import (
	"context"
	"fmt"
	"os"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestManagedShutdownEvent(t *testing.T) {
	name := fmt.Sprintf(`Local\SparkleWatchParty.Test.%d.%d`, os.Getpid(), time.Now().UnixNano())
	ptr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		t.Fatal(err)
	}
	kernel := syscall.NewLazyDLL("kernel32.dll")
	handle, _, err := kernel.NewProc("CreateEventW").Call(0, 1, 0, uintptr(unsafe.Pointer(ptr)))
	if handle == 0 {
		t.Fatal(err)
	}
	defer syscall.CloseHandle(syscall.Handle(handle))
	t.Setenv("SPARKLE_SHUTDOWN_EVENT", name)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := WatchShutdown(ctx, cancel); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != nil {
		t.Fatal("stopped before shutdown was requested")
	}
	if ok, _, err := kernel.NewProc("SetEvent").Call(handle); ok == 0 {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown event was ignored")
	}
}

func TestUnmanagedLaunch(t *testing.T) {
	t.Setenv("SPARKLE_SHUTDOWN_EVENT", "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := WatchShutdown(ctx, cancel); err != nil || ctx.Err() != nil {
		t.Fatal("ordinary terminal launch must remain unaffected", err)
	}
}

func TestMissingShutdownEvent(t *testing.T) {
	t.Setenv("SPARKLE_SHUTDOWN_EVENT", fmt.Sprintf(`Local\SparkleWatchParty.Missing.%d.%d`, os.Getpid(), time.Now().UnixNano()))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := WatchShutdown(ctx, cancel); err == nil {
		t.Fatal("expected missing launcher event to fail")
	}
}
