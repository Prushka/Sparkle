package lifecycle

import (
	"context"
	"os"
	"syscall"
	"unsafe"
)

// WatchShutdown lets the console-free tray request ordinary graceful shutdown
// through a private Windows event, without exposing an HTTP control endpoint.
func WatchShutdown(ctx context.Context, cancel context.CancelFunc) error {
	name := os.Getenv("SPARKLE_SHUTDOWN_EVENT")
	if name == "" {
		return nil
	}
	ptr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	open := syscall.NewLazyDLL("kernel32.dll").NewProc("OpenEventW")
	h, _, err := open.Call(syscall.SYNCHRONIZE, 0, uintptr(unsafe.Pointer(ptr)))
	if h == 0 {
		return err
	}
	handle := syscall.Handle(h)
	go func() {
		defer syscall.CloseHandle(handle)
		for ctx.Err() == nil {
			result, err := syscall.WaitForSingleObject(handle, 250)
			if err != nil || result == syscall.WAIT_OBJECT_0 {
				cancel()
				return
			}
		}
	}()
	return nil
}
