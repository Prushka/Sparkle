package encode

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestEncoderUsesFastNVENCWithReferenceQualityOnEveryAttempt(t *testing.T) {
	p := Probe{Streams: []Stream{{Type: "video", Codec: "av1", Transfer: "smpte2084"}, {Type: "audio", Codec: "truehd", Channels: 2, ChannelLayout: "stereo"}, {Type: "subtitle", Codec: "hdmv_pgs_subtitle"}, {Type: "subtitle", Codec: "mov_text"}}}
	for _, codec := range []string{"av1", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			args := encodeArgs("http://127.0.0.1:1234/input", t.TempDir(), codec, 4, 100, Profile{Quality: 22, Preset: "p3", AudioSurroundKbpsPerChannel: 80}, p)
			retry := softwareDecodeInput(args)
			if !slices.Equal(args[slices.Index(args, "-i"):], retry[slices.Index(retry, "-i"):]) {
				t.Fatal("decoder fallback changed output encoding")
			}
			if slices.Contains(retry, "-hwaccel") || slices.Contains(retry, "av1") {
				t.Fatal("decoder fallback retained hardware-specific input options")
			}
			for _, attempt := range [][]string{args, retry} {
				command := strings.Join(attempt, " ")
				if strings.Contains(command, "-s12m_tc 0") != (codec == "av1") {
					t.Fatal("AV1 timecode workaround missing or applied to another codec")
				}
				for _, want := range []string{"-ss 47.926500", "-ss 0.073500", "-t 12.000000", "-t 12.073500", "noise=drop='lt(n,4)+gte(n,604)'", "-c:v " + codec + "_nvenc", "-preset p3", "-rc vbr -cq 22 -b:v 0", "-init_qpP 22 -init_qpI 20 -init_qpB 24", "-pix_fmt p010le", "-c:a libopus -b:a:0 160k -mapping_family:a:0 0", "type=DOVI_METADATA", "type=DYNAMIC_HDR_PLUS"} {
					if !strings.Contains(command, want) {
						t.Errorf("missing %s", want)
					}
				}
			}
		})
	}
	if p.output() != "HDR10" {
		t.Fatal("incorrect HDR labeling")
	}
}
func TestAudioProfilesPreserveEachTrack(t *testing.T) {
	p := Profile{Quality: 24, Preset: "p3", AudioSurroundKbpsPerChannel: 80}
	streams := []Stream{{Type: "video"}}
	for _, layout := range []struct {
		channels int
		layout   string
	}{{1, "mono"}, {2, "stereo"}, {3, "3.0"}, {4, "quad"}, {5, "5.0"}, {6, "5.1(side)"}, {7, "6.1"}, {8, "7.1"}} {
		s := Stream{Type: "audio", Channels: layout.channels, ChannelLayout: layout.layout}
		if _, ok := opusLayout(s); !ok {
			t.Fatalf("rejected %s", layout.layout)
		}
		streams = append(streams, s)
	}
	for _, codec := range []string{"av1", "hevc"} {
		args := encodeArgs("fixture", t.TempDir(), codec, 1, 30, p, Probe{Streams: streams})
		if slices.Contains(args, "-ac") || slices.Contains(args, "-b:a") || slices.Contains(args, "-af") {
			t.Fatal("global audio options override individual tracks")
		}
		for i, rate := range []string{"80k", "160k", "240k", "320k", "400k", "480k", "560k", "640k"} {
			key := fmt.Sprintf("-b:a:%d", i)
			at := slices.Index(args, key)
			if at < 0 || args[at+1] != rate {
				t.Fatalf("%s: %s missing %s", codec, key, rate)
			}
			family := "1"
			if i < 2 {
				family = "0"
			}
			at = slices.Index(args, fmt.Sprintf("-mapping_family:a:%d", i))
			if at < 0 || args[at+1] != family {
				t.Fatal("incorrect Opus mapping family")
			}
		}
		if !strings.Contains(strings.Join(args, " "), "pan=7.1|FL=FL|FR=FR|FC=FC|LFE=LFE|SL=SL|SR=SR") {
			t.Fatal("side surrounds were not preserved")
		}
	}
	if (Probe{Streams: []Stream{{Type: "audio", Channels: 6, ChannelLayout: "5.1(side)"}}}).audioChannels() != 8 {
		t.Fatal("manifest must report padded encoded width")
	}
	for _, stream := range []Stream{{Channels: 0}, {Channels: 9}, {Channels: 6}, {Channels: 8, ChannelLayout: "7.1(wide)"}} {
		if _, ok := opusLayout(stream); ok {
			t.Fatalf("accepted ambiguous layout: %+v", stream)
		}
	}
	if !validProfile(p) {
		t.Fatal("valid profile rejected")
	}
	s := &Service{options: Options{Profile: p}}
	before := s.fingerprint(&source{key: "fixture"})
	s.options.Profile.AudioSurroundKbpsPerChannel++
	if s.fingerprint(&source{key: "fixture"}) == before {
		t.Fatal("per-channel bitrate did not invalidate cache")
	}
	s.options.Profile.AudioSurroundKbpsPerChannel = 129
	if validProfile(s.options.Profile) {
		t.Fatal("unbounded per-channel bitrate accepted")
	}
}

