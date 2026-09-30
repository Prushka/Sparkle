package encode

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"Sparkle/internal/plex"
)

func TestEncodingRequiresAllowedPlexSectionAndHidesPaths(t *testing.T) {
	mediaRoot := t.TempDir()
	_ = os.WriteFile(filepath.Join(mediaRoot, "sample.mkv"), []byte("read-only"), 0644)
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/identity":
			fmt.Fprint(w, `{"MediaContainer":{"machineIdentifier":"fixture"}}`)
		case "/library/sections":
			fmt.Fprint(w, `{"MediaContainer":{"Directory":[{"key":"1","type":"movie"},{"key":"2","type":"movie"}]}}`)
		case "/library/metadata/1", "/library/metadata/2":
			section := strings.TrimPrefix(r.URL.Path, "/library/metadata/")
			fmt.Fprintf(w, `{"MediaContainer":{"Metadata":[{"ratingKey":"%s","librarySectionID":"%s","type":"movie","Media":[{"id":10,"Part":[{"id":20,"file":"/media/sample.mkv"}]}]}]}}`, section, section)
		default:
			t.Errorf("unexpected catalog scan: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	mappings, _ := json.Marshal([]plex.Mapping{{Plex: "/media", Local: mediaRoot}})
	p, err := plex.New(plex.Options{URL: server.URL, Token: "hidden-test-token", LibraryIDs: "1", Mappings: string(mappings)})
	if err != nil {
		t.Fatal(err)
	}
	c := testCache(t)
	s := &Service{plex: p, cache: c, codecs: []string{"av1"}, sources: map[string]*source{}, probes: make(chan struct{}, 2), options: Options{Profile: Profile{Quality: 22, Preset: "p3", AudioSurroundKbpsPerChannel: 80}}}
	id, err := p.ID(context.Background(), "1", 10)
	if err != nil {
		t.Fatal(err)
	}
	f, _ := p.File(context.Background(), id, "20")
	info, _ := f.Stat()
	f.Close()
	fingerprint := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:20:%d:%d", id, info.Size(), info.ModTime().UnixNano()))))
	s.sources[fingerprint] = &source{probe: Probe{Streams: []Stream{
		{Type: "video", Codec: "hevc", Transfer: "smpte2084"},
		{Type: "attachment", Codec: "ttf", Extra: "00000000: 666f 6e74  font"},
		{Type: "subtitle", Codec: "ass", Tags: map[string]string{"title": "Small", "NUMBER_OF_BYTES": "100", "PRIVATE": "hidden-test-token"}},
		{Type: "subtitle", Codec: "ass", Tags: map[string]string{"title": "Large", "NUMBER_OF_BYTES-eng": "1000"}},
		{Type: "subtitle", Codec: "ass", Tags: map[string]string{"title": "Unknown"}},
	}}, duration: 7200, key: fingerprint, used: time.Now()}
	mux := http.NewServeMux()
	s.Register(mux)
	allowed := httptest.NewRecorder()
	mux.ServeHTTP(allowed, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/manifest", nil))
	if allowed.Code != 200 {
		t.Fatalf("manifest %d %s", allowed.Code, allowed.Body)
	}
	if !strings.Contains(allowed.Body.String(), `"timestampStart":true`) {
		t.Fatal("manifest did not advertise timestamp initialization")
	}
	if strings.Contains(allowed.Body.String(), mediaRoot) || strings.Contains(allowed.Body.String(), "hidden-test-token") || strings.Contains(allowed.Body.String(), server.URL) {
		t.Fatal("private configuration leaked")
	}
	if !strings.Contains(allowed.Body.String(), `"hasFonts":true`) || strings.Contains(allowed.Body.String(), `"fonts":`) {
		t.Fatal("manifest must announce fonts without downloading attachments")
	}
	var manifest struct {
		SegmentSeconds int `json:"segmentSeconds"`
		SubtitleTracks []struct {
			ID   int    `json:"id"`
			Size *int64 `json:"size"`
		} `json:"subtitleTracks"`
	}
	if err := json.Unmarshal(allowed.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.SubtitleTracks) != 3 {
		t.Fatalf("unexpected subtitle tracks: %s", allowed.Body)
	}
	if manifest.SegmentSeconds != 12 {
		t.Fatalf("segment duration: %d", manifest.SegmentSeconds)
	}
	for i, want := range []int64{100, 1000, 0} {
		track := manifest.SubtitleTracks[i]
		if track.ID != i || (want == 0 && track.Size != nil) || (want > 0 && (track.Size == nil || *track.Size != want)) {
			t.Fatalf("subtitle identity/size mismatch: %s", allowed.Body)
		}
	}
	encodedFingerprint := s.fingerprint(s.sources[fingerprint])
	oldFingerprint := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("nvenc-segments-v7:%s:%s:%+v", s.revision, fingerprint, s.options.Profile))))
	old := httptest.NewRecorder()
	mux.ServeHTTP(old, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/video.m3u8?v="+oldFingerprint, nil))
	if old.Code != http.StatusConflict {
		t.Fatal("accepted a previous audio-layout cache fingerprint")
	}
	s.sources[fingerprint].duration = 25
	playlist := httptest.NewRecorder()
	mux.ServeHTTP(playlist, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/video.m3u8", nil))
	if playlist.Code != 200 || !strings.Contains(playlist.Body.String(), "#EXT-X-TARGETDURATION:12\n") || strings.Count(playlist.Body.String(), "#EXTINF:12.000000,") != 2 || !strings.Contains(playlist.Body.String(), "#EXTINF:1.000000,\nvideo-2.m4s") || strings.Contains(playlist.Body.String(), "video-3.m4s") {
		t.Fatalf("twelve-second playlist: %d %s", playlist.Code, playlist.Body)
	}
	outside := httptest.NewRecorder()
	mux.ServeHTTP(outside, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/video-3.m4s", nil))
	if outside.Code != 404 {
		t.Fatal("accepted an out-of-bounds segment")
	}
	s.sources[fingerprint].duration = 7200
	// The feature flag gates every resource before Plex, probing or cache access.
	for _, resource := range []string{"manifest", "fonts.json", "master.m3u8", "video.m3u8", "audio.m3u8", "video-init.mp4", "video-0.m4s", "audio-0.m4s", "subtitles-0.json"} {
		blocked := httptest.NewRecorder()
		mux.ServeHTTP(blocked, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/"+resource+"?aiHDR=1", nil))
		if blocked.Code != 422 {
			t.Fatalf("disabled AI HDR %s: %d", resource, blocked.Code)
		}
	}
	s.options.AIHDREnabled = true
	s.aiHDRCodecs = []string{"av1"}
	s.aiHDRRevision = aiHDRVersion
	s.sources[fingerprint].hdr = &hdrPlan{Mode: "hdr-expansion"}
	for _, resource := range []string{"manifest", "master.m3u8", "video.m3u8"} {
		enhanced := httptest.NewRecorder()
		mux.ServeHTTP(enhanced, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/"+resource+"?aiHDR=1", nil))
		if enhanced.Code != 200 {
			t.Fatalf("AI HDR %s: %d", resource, enhanced.Code)
		}
		body := enhanced.Body.String()
		if strings.Contains(body, encodedFingerprint) {
			t.Fatal("enhanced output reused original fingerprint")
		}
		if resource == "manifest" {
			if !strings.Contains(body, `"aiHDR":true`) || !strings.Contains(body, `"output":"HDR10"`) {
				t.Fatal(body)
			}
		} else {
			for _, line := range strings.Split(body, "\n") {
				if strings.Contains(line, "?v=") && !strings.Contains(line, "&aiHDR=1") {
					t.Fatalf("missing variant: %s", line)
				}
			}
		}
	}
	s.options.AIHDREnabled = false
	for _, audio := range []bool{false, true} {
		if audio {
			s.sources[fingerprint].probe.Streams = append(s.sources[fingerprint].probe.Streams, Stream{Type: "audio", Codec: "opus", Channels: 8, ChannelLayout: "7.1"})
			audioManifest := httptest.NewRecorder()
			mux.ServeHTTP(audioManifest, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/manifest", nil))
			if audioManifest.Code != 200 || !strings.Contains(audioManifest.Body.String(), `"audioChannels":8`) {
				t.Fatalf("missing probed surround channels: %s", audioManifest.Body)
			}
			var audioMetadata struct {
				AudioTracks []audioPlan `json:"audioTracks"`
			}
			if err := json.Unmarshal(audioManifest.Body.Bytes(), &audioMetadata); err != nil || len(audioMetadata.AudioTracks) != 1 || audioMetadata.AudioTracks[0].Layout != "7.1" || audioMetadata.AudioTracks[0].Conversion != "preserved" {
				t.Fatalf("missing per-track audio layout: %s", audioManifest.Body)
			}
		}
		master := httptest.NewRecorder()
		mux.ServeHTTP(master, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/master.m3u8?v="+encodedFingerprint, nil))
		if master.Code != 200 || !strings.Contains(master.Body.String(), "video.m3u8?v="+encodedFingerprint) || strings.Contains(master.Body.String(), "audio.m3u8") != audio {
			t.Fatalf("invalid combined playlist: %d %s", master.Code, master.Body)
		}
	}
	fontURL := "/media/" + id + "/parts/20/encoded/av1/fonts.json?v=" + encodedFingerprint
	// A late startup must reuse the selected segment job, including its headers,
	// without touching segment zero or changing media-fragment URLs/cache identity.
	for _, enhanced := range []bool{false, true} {
		s.options.AIHDREnabled = enhanced
		cacheCodec, variant := "av1", ""
		if enhanced {
			cacheCodec += s.aiHDRRevision
			variant = "&aiHDR=1"
		}
		segmentKey := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s:%s:%+v:%d", profileVersion, s.revision, fingerprint, cacheCodec, s.options.Profile, 1))))
		_, release, err := c.acquire(context.Background(), segmentKey, func(_ context.Context, dir string) error {
			for _, kind := range []string{"video", "audio"} {
				if err := os.WriteFile(filepath.Join(dir, kind+".mp4"), []byte("initfragment"), 0644); err != nil {
					return err
				}
			}
			return os.WriteFile(filepath.Join(dir, "index.json"), []byte(`{"video":4,"audio":4}`), 0644)
		})
		if err != nil {
			t.Fatal(err)
		}
		release()
		for _, kind := range []string{"video", "audio"} {
			base := "/media/" + id + "/parts/20/encoded/av1/" + kind
			playlist := httptest.NewRecorder()
			mux.ServeHTTP(playlist, httptest.NewRequest("GET", base+".m3u8?startSegment=1"+variant, nil))
			if playlist.Code != 200 || strings.Count(playlist.Body.String(), "&startSegment=1") != 1 || !strings.Contains(playlist.Body.String(), kind+"-0.m4s?v=") {
				t.Fatalf("late playlist lost full timeline: %d %s", playlist.Code, playlist.Body)
			}
			initial := httptest.NewRecorder()
			mux.ServeHTTP(initial, httptest.NewRequest("GET", base+"-init.mp4?startSegment=1"+variant, nil))
			if initial.Code != 200 || initial.Body.String() != "init" {
				t.Fatalf("late init: %d %s", initial.Code, initial.Body)
			}
			fragment := httptest.NewRecorder()
			mux.ServeHTTP(fragment, httptest.NewRequest("GET", base+"-1.m4s?unused=1"+variant, nil))
			if fragment.Code != 200 || fragment.Body.String() != "fragment" {
				t.Fatalf("shared segment: %d %s", fragment.Code, fragment.Body)
			}
		}
		master := httptest.NewRecorder()
		mux.ServeHTTP(master, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/master.m3u8?startSegment=1"+variant, nil))
		if master.Code != 200 || strings.Count(master.Body.String(), "&startSegment=1") != 2 {
			t.Fatal(master.Body)
		}
	}
	s.options.AIHDREnabled = false
	for _, value := range []string{"-1", "600", "999999999999999999999", "NaN", "1.5", "", "1&startSegment=2"} {
		invalid := httptest.NewRecorder()
		mux.ServeHTTP(invalid, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/video-init.mp4?startSegment="+value, nil))
		if invalid.Code != 400 {
			t.Fatalf("accepted startSegment=%q: %d", value, invalid.Code)
		}
	}
	fonts := httptest.NewRecorder()
	mux.ServeHTTP(fonts, httptest.NewRequest("GET", fontURL, nil))
	if fonts.Code != 200 || strings.TrimSpace(fonts.Body.String()) != `["Zm9udA=="]` {
		t.Fatalf("fonts %d %s", fonts.Code, fonts.Body)
	}
	fontCheck := httptest.NewRequest("GET", fontURL, nil)
	fontCheck.Header.Set("If-None-Match", fonts.Header().Get("ETag"))
	unmodified := httptest.NewRecorder()
	mux.ServeHTTP(unmodified, fontCheck)
	if unmodified.Code != http.StatusNotModified || unmodified.Body.Len() != 0 {
		t.Fatal("font validator not respected")
	}
	blockedID, _ := p.ID(context.Background(), "2", 10)
	blocked := httptest.NewRecorder()
	mux.ServeHTTP(blocked, httptest.NewRequest("GET", "/media/"+blockedID+"/parts/20/encoded/av1/manifest", nil))
	if blocked.Code != 404 {
		t.Fatalf("disallowed section status %d", blocked.Code)
	}
	stale := httptest.NewRecorder()
	mux.ServeHTTP(stale, httptest.NewRequest("GET", "/media/"+id+"/parts/20/encoded/av1/video.m3u8?v=old-file", nil))
	if stale.Code != 409 {
		t.Fatalf("stale file status %d", stale.Code)
	}
	if len(requests) > 5 {
		t.Fatalf("unbounded metadata work: %v", requests)
	}
	s.options.Profile.Preset = "p4"
	if s.fingerprint(s.sources[fingerprint]) == encodedFingerprint {
		t.Fatal("encoder settings reused immutable browser URLs")
	}
	changed := httptest.NewRecorder()
	mux.ServeHTTP(changed, httptest.NewRequest("GET", fontURL, nil))
	if changed.Code != http.StatusConflict {
		t.Fatal("stale profile fingerprint accepted")
	}
}
