package realtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestTabSocketProfilesPreserveVerifiedAccount(t *testing.T) {
	for _, role := range []string{YouTubeSync, ChessSync, WordleSync, CottageSync} {
		for _, tc := range []struct {
			name, parentAccount, tabAccount string
			discord                         bool
			wantName, wantProfile           string
		}{
			{"anonymous cannot inherit Plex", "alice", "", false, "", ""},
			{"different Plex account", "alice", "bob", false, "Bob", "plex-bob"},
			{"same Plex account", "alice", "alice", false, "Alice", "plex-alice"},
			{"guest cannot replace Plex", "", "bob", false, "Bob", "plex-bob"},
			{"guest inheritance", "", "", false, "Main guest", "guest-avatar"},
			{"Discord inheritance", "", "", true, "Main guest", "guest-avatar"},
		} {
			t.Run(role+"/"+tc.name, func(t *testing.T) {
				type accountKey struct{}
				h := NewHub(Options{AccountProfile: func(ctx context.Context) (string, string, bool) {
					switch ctx.Value(accountKey{}) {
					case "alice":
						return "plex-alice", "Alice", true
					case "bob":
						return "plex-bob", "Bob", true
					default:
						return "", "", false
					}
				}})
				h.upsertRoom("room", "movie", nil)
				mux := http.NewServeMux()
				mux.HandleFunc("GET /sync/{room}/{id}", h.HandleWebSocket)
				var handlers sync.WaitGroup
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					handlers.Add(1)
					defer handlers.Done()
					// Only this disposable test server treats a fixture header as an account.
					ctx := context.WithValue(r.Context(), accountKey{}, r.Header.Get("X-Fixture-Account"))
					mux.ServeHTTP(w, r.WithContext(ctx))
				}))
				t.Cleanup(func() {
					h.Close()
					server.Close()
					handlers.Wait()
				})
				dial := func(path, account string) *websocket.Conn {
					t.Helper()
					conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+path, http.Header{"X-Fixture-Account": {account}})
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { conn.Close() })
					if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
						t.Fatal(err)
					}
					return conn
				}
				parent := dial("/sync/room/public-player-id", tc.parentAccount)
				profile := ClientPayload{Type: ProfileSync, Name: "Main guest", ProfileId: "guest-avatar"}
				if tc.discord {
					profile.DiscordUser = &DiscordUser{ID: "123", Username: "Discord guest"}
				}
				if err := parent.WriteJSON(profile); err != nil {
					t.Fatal(err)
				}
				if err := parent.WriteJSON(ClientPayload{Type: NewPlayer}); err != nil {
					t.Fatal(err)
				}
				var initial SendPayload
				if err := parent.ReadJSON(&initial); err != nil {
					t.Fatal(err)
				}
				h.mu.RLock()
				main := h.rooms["room"]
				h.mu.RUnlock()
				main.mu.RLock()
				before := main.state
				main.mu.RUnlock()

				child := dial("/sync/"+role+":room/public-player-id-"+role, tc.tabAccount)
				if err := child.WriteJSON(ClientPayload{Type: NewPlayer}); err != nil {
					t.Fatal(err)
				}
				if err := child.WriteJSON(ClientPayload{Type: ChatSync, Chat: "tab identity check"}); err != nil {
					t.Fatal(err)
				}
				for {
					var message SendPayload
					if err := child.ReadJSON(&message); err != nil {
						t.Fatal(err)
					}
					if message.Chat == nil || message.Chat.Message != "tab identity check" {
						continue
					}
					author := message.Chat.Author
					if author == nil || author.Name != tc.wantName || author.ProfileId != tc.wantProfile {
						t.Fatalf("tab author = %#v; want name=%q profile=%q", author, tc.wantName, tc.wantProfile)
					}
					if (author.DiscordUser != nil) != tc.discord {
						t.Fatalf("tab Discord identity = %#v", author.DiscordUser)
					}
					break
				}
				main.mu.RLock()
				defer main.mu.RUnlock()
				if main.state != before || main.mediaID != "movie" || len(main.players) != 1 {
					t.Fatal("tab connection changed main-room playback, media or presence")
				}
			})
		}
	}
}
