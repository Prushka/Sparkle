// Package encode provides optional, bounded on-demand NVENC derivatives. Plex and
// mapped originals remain read-only; only this package's cache is writable.
package encode

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
)

var errEncode = errors.New("Server encoding failed; check FFmpeg, the NVIDIA driver, and GPU capacity")

// Never relay process output: FFmpeg diagnostics can contain source URLs, tags,
// filenames, or local paths. Limit probe output even for hostile metadata.
type limitedBuffer struct {
	bytes.Buffer
	limit int
}

type processStep struct {
	binary string
	args   []string
}

// OS pipes bound in-flight raw pixels. Any failed stage cancels and reaps all
// other stages; a closed downstream pipe cannot strand an upstream decoder.
func runPipeline(ctx context.Context, steps []processStep) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	commands := make([]*exec.Cmd, len(steps))
	var pipes []*os.File
	defer func() {
		for _, p := range pipes {
			p.Close()
		}
	}()
	for i, step := range steps {
		cmd := exec.CommandContext(ctx, step.binary, step.args...)
		hideProcess(cmd)
		cmd.Stderr = io.Discard
		commands[i] = cmd
		if i > 0 {
			r, w, err := framePipe()
			if err != nil {
				return errEncode
			}
			pipes = append(pipes, r, w)
			commands[i-1].Stdout, cmd.Stdin = w, r
		}
	}
	started := []*exec.Cmd{}
	for i := len(commands) - 1; i >= 0; i-- {
		if err := commands[i].Start(); err != nil {
			cancel()
			for _, p := range pipes {
				p.Close()
			}
			for _, cmd := range started {
				_ = cmd.Wait()
			}
			return errEncode
		}
		started = append(started, commands[i])
	}
	for _, p := range pipes {
		p.Close()
	}
	done := make(chan error, len(started))
	for _, cmd := range started {
		go func() { done <- cmd.Wait() }()
	}
	var result error
	for range started {
		if err := <-done; err != nil {
			result = errEncode
			cancel()
		}
	}
	return result
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
