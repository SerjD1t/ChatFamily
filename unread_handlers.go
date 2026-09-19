package main

import "net/http"

func (a *app) unreadTotal(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	count, err := a.db.UnreadTotal(r.Context(), id(r))
	if err != nil {
		write(w, 503, map[string]string{"error": "Не удалось обновить счётчик"})
		return
	}
	write(w, 200, map[string]any{"count": count, "userID": id(r)})
}
