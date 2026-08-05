package main

import (
	"encoding/json"
	"log/slog"

	"familychat/internal/chat"
	"github.com/SherClockHolmes/webpush-go"
)

func (a *app) notifyMessage(message chat.Message) {
	if a.db == nil || a.cfg.VAPIDPublicKey == "" || a.cfg.VAPIDPrivateKey == "" { return }
	subscriptions, err := a.db.PushSubscriptions(message.ConversationID, message.AuthorID)
	if err != nil { slog.Error("push subscriptions", "error", err); return }
	title := "Чат"
	for _, conversation := range a.chat.Conversations(message.AuthorID) {
		if conversation.ID == message.ConversationID {
			title = conversation.Title
			break
		}
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": message.AuthorName + ": " + message.Body, "conversationID": message.ConversationID})
	for _, subscription := range subscriptions {
		response, err := webpush.SendNotification(payload, &subscription, &webpush.Options{Subscriber: a.cfg.VAPIDSubject, VAPIDPublicKey: a.cfg.VAPIDPublicKey, VAPIDPrivateKey: a.cfg.VAPIDPrivateKey, TTL: 300})
		if response != nil { if response.StatusCode == 404 || response.StatusCode == 410 { a.db.RemovePushEndpoint(subscription.Endpoint) }; response.Body.Close() }
		if err != nil { slog.Warn("push notification failed", "error", err) }
	}
}
func (a *app) notifyReaction(conversationID, author, emoji string) { if a.db==nil||a.cfg.VAPIDPublicKey==""||a.cfg.VAPIDPrivateKey=="" { return }; subscriptions,err:=a.db.PushSubscriptions(conversationID,"");if err!=nil{return};payload,_:=json.Marshal(map[string]string{"title":"Новая реакция","body":author+" отреагировал(а): "+emoji,"conversationID":conversationID});for _,subscription:=range subscriptions{response,err:=webpush.SendNotification(payload,&subscription,&webpush.Options{Subscriber:a.cfg.VAPIDSubject,VAPIDPublicKey:a.cfg.VAPIDPublicKey,VAPIDPrivateKey:a.cfg.VAPIDPrivateKey,TTL:300});if response!=nil{response.Body.Close()};if err!=nil{slog.Warn("reaction push notification failed","error",err)}} }
