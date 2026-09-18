package main

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"familychat/internal/store"
)

func (a *app) userAutomations(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	if r.Method == http.MethodGet {
		settings, err := a.db.AutomationSettings(r.Context(), id(r))
		if err != nil {
			domainError(w, err)
			return
		}
		write(w, http.StatusOK, settings)
		return
	}
	var settings store.AutomationSettings
	if !decode(w, r, &settings) {
		return
	}
	if err := a.db.SaveAutomationSettings(r.Context(), id(r), settings, time.Now()); err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, settings)
}

func (a *app) dailyReports(ctx context.Context) {
	if a.db == nil {
		return
	}
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		batch, cancel := context.WithTimeout(ctx, 30*time.Second)
		for i := 0; i < 100; i++ {
			message, processed, err := a.db.SendNextDailyReport(batch, time.Now())
			if err != nil {
				if ctx.Err() == nil {
					slog.Warn("daily report delivery failed; retry on next tick")
				}
				break
			}
			if !processed {
				break
			}
			if message.ID != "" {
				a.hub.publish(realtimeEvent{Type: "message.created", UserID: message.AuthorID, ConversationID: message.ConversationID, MessageID: message.ID})
			}
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
