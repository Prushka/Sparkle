//go:build !windows

package encode

import "os"

func framePipe() (*os.File, *os.File, error) { return os.Pipe() }
