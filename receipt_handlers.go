package main

import "net/http"

func (a *app) receipts(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	var in struct {
		MessageIDs []string `json:"messageIds"`
		Read       bool     `json:"read"`
	}
	if !decode(w, r, &in) {
		return
	}
	conversations, err := a.db.RecordReceipts(a.user(id(r)), in.MessageIDs, in.Read)
	if err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	for _, cid := range conversations {
		a.hub.publish(realtimeEvent{Type: "message.status", ConversationID: cid})
	}
}
func (a *app) pendingDeliveries(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	ids, err := a.db.PendingDeliveries(a.user(id(r)))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, ids)
}
func (a *app) receiptStatuses(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	var in struct {
		MessageIDs []string `json:"messageIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if r.URL.Query().Get("details") == "1" {
		statuses, err := a.db.ReceiptSummaries(a.user(id(r)), in.MessageIDs)
		if err != nil {
			domainError(w, err)
			return
		}
		write(w, 200, statuses)
		return
	}
	statuses, err := a.db.ReceiptStatuses(a.user(id(r)), in.MessageIDs)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, statuses)
}

func (a *app) receiptDetails(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	recipients, err := a.db.ReceiptDetails(a.user(id(r)), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, map[string]any{"recipients": recipients, "membership": "current"})
}
