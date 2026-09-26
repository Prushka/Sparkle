//go:build !windows

package plexauth

import "os"

func privatePath(path string, directory bool) error {
	if directory {
		return os.Chmod(path, 0o700)
	}
	return os.Chmod(path, 0o600)
}
