//go:build windows

package priority

import (
	"Sparkle/discord"
	"golang.org/x/sys/windows"
)

const PROCESS_ALL_ACCESS = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0xffff

func setPriorityWindows(pid int, priority uint32) error {
	handle, err := windows.OpenProcess(PROCESS_ALL_ACCESS, false, uint32(pid))
	if err != nil {
		return err
	}
	defer func(handle windows.Handle) {
		err := windows.CloseHandle(handle)
		if err != nil {
			discord.Errorf("error closing handle: %v", err)
		}
	}(handle)

	return windows.SetPriorityClass(handle, priority)
}

func LowPriority(pid int) error {
	return setPriorityWindows(pid, windows.BELOW_NORMAL_PRIORITY_CLASS)
}
