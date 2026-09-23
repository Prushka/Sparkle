//go:build !windows

package encode

import "os/exec"

func hideProcess(cmd *exec.Cmd) {}