func TestAudioBitrateOverrideAppliesToMonoStereoAndSurround(t *testing.T) {
	p := Profile{Quality: 24, Preset: "p3", AudioSurroundKbpsPerChannel: 96}
	probe := Probe{Streams: []Stream{
		{Type: "video"},
		{Type: "audio", Channels: 1, ChannelLayout: "mono"},
		{Type: "audio", Channels: 2, ChannelLayout: "stereo"},
		{Type: "audio", Channels: 6, ChannelLayout: "5.1(side)"},
		{Type: "audio", Channels: 8, ChannelLayout: "7.1"},
	}}
	for _, codec := range []string{"av1", "hevc"} {
		args := encodeArgs("fixture", t.TempDir(), codec, 0, 30, p, probe)
		for i, rate := range []string{"96k", "192k", "576k", "768k"} {
			key := fmt.Sprintf("-b:a:%d", i)
			at := slices.Index(args, key)
			if at < 0 || args[at+1] != rate {
				t.Fatalf("%s: %s missing override %s", codec, key, rate)
			}
		}
	}
}

func TestSubtitleBytes(t *testing.T) {
	for _, tc := range []struct {
		tags map[string]string
		want int64
	}{
		{nil, 0},
		{map[string]string{"NUMBER_OF_BYTES": " 12345 "}, 12345},
		{map[string]string{"NUMBER_OF_BYTES-eng": "45678"}, 45678},
		{map[string]string{"NUMBER_OF_BYTES": "12", "NUMBER_OF_BYTES-eng": "34"}, 12},
		{map[string]string{"NUMBER_OF_BYTES": "-1", "NUMBER_OF_BYTES-eng": "34"}, 34},
		{map[string]string{"NUMBER_OF_BYTES": "0"}, 0},
		{map[string]string{"NUMBER_OF_BYTES": "NaN"}, 0},
		{map[string]string{"NUMBER_OF_BYTES": "1e5"}, 0},
		{map[string]string{"NUMBER_OF_BYTES": "+100"}, 0},
		{map[string]string{"NUMBER_OF_BYTES": "9007199254740992"}, 0},
		{map[string]string{"BPS": "10000", "NUMBER_OF_FRAMES": "99"}, 0},
	} {
		if got := (Stream{Tags: tc.tags}).subtitleBytes(); got != tc.want {
			t.Errorf("subtitleBytes(%v) = %d, want %d", tc.tags, got, tc.want)
		}
	}
}

