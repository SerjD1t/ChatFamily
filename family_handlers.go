package main

import (
	"net/http"
	"strings"

	"familychat/internal/chat"
)

func (a *app) updateFamilyMember(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Семьи требуют PostgreSQL"})
		return
	}
	var in struct {
		Role         chat.FamilyRole       `json:"role"`
		Relationship string                `json:"relationship"`
		Categories   []chat.FamilyCategory `json:"categories"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.UpdateFamilyMember(a.user(id(r)), r.PathValue("familyID"), r.PathValue("userID"), in.Role, in.Relationship, in.Categories); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) renameConversation(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Переименование требует PostgreSQL"})
		return
	}
	var in struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.RenameConversation(a.user(id(r)), r.PathValue("id"), in.Title); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	a.hub.publish(realtimeEvent{Type: "conversations.changed", ConversationID: r.PathValue("id")})
}

func (a *app) searchMessages(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Поиск требует PostgreSQL"})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	messages, err := a.db.SearchMessages(a.user(id(r)), r.PathValue("id"), query)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, map[string]any{"messages": messages})
}
