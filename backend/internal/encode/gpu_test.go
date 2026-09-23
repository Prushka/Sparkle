package encode

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Explicitly opt in: CI never consumes a developer's GPU or private media.
func TestNVENCReferenceMedia(t *testing.T) {
	name := os.Getenv("SPARKLE_ENCODE_SAMPLE")
	if name == "" {
		t.Skip("SPARKLE_ENCODE_SAMPLE is required for physical GPU testing")
	}
	ffmpeg, ffprobe := os.Getenv("FFMPEG"), os.Getenv("FFPROBE")
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	if ffprobe == "" {
		ffprobe = "ffprobe"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	f, err := os.Open(name)
	if err != nil {
		t.Fatal("sample unavailable")
	}
	defer f.Close()
	input, closeInput, err := inputURL(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	defer closeInput()
	p, err := probe(ctx, ffprobe, input)
	if err != nil {
		t.Fatal(err)
	}
	for _, codec := range []string{"av1", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			dir := t.TempDir()
			args := encodeArgs(input, dir, codec, 0, 3, Profile{22, "p7", 144}, p)
			if err := run(ctx, ffmpeg, args, nil); err != nil {
				t.Fatal(err)
			}
			out, err := probe(ctx, ffprobe, filepath.Join(dir, "video.mp4"))
			if err != nil {
				t.Fatal(err)
			}
			if out.output() != p.output() {
				t.Fatalf("source %s output %s", p.output(), out.output())
			}
			if out.video().Codec != codec {
				t.Fatalf("codec %s", out.video().Codec)
			}
			for _, side := range out.video().SideData {
				if side.Profile != 0 {
					t.Fatal("encoded video incorrectly retains Dolby configuration")
				}
			}
			t.Logf("%s: %s %dx%d %s", codec, out.output(), out.video().Width, out.video().Height, out.video().Transfer)
		})
	}
}
