package jobs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreJobSupportsModernJobJSON(t *testing.T) {
	outputDir := t.TempDir()
	jobDir := filepath.Join(outputDir, "s6IKH")
	if err := os.Mkdir(jobDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, jobDir, "poster.jpg", "poster")
	writeFile(t, jobDir, "av1-1-eng.mp4", "video")
	writeFile(t, jobDir, "1-eng.opus", "audio")
	writeFile(t, jobDir, jobFile, `{
		"id": "s6IKH",
		"input": "Remarkably Bright Creatures (2026) WEBDL-2160p.mkv",
		"state": "complete",
		"duration": 6840.013,
		"encodedCodecs": ["hevc", "av1"],
		"mappedAudio": {
			"av1": [
				{
					"bitrate": 117974,
					"codecName": "opus",
					"codecType": "audio",
					"index": 1,
					"location": "1-eng.opus",
					"language": "eng",
					"channels": 2
				}
			]
		},
		"streams": [
			{
				"codecName": "webvtt",
				"codecType": "subtitle",
				"index": 4,
				"location": "4-eng.vtt",
				"language": "eng",
				"title": "English"
			}
		],
		"chapters": [
			{
				"start_time": "0.000000",
				"end_time": "6335.450000",
				"start": 0,
				"end": 6335450000000,
				"time_base": "1/1000000000",
				"tags": { "title": "Scene 1" }
			}
		],
		"dominantColors": ["#514940"]
	}`)

	payload, _, err := NewStore(outputDir, time.Minute).Job(context.Background(), "s6IKH")
	if err != nil {
		t.Fatal(err)
	}

	var job map[string]any
	if err := json.Unmarshal(payload, &job); err != nil {
		t.Fatal(err)
	}
	if got := job["Id"]; got != "s6IKH" {
		t.Fatalf("Id = %v, want s6IKH", got)
	}
	if got := job["Input"]; got != "Remarkably Bright Creatures (2026) WEBDL-2160p.mkv" {
		t.Fatalf("Input = %v", got)
	}
	if got := job["State"]; got != "complete" {
		t.Fatalf("State = %v, want complete", got)
	}
	if got := job["Duration"]; got != 6840.013 {
		t.Fatalf("Duration = %v, want 6840.013", got)
	}
	assertStringSlice(t, job["EncodedCodecs"], []string{"hevc", "av1"})
	assertStringSlice(t, job["DominantColors"], []string{"#514940"})

	files := assertMap(t, job["Files"])
	if got := files["poster.jpg"]; got != float64(len("poster")) {
		t.Fatalf("poster size = %v, want %d", got, len("poster"))
	}
	if got := job["JobModTime"]; got == nil || got == float64(0) {
		t.Fatalf("JobModTime = %v, want non-zero", got)
	}

	mappedAudio := assertMap(t, job["MappedAudio"])
	av1Streams := assertSlice(t, mappedAudio["av1"])
	audio := assertMap(t, av1Streams[0])
	if got := audio["CodecType"]; got != "audio" {
		t.Fatalf("MappedAudio CodecType = %v, want audio", got)
	}
	if got := audio["Index"]; got != float64(1) {
		t.Fatalf("MappedAudio Index = %v, want 1", got)
	}
	if got := audio["Language"]; got != "eng" {
		t.Fatalf("MappedAudio Language = %v, want eng", got)
	}

	streams := assertSlice(t, job["Streams"])
	subtitle := assertMap(t, streams[0])
	if got := subtitle["CodecType"]; got != "subtitle" {
		t.Fatalf("Stream CodecType = %v, want subtitle", got)
	}
	if got := subtitle["Location"]; got != "4-eng.vtt" {
		t.Fatalf("Stream Location = %v, want 4-eng.vtt", got)
	}
	if got := subtitle["Title"]; got != "English" {
		t.Fatalf("Stream Title = %v, want English", got)
	}

	chapters := assertSlice(t, job["Chapters"])
	chapter := assertMap(t, chapters[0])
	if got := assertMap(t, chapter["tags"])["title"]; got != "Scene 1" {
		t.Fatalf("chapter title = %v, want Scene 1", got)
	}
}

