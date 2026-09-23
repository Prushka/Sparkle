package encode

import (
	"bytes"
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEncoderMatchesReferenceAndSeparatesOutputs(t *testing.T) {
	p := Probe{Streams: []Stream{{Type: "video", Transfer: "smpte2084"}, {Type: "audio", Codec: "truehd"}, {Type: "subtitle", Codec: "hdmv_pgs_subtitle"}, {Type: "subtitle", Codec: "mov_text"}}}
	args := strings.Join(encodeArgs("http://127.0.0.1/input", t.TempDir(), "hevc", 4, 100, Profile{22, "p7", 144}, p), " ")
	for _, want := range []string{"-ss 24.000000", "-t 6.000000", "-c:v hevc_nvenc", "-preset p7", "-rc vbr -cq 22 -b:v 0", "-init_qpP 22 -init_qpI 20 -init_qpB 24", "-pix_fmt p010le", "-c:a libopus -b:a 144k -ac 2", "type=DOVI_METADATA", "type=DYNAMIC_HDR_PLUS"} {
		if !strings.Contains(args, want) {
			t.Errorf("missing %s", want)
		}
	}
	if p.output() != "HDR10" {
		t.Fatal("incorrect HDR labeling")
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
