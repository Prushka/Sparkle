package encode

import (
	"context"
	"io"
	"os"
	"testing"
	"time"
)

func TestFramePipeHelper(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "--frame-pipe-helper" {
		return
	}
	switch os.Args[len(os.Args)-1] {
	case "write":
		b := make([]byte, 1<<20)
		for {
			if _, err := os.Stdout.Write(b); err != nil {
				os.Exit(0)
			}
		}
	case "relay":
		_, _ = io.Copy(os.Stdout, os.Stdin)
	case "fail":
		os.Exit(3)
	}
}

func TestPipelineCancellationAndFailedStage(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	step := func(mode string) processStep {
		return processStep{exe, []string{"-test.run=^TestFramePipeHelper$", "--", "--frame-pipe-helper", mode}}
	}
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "downstream-fails"}[fail], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			defer cancel()
			steps := []processStep{step("write"), step("relay")}
			if fail {
				steps = append(steps, step("fail"))
			}
			began := time.Now()
			if runPipeline(ctx, steps) == nil {
				t.Fatal("pipeline failure was hidden")
			}
			if !fail && ctx.Err() == nil {
				t.Fatal("pipeline exited before cancellation")
			}
			if time.Since(began) > 3*time.Second {
				t.Fatal("pipeline did not cancel promptly")
			}
		})
	}
}
