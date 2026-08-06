package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

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
func (h *hub) serve(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	updates := make(chan realtimeEvent, 1)
	h.mu.Lock()
	h.clients[updates] = struct{}{}
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.clients, updates); h.mu.Unlock() }()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-updates:
			payload, _ := json.Marshal(event)
			if conn.Write(context.Background(), websocket.MessageText, payload) != nil {
				return
			}
		}
	}
}
