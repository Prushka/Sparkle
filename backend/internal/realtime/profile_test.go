package realtime

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProfileLimitsAndUnicodeGuestNames(t *testing.T) {
	h := NewHub(Options{MaxUploadBytes: 64, MaxUsernameLength: 4})
	w := httptest.NewRecorder()
	h.HandleProfileLimits(w, httptest.NewRequest("GET", "/profile/limits", nil))
	var limits map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &limits); err != nil || limits["maxPfpBytes"] != 64 || limits["maxUsernameLength"] != 4 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("limits = %v, %v", limits, err)
	}
	for _, id := range []string{"viewer", "media_watcher"} {
		p := newPlayer(nil, id)
		r := h.addPlayerToRoom("profiles", p)
		r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: "  😀枯水a  ", ProfileId: "avatar"})
		if p.state.Name != "😀枯水a" {
			t.Fatal("valid Unicode name was shortened")
		}
		r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: "😀枯水ab", ProfileId: "replacement"})
		if p.state.Name != "😀枯水a" || p.state.ProfileId != "avatar" {
			t.Fatal("over-limit profile changed existing state")
		}
		var response SendPayload
		if err := json.Unmarshal(<-p.send, &response); err != nil || response.Type != ProfileError || response.Error != "Username must be 4 characters or fewer." {
			t.Fatalf("profile rejection = %#v, %v", response, err)
		}
	}
	if len(h.rooms["profiles"].players) != 1 || len(h.rooms["profiles"].mediaSubscribers) != 1 {
		t.Fatal("watcher identification changed room participation")
	}
}

func TestGuestLimitPreservesAccountNames(t *testing.T) {
	h := NewHub(Options{MaxUsernameLength: 4})
	p := newPlayer(nil, "viewer")
	r := h.addPlayerToRoom("accounts", p)
	name := strings.Repeat("P", 40)
	p.accountProfile = func() (string, string, bool) { return "plex-verified", name, true }
	r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: "Forged", ProfileId: "guest"})
	if p.state.Name != name || p.state.ProfileId != "plex-verified" {
		t.Fatal("guest limit changed verified Plex identity")
	}
	p.accountProfile = nil
	r.handlePayload(p, ClientPayload{Type: ProfileSync, Name: name, DiscordUser: &DiscordUser{ID: "123", Username: name}})
	if p.state.Name != name || p.state.DiscordUser == nil || p.state.DiscordUser.Username != name {
		t.Fatal("guest limit changed Discord identity")
	}
}

func TestAvatarUploadSizeBoundariesAndBodyLimit(t *testing.T) {
	for _, tc := range []struct {
		name         string
		size, status int
	}{
		{"below", 63, http.StatusOK},
		{"exact", 64, http.StatusOK},
		{"above", 65, http.StatusRequestEntityTooLarge},
		{"oversized request", (1 << 20) + 2048, http.StatusRequestEntityTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profiles := t.TempDir()
			h := NewHub(Options{PFPDir: profiles, MaxUploadBytes: 64})
			path := filepath.Join(profiles, "viewer.png")
			if err := os.WriteFile(path, []byte("old avatar"), 0600); err != nil {
				t.Fatal(err)
			}
			content := make([]byte, tc.size)
			copy(content, "\x89PNG\r\n\x1a\n")
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("pfp", "avatar.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(content); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/pfp/viewer", &body)
			req.SetPathValue("id", "viewer")
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.ContentLength = -1 // Also enforce the limit on streamed/chunked uploads.
			w := httptest.NewRecorder()
			h.HandlePFP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status = %d: %s", w.Code, w.Body.String())
			}
			saved, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if tc.status == http.StatusOK {
				if !bytes.Equal(saved, content) {
					t.Fatal("accepted avatar bytes changed")
				}
			} else if string(saved) != "old avatar" || !strings.Contains(w.Body.String(), "64 bytes") {
				t.Fatal("rejected upload replaced avatar or omitted configured limit")
			}
			entries, err := os.ReadDir(profiles)
			if err != nil || len(entries) != 1 {
				t.Fatal("upload left intermediate files")
			}
		})
	}
}
