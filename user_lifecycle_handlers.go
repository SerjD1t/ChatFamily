package main

import (
	"errors"
	"familychat/internal/chat"
	"familychat/internal/store"
	"net/http"
)

func (a *app) changeUserLifecycle(w http.ResponseWriter, r *http.Request) {
	if !a.user(id(r)).Permissions[chat.ManageApplication] {
		write(w, 403, map[string]string{"error": "Только администратор приложения может управлять аккаунтами"})
		return
	}
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	var in struct {
		Action string `json:"action"`
		Email  string `json:"email"`
	}
	if !decode(w, r, &in) {
		return
	}
	err := a.db.ChangeUserLifecycle(id(r), r.PathValue("userID"), in.Action, in.Email)
	switch {
	case errors.Is(err, store.ErrUserProtected):
		write(w, 409, map[string]string{"error": "Нельзя изменить собственный, системный или последний активный административный аккаунт"})
	case errors.Is(err, store.ErrUserHistory):
		write(w, 409, map[string]string{"error": "У аккаунта есть история или связанные данные. Используйте деактивацию"})
	case errors.Is(err, store.ErrEmailConfirmation):
		write(w, 400, map[string]string{"error": "Введите точный email выбранного аккаунта"})
	case err != nil:
		domainError(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
