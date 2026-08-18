package main

import (
	"net/http"
	"strings"

	"familychat/internal/chat"
)

func (a *app) userPreferences(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Настройки требуют PostgreSQL"})
		return
	}
	prefs, err := a.db.UserPreferences(id(r))
	if err != nil {
		write(w, http.StatusInternalServerError, map[string]string{"error": "Не удалось получить настройки"})
		return
	}
	write(w, http.StatusOK, prefs)
}

func (a *app) updateUserPreferences(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Настройки требуют PostgreSQL"})
		return
	}
	var prefs chat.UserPreferences
	if !decode(w, r, &prefs) {
		return
	}
	prefs, err := a.db.SetUserPreferences(id(r), prefs)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, prefs)
}

func (a *app) shoppingItems(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Покупки требуют PostgreSQL"})
		return
	}
	items, err := a.db.ShoppingItems(a.user(id(r)), r.PathValue("familyID"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, items)
}

func (a *app) addShoppingItem(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Покупки требуют PostgreSQL"})
		return
	}
	var in struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &in) {
		return
	}
	item, err := a.db.AddShoppingItem(a.user(id(r)), r.PathValue("familyID"), strings.TrimSpace(in.Title))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusCreated, item)
	a.hub.publish(realtimeEvent{Type: "shopping.changed"})
}

func (a *app) toggleShoppingItem(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Покупки требуют PostgreSQL"})
		return
	}
	var in struct {
		Completed bool `json:"completed"`
	}
	if !decode(w, r, &in) {
		return
	}
	item, err := a.db.ToggleShoppingItem(a.user(id(r)), r.PathValue("familyID"), r.PathValue("itemID"), in.Completed)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, item)
	a.hub.publish(realtimeEvent{Type: "shopping.changed"})
}

func (a *app) deleteShoppingItem(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Покупки требуют PostgreSQL"})
		return
	}
	if err := a.db.DeleteShoppingItem(a.user(id(r)), r.PathValue("familyID"), r.PathValue("itemID")); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	a.hub.publish(realtimeEvent{Type: "shopping.changed"})
}
