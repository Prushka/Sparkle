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
	case "shader-fail":
		_, _ = os.Stderr.WriteString("libplacebo: Failed executing hook, disabling\n")
		os.Exit(0)
	case "shader-ok":
		os.Exit(0)
	case "decoder-warning":
		_, _ = os.Stderr.WriteString("[hevc] PPS id out of range: 0\n")
		os.Exit(0)
	}
}

func TestShaderErrorsFailClosed(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"shader-fail", "shader-ok", "decoder-warning"} {
		args := []string{"-test.run=^TestFramePipeHelper$", "--", "--vpp-libplacebo-shader", "--frame-pipe-helper", mode}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for _, err := range []error{run(ctx, exe, args, nil), runPipeline(ctx, []processStep{{exe, args}})} {
			if (err != nil) != (mode == "shader-fail") {
				t.Fatalf("%s: %v", mode, err)
			}
		}
	}
}

func TestShaderDiagnosticAcrossWrites(t *testing.T) {
	const message = "libplacebo: Failed executing hook, disabling"
	for split := 1; split < len(message); split++ {
		d := &shaderDiagnostic{}
		_, _ = d.Write([]byte(message[:split]))
		_, _ = d.Write([]byte(message[split:]))
		if !d.failed || len(d.tail) > 9 {
			t.Fatalf("lost or retained diagnostics at split %d", split)
		}
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
