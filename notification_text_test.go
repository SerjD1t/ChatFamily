package main

import (
	"familychat/internal/chat"
	"testing"
)

func TestNotificationShowsSenderNotRecipientsOwnName(t *testing.T) {
	m := chat.Message{ID: "message", ConversationID: "direct", AuthorName: "Synthetic Sender", Body: "Message text"}
	payload := messageNotification(m, []chat.Conversation{{ID: "direct", Kind: chat.Direct, Title: "Synthetic Recipient"}})
	if payload["title"] != "Synthetic Sender" || payload["body"] != "Message text" || payload["messageID"] != "message" {
		t.Fatal("incorrect notification routing or duplication")
	}
	payload = messageNotification(m, []chat.Conversation{{ID: "direct", Kind: chat.Group, Title: "Synthetic Group"}})
	if payload["title"] != "Synthetic Sender · Synthetic Group" {
		t.Fatal("group context missing")
	}
}
