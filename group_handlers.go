package main

import (
	"familychat/internal/store"
	"net/http"
)

func (a *app) groupAction(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	action := r.PathValue("action")
	var in store.GroupChange
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.ChangeGroup(a.user(id(r)), r.PathValue("id"), action, in); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(204)
	a.hub.publish(realtimeEvent{Type: "conversations.changed"})
}
func (a *app) conversationIcon(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	var in struct {
		Icon string `json:"icon"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.SetConversationIcon(a.user(id(r)), r.PathValue("id"), in.Icon); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(204)
	a.hub.publish(realtimeEvent{Type: "conversations.changed"})
}
func (a *app) ownerlessGroups(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	groups, err := a.db.OwnerlessGroups(a.user(id(r)))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, groups)
}