func TestStorePayloadCompactsModernJobJSON(t *testing.T) {
	outputDir := t.TempDir()
	jobDir := filepath.Join(outputDir, "s6IKH")
	if err := os.Mkdir(jobDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, jobDir, "poster.jpg", "poster")
	writeFile(t, jobDir, jobFile, `{
		"id": "s6IKH",
		"input": "Remarkably Bright Creatures (2026) WEBDL-2160p.mkv",
		"state": "complete",
		"duration": 6840.013,
		"encodedCodecs": ["av1"],
		"dominantColors": ["#514940"]
	}`)

	jobs := waitForPayloadJobs(t, NewStore(outputDir, time.Minute), 1)
	job := jobs[0]
	if got := job["Id"]; got != "s6IKH" {
		t.Fatalf("Id = %v, want s6IKH", got)
	}
	if _, ok := job["id"]; ok {
		t.Fatalf("compact job included modern id key: %#v", job)
	}
	files := assertMap(t, job["Files"])
	if got := files["poster.jpg"]; got != float64(len("poster")) {
		t.Fatalf("poster size = %v, want %d", got, len("poster"))
	}
	if _, ok := files["job.json"]; ok {
		t.Fatalf("compact job included non-poster file: %#v", files)
	}
}

func TestStorePayloadReturnsCachedJobsWhileRefreshing(t *testing.T) {
	outputDir := t.TempDir()
	writeModernJob(t, outputDir, "first", "First Movie")

	store := NewStore(outputDir, time.Hour)
	jobs := waitForPayloadJobs(t, store, 1)
	if got := jobs[0]["Id"]; got != "first" {
		t.Fatalf("Id = %v, want first", got)
	}

	writeModernJob(t, outputDir, "second", "Second Movie")
	store.Prune()

	payload, _, err := store.Payload(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var cachedJobs []map[string]any
	if err := json.Unmarshal(payload, &cachedJobs); err != nil {
		t.Fatal(err)
	}
	if len(cachedJobs) != 1 {
		t.Fatalf("len(cachedJobs) = %d, want stale cache with 1 job", len(cachedJobs))
	}
	if got := cachedJobs[0]["Id"]; got != "first" {
		t.Fatalf("cached Id = %v, want first", got)
	}

	refreshedJobs := waitForPayloadJobs(t, store, 2)
	if got := refreshedJobs[0]["Id"]; got != "first" {
		t.Fatalf("refreshedJobs[0].Id = %v, want first", got)
	}
	if got := refreshedJobs[1]["Id"]; got != "second" {
		t.Fatalf("refreshedJobs[1].Id = %v, want second", got)
	}
}

func writeModernJob(t *testing.T, outputDir, id, title string) {
	t.Helper()
	jobDir := filepath.Join(outputDir, id)
	if err := os.Mkdir(jobDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, jobDir, "poster.jpg", "poster")
	writeFile(t, jobDir, jobFile, `{
		"id": "`+id+`",
		"input": "`+title+` WEBDL-1080p.mkv",
		"state": "complete",
		"duration": 6840.013,
		"encodedCodecs": ["av1"],
		"dominantColors": ["#514940"]
	}`)
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func waitForPayloadJobs(t *testing.T, store *Store, want int) []map[string]any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var lastLen int
	for time.Now().Before(deadline) {
		payload, _, err := store.Payload(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		var jobs []map[string]any
		if err := json.Unmarshal(payload, &jobs); err != nil {
			t.Fatal(err)
		}
		lastLen = len(jobs)
		if len(jobs) == want {
			return jobs
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("len(jobs) = %d, want %d", lastLen, want)
	return nil
}

func assertMap(t *testing.T, value any) map[string]any {
	t.Helper()
	result, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%T = %#v, want map[string]any", value, value)
	}
	return result
}

func assertSlice(t *testing.T, value any) []any {
	t.Helper()
	result, ok := value.([]any)
	if !ok {
		t.Fatalf("%T = %#v, want []any", value, value)
	}
	return result
}

func assertStringSlice(t *testing.T, value any, want []string) {
	t.Helper()
	values := assertSlice(t, value)
	if len(values) != len(want) {
		t.Fatalf("len(%#v) = %d, want %d", value, len(values), len(want))
	}
	for i, expected := range want {
		if values[i] != expected {
			t.Fatalf("value[%d] = %v, want %v", i, values[i], expected)
		}
	}
}
