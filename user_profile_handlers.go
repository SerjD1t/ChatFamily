package main

import (
	"net/http"
)

func (a *app) updateProfile(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	var in struct {
		FirstName string `json:"firstName"`
		LastName  string `json:"lastName"`
	}
	if !decode(w, r, &in) {
		return
	}
	user, err := a.db.UpdateUserNames(id(r), in.FirstName, in.LastName)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, user)
}
