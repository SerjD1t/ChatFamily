package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type realtimeEvent struct {
	Type           string `json:"type"`
	ConversationID string `json:"conversationId,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
}
type hub struct {
	mu      sync.Mutex
	clients map[chan realtimeEvent]struct{}
}

func newHub() *hub { return &hub{clients: map[chan realtimeEvent]struct{}{}} }
func (h *hub) publish(event realtimeEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clients {
		select {
		case client <- event:
		default:
		}
	}
}
func (h *hub) serve(w http.ResponseWriter, r *http.Request, allowed ...func() bool) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"chatfamily.site"}})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	valid := func() bool { return len(allowed) == 0 || allowed[0]() }
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	updates := make(chan realtimeEvent, 64)
	h.mu.Lock()
	h.clients[updates] = struct{}{}
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.clients, updates); h.mu.Unlock() }()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if !valid() {
				return
			}
		case event := <-updates:
			if !valid() {
				return
			}
			payload, _ := json.Marshal(event)
			if conn.Write(context.Background(), websocket.MessageText, payload) != nil {
				return
			}
		}
	}
}
