//go:build darwin

package priority

import (
	"syscall"
)

// Priority constants for macOS
const (
	PRIO_PROCESS = 0  // Process priority type
	LOW_PRIORITY = 16 // Nice value for low priority (higher nice = lower priority)
)

func setPriorityDarwin(pid int, priority int) error {
	return syscall.Setpriority(PRIO_PROCESS, pid, priority)
}

func LowPriority(pid int) error {
	return setPriorityDarwin(pid, LOW_PRIORITY)
}
