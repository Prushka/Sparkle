package realtime

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestCreateRoomPreservesExistingState(t *testing.T) {
	h := NewHub(Options{})
	defer h.Close()
	create := func(media string) roomResponse {
		t.Helper()
		w := httptest.NewRecorder()
		h.HandleCreateRoom(w, httptest.NewRequest("POST", "/rooms", strings.NewReader(`{"roomId":"restored","mediaId":"`+media+`"}`)))
		var result roomResponse
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatalf("create: %d %s", w.Code, w.Body.String())
		}
		return result
	}
	first := create("original")
	room := h.rooms["restored"]
	room.state.Time = 42
	for _, media := range []string{"", "replacement", "original"} {
		if got := create(media); got != first || room.state.Time != 42 {
			t.Fatalf("repeated creation changed the room: %+v", got)
		}
	}
	// Destruction followed by reopening restores the same identity.
	h.mu.Lock()
	delete(h.rooms, "restored")
	h.mu.Unlock()
	if got := create("replacement"); got.RoomID != "restored" || got.MediaID != "replacement" {
		t.Fatalf("expired room was not recreated: %+v", got)
	}
}

func TestConcurrentRoomCreationSelectsOneMedia(t *testing.T) {
	h := NewHub(Options{})
	defer h.Close()
	var wg sync.WaitGroup
	responses := make(chan roomResponse, 16)
	for i := range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			body := fmt.Sprintf(`{"roomId":"concurrent","mediaId":"media-%d"}`, i)
			h.HandleCreateRoom(w, httptest.NewRequest("POST", "/rooms", strings.NewReader(body)))
			var result roomResponse
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
				t.Errorf("create: %d %s", w.Code, w.Body.String())
			}
			responses <- result
		}()
	}
	wg.Wait()
	close(responses)
	final, _ := h.roomSnapshot("concurrent")
	for response := range responses {
		if response != final {
			t.Fatalf("concurrent creation replaced media: %+v != %+v", response, final)
		}
	}
}
