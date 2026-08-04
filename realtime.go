package main

import (
	"context"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

type hub struct {
	mu      sync.Mutex
	clients map[chan struct{}]struct{}
}

func newHub() *hub { return &hub{clients: map[chan struct{}]struct{}{}} }
func (h *hub) publish() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for client := range h.clients {
		select {
		case client <- struct{}{}:
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
	updates := make(chan struct{}, 1)
	h.mu.Lock()
	h.clients[updates] = struct{}{}
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.clients, updates); h.mu.Unlock() }()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-updates:
			if conn.Write(context.Background(), websocket.MessageText, []byte("refresh")) != nil {
				return
			}
		}
	}
}
