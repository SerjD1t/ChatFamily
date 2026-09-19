package main

import (
	"errors"
	"familychat/internal/store"
	"net/http"
)

func (a *app) interfamilyChats(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	if r.Method == "GET" {
		if r.URL.Query().Get("candidates") == "1" {
			out, e := a.db.InterfamilyCandidates(a.user(id(r)), r.URL.Query().Get("familyId"))
			if e != nil {
				domainError(w, e)
				return
			}
			write(w, 200, out)
			return
		}
		out, e := a.db.InterfamilyChats(a.user(id(r)), r.URL.Query().Get("familyId"))
		if e != nil {
			domainError(w, e)
			return
		}
		write(w, 200, out)
		return
	}
	var in store.InterfamilyInput
	if !decode(w, r, &in) {
		return
	}
	out, e := a.db.CreateInterfamily(a.user(id(r)), in)
	if e != nil {
		domainError(w, e)
		return
	}
	write(w, 201, out)
	a.hub.publish(realtimeEvent{Type: "conversations.changed"})
}
func (a *app) interfamilyAction(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	var in store.InterfamilyInput
	if !decode(w, r, &in) {
		return
	}
	out, e := a.db.ChangeInterfamily(a.user(id(r)), r.PathValue("id"), r.PathValue("action"), in)
	if e != nil {
		if errors.Is(e, store.ErrShareConflict) {
			write(w, 409, map[string]string{"error": "Настройки изменились. Закройте карточку и заново откройте управление семейными чатами."})
			return
		}
		domainError(w, e)
		return
	}
	write(w, 200, out)
	a.hub.publish(realtimeEvent{Type: "conversations.changed"})
}
