//go:build !windows

package plexauth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSessionStorageUnixPermissions(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	setup(t, dir)
	for path, want := range map[string]os.FileMode{dir: 0o700, filepath.Join(dir, "sessions.db"): 0o600} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != want {
			t.Fatalf("private permissions: %v, want %v; error %v", info, want, err)
		}
	}
}
