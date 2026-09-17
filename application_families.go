package main

import (
	"errors"
	"familychat/internal/chat"
	"familychat/internal/store"
	"net/http"
	"strconv"
)

func (a *app) applicationFamilies(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	actor := a.user(id(r))
	if !actor.Permissions[chat.ManageApplication] {
		domainError(w, chat.ErrForbidden)
		return
	}
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Семьи требуют PostgreSQL"})
		return
	}
	familyID, userID := r.PathValue("familyID"), r.PathValue("userID")
	if r.Method == http.MethodGet {
		offset := 0
		if value := r.URL.Query().Get("offset"); value != "" {
			var err error
			offset, err = strconv.Atoi(value)
			if err != nil || offset < 0 || offset > 1000000 {
				domainError(w, chat.ErrInvalid)
				return
			}
		}
		q := r.URL.Query().Get("q")
		if len([]rune(q)) > 120 {
			domainError(w, chat.ErrInvalid)
			return
		}
		if familyID == "" {
			items, total, err := a.db.ApplicationFamilies(actor.ID, q, offset)
			if err != nil {
				domainError(w, err)
				return
			}
			write(w, 200, map[string]any{"items": items, "total": total})
			return
		}
		if r.PathValue("list") != "members" && r.PathValue("list") != "candidates" {
			domainError(w, chat.ErrNotFound)
			return
		}
		items, total, err := a.db.ApplicationFamilyUsers(actor.ID, familyID, q, offset, r.PathValue("list") == "candidates")
		if err != nil {
			domainError(w, err)
			return
		}
		write(w, 200, map[string]any{"items": items, "total": total})
		return
	}
	var in store.FamilyAdminChange
	if r.Method != http.MethodDelete && !decode(w, r, &in) {
		return
	}
	action := "update"
	if userID == "" {
		action = "rename"
	} else if r.Method == http.MethodPut {
		action = "add"
	} else if r.Method == http.MethodDelete {
		action = "remove"
	}
	if err := a.db.ChangeApplicationFamily(actor.ID, familyID, userID, action, in); err != nil {
		if errors.Is(err, store.ErrLastFamilyOwner) {
			write(w, http.StatusConflict, map[string]string{"error": "Сначала назначьте другого активного владельца семьи"})
			return
		}
		domainError(w, err)
		return
	}
	a.hub.publish(realtimeEvent{Type: "conversations.changed"})
	w.WriteHeader(http.StatusNoContent)
}
