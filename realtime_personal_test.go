package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestPersonalEventAudience(t *testing.T) {
	h := newHub()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.serve(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, r.URL.Query().Get("user"))))
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	owner, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"?user=owner", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.CloseNow()
	other, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"?user=other", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer other.CloseNow()
	for {
		h.mu.Lock()
		ready := len(h.clients) == 2
		h.mu.Unlock()
		if ready {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("clients not ready")
		case <-time.After(time.Millisecond):
		}
	}
	h.publish(realtimeEvent{Type: "shopping.changed", UserID: "owner"})
	h.publish(realtimeEvent{Type: "test.marker"})
	_, payload, err := owner.Read(ctx)
	if err != nil || string(payload) != `{"type":"shopping.changed"}` {
		t.Fatalf("owner event: %s, %v", payload, err)
	}
	_, payload, err = other.Read(ctx)
	if err != nil || string(payload) != `{"type":"test.marker"}` {
		t.Fatalf("private event leaked: %s, %v", payload, err)
	}
}
