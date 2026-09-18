package main

import (
	"errors"
	"familychat/internal/store"
	"net/http"
)

func (a *app) needs(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	actor := a.user(id(r))
	familyID, itemID := r.PathValue("familyID"), r.PathValue("itemID")
	var result any
	var err error
	status := http.StatusOK
	switch {
	case r.Method == "GET" && itemID == "":
		result, err = a.db.ListNeeds(actor, familyID, r.URL.Query().Get("archived") == "true")
	case r.Method == "GET":
		result, err = a.db.NeedDetails(actor, familyID, itemID)
	case r.Method == "POST" && itemID != "":
		var in struct {
			Body string `json:"body"`
		}
		if !decode(w, r, &in) {
			return
		}
		err = a.db.CommentNeed(actor, familyID, itemID, in.Body)
		status = http.StatusCreated
		result = map[string]bool{"ok": true}
	default:
		var in store.NeedInput
		if !decode(w, r, &in) {
			return
		}
		result, err = a.db.SaveNeed(actor, familyID, itemID, in)
		if r.Method == "POST" {
			status = http.StatusCreated
		}
	}
	if errors.Is(err, store.ErrNeedConflict) {
		write(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, status, result)
	if r.Method != "GET" {
		event := realtimeEvent{Type: "shopping.changed"}
		if familyID == "" {
			event.UserID = actor.ID
		}
		a.hub.publish(event)
	}
}
