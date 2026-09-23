package realtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProfileUploadsNeverWriteOutput(t *testing.T) {
	output, profiles := t.TempDir(), t.TempDir()
	hub := NewHub(Options{OutputDir: output, PFPDir: profiles, MaxUploadBytes: 12000000})
	if err := hub.writeProfileImage("viewer", []byte("image")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(profiles, "viewer.png")); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(output)
	if err != nil || len(entries) != 0 {
		t.Fatal("upload wrote beneath the media output root")
	}
	hub.pfpDir = ""
	if hub.writeProfileImage("viewer", []byte("image")) == nil {
		t.Fatal("missing profile directory fell back to output")
	}
}
