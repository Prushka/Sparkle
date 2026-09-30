package plex

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestParseMappingsWindowsPaths(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		want      []Mapping
	}{
		{
			"forward slashes and Unicode",
			`[{"plex":"/data/Managed-Videos","local":"O:/Managed-Videos"},{"plex":"/data/bili-stream/枯水","local":"M:/bili-stream/哔哩哔哩/枯水"}]`,
			[]Mapping{{"/data/Managed-Videos", "O:/Managed-Videos"}, {"/data/bili-stream/枯水", "M:/bili-stream/哔哩哔哩/枯水"}},
		},
		{
			"pasted backslashes and Unicode",
			`[{"plex":"P:\data\bili-stream\枯水","local":"M:\bili-stream\哔哩哔哩\枯水"}]`,
			[]Mapping{{`P:\data\bili-stream\枯水`, `M:\bili-stream\哔哩哔哩\枯水`}},
		},
		{
			"JSON backslashes and Unicode escapes",
			`[{"plex":"P:\\data\\bili-stream\\\u67af\u6c34","local":"M:\\bili-stream\\哔哩哔哩\\枯水"}]`,
			[]Mapping{{`P:\data\bili-stream\枯水`, `M:\bili-stream\哔哩哔哩\枯水`}},
		},
		{
			"JSON escape-like directory names stay literal",
			`[{"plex":"/data","local":"C:\new\test\bili\root\fonts\u1234"}]`,
			[]Mapping{{"/data", `C:\new\test\bili\root\fonts\u1234`}},
		},
		{
			"trailing separator and drive root",
			`[{"plex":"/data","local":"C:\media\"},{"plex":"/root","local":"d:\"}]`,
			[]Mapping{{"/data", `C:\media\`}, {"/root", `d:\`}},
		},
		{
			"pasted and escaped UNC paths",
			`[{"plex":"/raw","local":"\\server\share\new\枯水"},{"plex":"/escaped","local":"\\\\server\\share\\new\\枯水"}]`,
			[]Mapping{{"/raw", `\\server\share\new\枯水`}, {"/escaped", `\\server\share\new\枯水`}},
		},
		{
			"mixed mapping styles and JSON strings",
			`[{"plex":"/data/\"quoted\"","local":"C:\media"},{"plex":"/other","local":"D:\\other"},{"plex":"/linux","local":"/mnt/media"}]`,
			[]Mapping{{`/data/"quoted"`, `C:\media`}, {"/other", `D:\other`}, {"/linux", "/mnt/media"}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseMappings(tc.raw)
			if err != nil || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("parseMappings = %#v, %v; want %#v", got, err, tc.want)
			}
		})
	}
}

func TestParseMappingsRejectsMalformedInput(t *testing.T) {
	for _, raw := range []string{
		``, `null`, `[]`, `{}`, `[null] trailing`,
		`[{"plex":"/private/media","local":"C:\media"},]`,
		`[{"plex":"/media","local":"C:\media"}`,
		`[{"plex":"/media","local":"C:\\media\invalid"}]`,
		`[{"plex":"/media","local":"/mnt/\invalid"}]`,
		`[{"plex":"/media","local":12}]`,
		"[{\"plex\":\"/media\",\"local\":\"C:\\media\nnewline\"}]",
	} {
		if _, err := parseMappings(raw); err == nil || strings.Contains(err.Error(), "/private/media") {
			t.Errorf("accepted malformed input or exposed its path: %v", err)
		}
	}
}

func TestMappingUnicodeDirectoriesAndWindowsSeparators(t *testing.T) {
	root := filepath.Join(t.TempDir(), "哔哩哔哩", "枯水")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "测试.mkv"), []byte("media"), 0600); err != nil {
		t.Fatal(err)
	}
	jsonMappings, _ := json.Marshal([]Mapping{{"/data/bili-stream/枯水", root}})
	inputs := []string{string(jsonMappings)}
	if runtime.GOOS == "windows" {
		inputs = append(inputs,
			`[{"plex":"/data/bili-stream/枯水","local":"`+filepath.ToSlash(root)+`"}]`,
			`[{"plex":"/data/bili-stream/枯水","local":"`+root+`"}]`,
		)
	}
	for _, input := range inputs {
		c, err := New(Options{URL: "http://127.0.0.1:32400", Token: "test-token", Mappings: input})
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range []string{"/data/bili-stream/枯水/测试.mkv", `\data\bili-stream\枯水\测试.mkv`} {
			f, err := c.Open(file)
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(f)
			f.Close()
			if err != nil || string(data) != "media" {
				t.Fatalf("mapped file = %q, %v", data, err)
			}
		}
		for _, file := range []string{`\data\bili-stream\枯水\..\测试.mkv`, `\data\bili-stream\枯水\测试.mkv:secret`} {
			if f, err := c.Open(file); err == nil {
				f.Close()
				t.Fatal("accepted traversal or alternate stream")
			}
		}
		if err := c.ValidateWritable(filepath.Join(root, "cache")); err == nil {
			t.Fatal("accepted writable directory inside media root")
		}
	}
}
