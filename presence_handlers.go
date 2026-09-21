package main

import "net/http"

func (a *app) presence(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	if r.URL.Path == "/api/v1/me/activity" {
		var in struct {
			AgeMS int `json:"ageMs"`
		}
		if !decode(w, r, &in) {
			return
		}
		if err := a.db.RecordActivity(r.Context(), id(r), in.AgeMS); err != nil {
			domainError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var in struct {
		UserIDs []string `json:"userIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.UserIDs) > 100 {
		write(w, 400, map[string]string{"error": "Не более 100 пользователей"})
		return
	}
	result, err := a.db.UserPresence(r.Context(), in.UserIDs)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, result)
}
