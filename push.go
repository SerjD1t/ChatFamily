package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"familychat/internal/chat"
	"github.com/SherClockHolmes/webpush-go"
)

func (a *app) notifyMessage(message chat.Message) {
	go a.notifyMobile(message.ConversationID, message.AuthorID, "message", message.ID)
	if a.db == nil || a.cfg.VAPIDPublicKey == "" || a.cfg.VAPIDPrivateKey == "" {
		return
	}
	subscriptions, err := a.db.PushSubscriptions(message.ConversationID, message.AuthorID)
	if err != nil {
		slog.Error("push subscriptions", "error_type", fmt.Sprintf("%T", err))
		return
	}
	payload, _ := json.Marshal(messageNotification(message, a.chat.Conversations(message.AuthorID)))
	for _, subscription := range subscriptions {
		response, err := webpush.SendNotification(payload, &subscription, a.pushOptions())
		if response != nil {
			if response.StatusCode == 404 || response.StatusCode == 410 {
				a.db.RemovePushEndpoint(subscription.Endpoint)
			}
			logPushStatus(response.StatusCode)
			response.Body.Close()
		}
		if err != nil {
			slog.Warn("push notification failed", "error_type", fmt.Sprintf("%T", err))
		}
	}
}
func messageNotification(message chat.Message, conversations []chat.Conversation) map[string]string {
	title := message.AuthorName
	for _, conversation := range conversations {
		if conversation.ID == message.ConversationID {
			if conversation.Kind != "direct" {
				title += " · " + conversation.Title
			}
			break
		}
	}
	body := message.Body
	if body == "" && len(message.Attachments) > 0 {
		body = "Вложение"
	}
	if text := []rune(body); len(text) > 180 {
		body = string(text[:180]) + "…"
	}
	if text := []rune(title); len(text) > 100 {
		title = string(text[:100]) + "…"
	}
	return map[string]string{"title": title, "body": body, "conversationID": message.ConversationID, "messageID": message.ID}
}
func (a *app) notifyReaction(conversationID, actorID, author, emoji string, messageID ...string) {
	if actorID == "" {
		return
	}
	go a.notifyMobile(conversationID, actorID, "reaction", messageID...)
	if a.db == nil || a.cfg.VAPIDPublicKey == "" || a.cfg.VAPIDPrivateKey == "" {
		return
	}
	subscriptions, err := a.db.PushSubscriptions(conversationID, actorID)
	if err != nil {
		return
	}
	mid := ""
	if len(messageID) > 0 {
		mid = messageID[0]
	}
	payload, _ := json.Marshal(map[string]string{"title": "Новая реакция", "body": author + " отреагировал(а): " + emoji, "conversationID": conversationID, "messageID": mid})
	for _, subscription := range subscriptions {
		response, err := webpush.SendNotification(payload, &subscription, a.pushOptions())
		if response != nil {
			logPushStatus(response.StatusCode)
			response.Body.Close()
		}
		if err != nil {
			slog.Warn("reaction push notification failed", "error_type", fmt.Sprintf("%T", err))
		}
	}
}

// webpush-go v1.3.0 adds mailto: itself; it expects a bare email address.
func pushSubscriber(subject string) string {
	subject = strings.TrimSpace(subject)
	for strings.HasPrefix(strings.ToLower(subject), "mailto:") {
		subject = strings.TrimSpace(subject[len("mailto:"):])
	}
	return subject
}
func (a *app) pushOptions() *webpush.Options {
	return &webpush.Options{Subscriber: pushSubscriber(a.cfg.VAPIDSubject),
		VAPIDPublicKey: a.cfg.VAPIDPublicKey, VAPIDPrivateKey: a.cfg.VAPIDPrivateKey,
		TTL: 300, HTTPClient: &http.Client{Timeout: 15 * time.Second}}
}
func logPushStatus(status int) {
	if status < 200 || status >= 300 {
		slog.Warn("push provider rejected notification", "status", status)
	}
}
