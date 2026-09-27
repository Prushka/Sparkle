//go:build windows

package encode

import (
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"syscall"
)

func hideProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }

// The default Windows pipe buffer is tiny compared with a 4K raw frame.
// Bound each pipe to 1 MiB while avoiding thousands of blocking handoffs/frame.
func framePipe() (*os.File, *os.File, error) {
	var read, write windows.Handle
	if err := windows.CreatePipe(&read, &write, nil, 1<<20); err != nil {
		return nil, nil, err
	}
	return os.NewFile(uintptr(read), "frames-read"), os.NewFile(uintptr(write), "frames-write"), nil
}
