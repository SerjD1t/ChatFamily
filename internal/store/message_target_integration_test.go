package store

import (
	"context"
	"familychat/internal/chat"
	"os"
	"testing"
)

func TestNotificationMessagePageAccessAndNoReadSideEffects(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	p, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	defer func() {
		p.Pool.Exec(ctx, `DELETE FROM messages WHERE author_id=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM conversations WHERE created_by=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM users WHERE id=ANY($1::text[])`, ids)
	}()
	users := []chat.User{}
	for _, name := range []string{"target-a", "target-b", "target-outsider"} {
		u, err := p.Register(name+"@example.test", name, "Synthetic-password-2026", 12)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, u.ID)
		users = append(users, u)
	}
	c, err := p.DirectConversation(users[0], users[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	var target string
	for index := 0; index < 60; index++ {
		message, err := p.CreateMessage(users[0], c.ID, "Synthetic message", nil)
		if err != nil {
			t.Fatal(err)
		}
		if index == 4 {
			target = message.ID
		}
	}
	page, err := p.MessagesAround(users[1], c.ID, target, 3)
	if err != nil {
		t.Fatal(err)
	}
	// Equal database timestamps need not put the target last in the returned
	// slice. Navigation locates it by ID, not by position within the page.
	found := false
	for _, message := range page.Messages {
		found = found || message.ID == target
	}
	if len(page.Messages) != 3 || !found || page.NextBefore == "" {
		t.Fatal("target page does not contain requested older message")
	}
	if _, err = p.MessagesAround(users[2], c.ID, target, 3); err == nil {
		t.Fatal("outsider accessed target")
	}
	var count int
	if err = p.Pool.QueryRow(ctx, `SELECT count(*) FROM message_receipts WHERE user_id=$1 AND read_at IS NOT NULL`, users[1].ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("loading history marked messages read")
	}
}
