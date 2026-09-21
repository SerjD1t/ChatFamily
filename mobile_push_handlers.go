package main

import (
	"context"
	"familychat/internal/store"
	"log/slog"
	"net/http"
	"time"
)

func (a *app) mobilePushConfig(w http.ResponseWriter, r *http.Request) {
	write(w, 200, map[string]bool{"enabled": a.fcm != nil && a.db != nil})
}
func (a *app) saveMobileDevice(w http.ResponseWriter, r *http.Request) {
	if a.fcm == nil || a.db == nil {
		write(w, 503, map[string]string{"error": "FCM ещё не настроен на сервере"})
		return
	}
	var in struct {
		InstallationID string `json:"installationId"`
		Token          string `json:"token"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.SaveMobileDevice(r.Context(), id(r), in.InstallationID, in.Token); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) deleteMobileDevice(w http.ResponseWriter, r *http.Request) {
	if !store.ValidInstallationID(r.PathValue("installationID")) {
		write(w, 400, map[string]string{"error": "Некорректное устройство"})
		return
	}
	if a.db != nil {
		if err := a.db.DeleteMobileDevice(r.Context(), id(r), r.PathValue("installationID")); err != nil {
			write(w, 503, map[string]string{"error": "Не удалось отключить устройство"})
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) notifyMobile(cid, excluded, kind string, messageID ...string) {
	if a.fcm == nil || a.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	devices, err := a.db.MobileDevices(ctx, cid, excluded)
	if err != nil {
		slog.Warn("mobile push device lookup failed")
		return
	}
	for _, device := range devices {
		count, countErr := a.db.UnreadTotal(ctx, device.UserID)
		var counts []int
		if countErr == nil {
			counts = []int{count}
		}
		mid := ""
		if len(messageID) > 0 {
			mid = messageID[0]
		}
		status, invalid, err := a.fcm.SendMessage(ctx, device.Token, device.UserID, cid, kind, mid, counts...)
		if invalid {
			_ = a.db.RemoveInvalidMobileToken(ctx, device.Token)
		}
		if err != nil {
			slog.Warn("mobile push transport failed")
			continue
		}
		if status < 200 || status >= 300 {
			slog.Warn("mobile push rejected", "status", status)
		}
	}
}
