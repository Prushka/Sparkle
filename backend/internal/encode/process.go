// Package encode provides optional, bounded on-demand NVENC derivatives. Plex and
// mapped originals remain read-only; only this package's cache is writable.
package encode

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
)

var errEncode = errors.New("Server encoding failed; check FFmpeg, the NVIDIA driver, and GPU capacity")

// Never relay process output: FFmpeg diagnostics can contain source URLs, tags,
// filenames, or local paths. Limit probe output even for hostile metadata.
type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("probe output limit")
	}
	return b.Buffer.Write(p)
}
func run(ctx context.Context, binary string, args []string, output io.Writer) error {
	cmd := exec.CommandContext(ctx, binary, args...)
	hideProcess(cmd)
	cmd.Stdout = output
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return errEncode
	}
	return nil
}