func TestSubtitleHexDump(t *testing.T) {
	decoded, err := unhex("\n00000000: 4865 6c6c 6f21                           Hello!\n")
	if err != nil || string(decoded) != "Hello!" {
		t.Fatalf("%q %v", decoded, err)
	}
	if _, err = unhex("00000000: zzzz  bad"); err == nil {
		t.Fatal("invalid hex accepted")
	}
}
func TestConfinedInputUsesOpenHandleAndRanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media")
	if err := os.WriteFile(path, []byte("original-data"), 0644); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	url, closeInput, err := inputURL(context.Background(), f)
	if err != nil {
		t.Fatal(err)
	}
	defer closeInput()
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Range", "bytes=2-5")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 206 || response.ContentLength != 4 {
		t.Fatalf("range: %d %d", response.StatusCode, response.ContentLength)
	}
	if strings.Contains(url, path) {
		t.Fatal("filesystem path exposed")
	}
}
func TestEncodedRangeHEADAndValidators(t *testing.T) {
	name := filepath.Join(t.TempDir(), "video.mp4")
	_ = os.WriteFile(name, []byte("HEADERencoded-fragment"), 0644)
	serveFile := func(w http.ResponseWriter, r *http.Request, name string, offset, length int64, mime, key string) {
		f, err := os.Open(name)
		if err != nil {
			t.Fatal(err)
		}
		serveOpenFile(w, r, f, offset, length, mime, key)
	}
	req := httptest.NewRequest("GET", "/video", nil)
	req.Header.Set("Range", "bytes=0-6")
	w := httptest.NewRecorder()
	serveFile(w, req, name, 6, 0, "video/mp4", "cache-key")
	if w.Code != 206 || w.Body.String() != "encoded" {
		t.Fatalf("%d %q", w.Code, w.Body.String())
	}
	get := httptest.NewRecorder()
	serveFile(get, httptest.NewRequest("GET", "/video", nil), name, 6, 0, "video/mp4", "cache-key")
	head := httptest.NewRecorder()
	serveFile(head, httptest.NewRequest("HEAD", "/video", nil), name, 6, 0, "video/mp4", "cache-key")
	if head.Body.Len() != 0 || head.Header().Get("Content-Length") != "16" {
		t.Fatal("incorrect HEAD")
	}
	conditional := httptest.NewRequest("GET", "/video", nil)
	conditional.Header.Set("If-None-Match", get.Header().Get("ETag"))
	w = httptest.NewRecorder()
	serveFile(w, conditional, name, 6, 0, "video/mp4", "cache-key")
	if w.Code != 304 {
		t.Fatalf("validator status %d", w.Code)
	}
}
func mp4box(kind string, payload ...[]byte) []byte {
	b := bytes.Join(payload, nil)
	out := make([]byte, 8)
	binary.BigEndian.PutUint32(out, uint32(len(b)+8))
	copy(out[4:], kind)
	return append(out, b...)
}
func TestFragmentTimelineShiftPreservesPayload(t *testing.T) {
	tk := make([]byte, 16)
	binary.BigEndian.PutUint32(tk[12:], 1)
	md := make([]byte, 16)
	binary.BigEndian.PutUint32(md[12:], 48000)
	moov := mp4box("moov", mp4box("trak", mp4box("tkhd", tk), mp4box("mdia", mp4box("mdhd", md))))
	tf := make([]byte, 8)
	binary.BigEndian.PutUint32(tf[4:], 1)
	dt := make([]byte, 12)
	dt[0] = 1
	moof := mp4box("moof", mp4box("traf", mp4box("tfhd", tf), mp4box("tfdt", dt)))
	data := bytes.Join([][]byte{moov, moof, mp4box("mdat", []byte("unchanged HDR payload"))}, nil)
	name := filepath.Join(t.TempDir(), "chunk.mp4")
	_ = os.WriteFile(name, data, 0644)
	offset, err := shiftFragments(name, 24)
	if err != nil {
		t.Fatal(err)
	}
	if offset != int64(len(moov)) {
		t.Fatal("incorrect init length")
	}
	result, _ := os.ReadFile(name)
	index := bytes.Index(result, []byte("tfdt")) + 8
	if got := binary.BigEndian.Uint64(result[index : index+8]); got != 24*48000 {
		t.Fatalf("timeline %d", got)
	}
	if !bytes.HasSuffix(result, []byte("unchanged HDR payload")) {
		t.Fatal("modified video payload")
	}
}

func TestWarmedOpusHasNoRepeatedPreSkip(t *testing.T) {
	dops := []byte{0, 2, 1, 56, 0, 0, 187, 128, 0, 0, 0}
	entry := mp4box("Opus", make([]byte, 28), mp4box("dOps", dops))
	stsd := mp4box("stsd", []byte{0, 0, 0, 0, 0, 0, 0, 1}, entry)
	data := mp4box("moov", mp4box("trak", mp4box("mdia", mp4box("minf", mp4box("stbl", stsd)))))
	name := filepath.Join(t.TempDir(), "audio.mp4")
	if err := os.WriteFile(name, data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := clearOpusPreSkip(name); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(name)
	expected := bytes.Clone(data)
	at := bytes.Index(expected, []byte("dOps")) + 6
	expected[at], expected[at+1] = 0, 0
	if !bytes.Equal(got, expected) {
		t.Fatal("modified data outside Opus pre-skip")
	}
	if err := os.WriteFile(name, data[:len(data)-1], 0644); err != nil {
		t.Fatal(err)
	}
	if err := clearOpusPreSkip(name); err == nil {
		t.Fatal("accepted truncated Opus initialization")
	}
}

func TestAudioLeadInAndFinalPartialSegment(t *testing.T) {
	source := Probe{Streams: []Stream{{Type: "video"}, {Type: "audio"}}}
	first := strings.Join(encodeArgs("fixture", t.TempDir(), "av1", 0, 12.45, Profile{Quality: 22, Preset: "p3", AudioSurroundKbpsPerChannel: 80}, source), " ")
	if !strings.Contains(first, "-ss 0.000000 -i") || !strings.Contains(first, "adelay=3528S:all=1") {
		t.Fatal("missing first-segment lead-in")
	}
	last := strings.Join(encodeArgs("fixture", t.TempDir(), "hevc", 1, 12.45, Profile{Quality: 22, Preset: "p3", AudioSurroundKbpsPerChannel: 80}, source), " ")
	if !strings.Contains(last, "-t 0.523500") || !strings.Contains(last, "gte(n,27)") || strings.Contains(last, "adelay") {
		t.Fatal("incorrect final-segment Opus packet window")
	}
}
