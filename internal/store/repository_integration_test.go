package store

import (
	"context"
	"os"
	"testing"

	"familychat/internal/chat"
)

func TestPostgresRepositoryRoundTrip(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	p, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	if err := p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}

	admin := chat.User{ID: "test_admin_repository", Email: "test-admin@example.test", Name: "Test admin", Permissions: map[chat.Permission]bool{chat.ManageUsers: true, chat.CreateGroups: true, chat.SendMessages: true}}
	member := chat.User{ID: "test_member_repository", Email: "test-member@example.test", Name: "Test member", Permissions: map[chat.Permission]bool{}}
	for _, user := range []chat.User{admin, member} {
		if err := p.AddUser(admin, user); err != nil && user.ID != admin.ID {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = p.Pool.Exec(ctx, `DELETE FROM users WHERE id LIKE 'test_%'`) })
	family, err := p.CreateFamily(admin, "Test family", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Pool.Exec(ctx, "DELETE FROM conversations WHERE family_id=$1", family.ID)
		_, _ = p.Pool.Exec(ctx, "DELETE FROM families WHERE id=$1", family.ID)
	})
	if _, err := p.Pool.Exec(ctx, "INSERT INTO family_members(family_id,user_id) VALUES($1,$2)", family.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	group, err := p.CreateGroupInFamily(admin, family.ID, "Test group", []string{member.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = p.Pool.Exec(ctx, `DELETE FROM conversations WHERE id=$1`, group.ID) })
	message, err := p.CreateMessage(admin, group.ID, "test message", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = p.Pool.Exec(ctx, `DELETE FROM messages WHERE id=$1`, message.ID) })
	if message.Body != "test message" {
		t.Fatalf("body = %q", message.Body)
	}
	conversations := p.Conversations(admin.ID)
	var listed *chat.Conversation
	for index := range conversations {
		if conversations[index].ID == group.ID {
			listed = &conversations[index]
			break
		}
	}
	if listed == nil || listed.LastMessage != "test message" || listed.LastMessageAt == nil {
		t.Fatalf("conversation preview not populated: %#v", listed)
	}
	messages, err := p.Messages(member, group.ID)
	if err != nil || len(messages) != 1 {
		t.Fatalf("messages = %d, err = %v", len(messages), err)
	}
	assertStatus := func(want string) {
		t.Helper()
		statuses, err := p.ReceiptStatuses(admin, []string{message.ID})
		if err != nil || statuses[message.ID] != want {
			t.Fatalf("status=%v err=%v, want %s", statuses, err, want)
		}
	}
	assertStatus("sent")
	if _, err := p.MessagesPage(member, group.ID, "", 50); err != nil {
		t.Fatal(err)
	}
	assertStatus("sent") // Fetching history must never acknowledge delivery or reading.
	if changed, err := p.RecordReceipts(chat.User{ID: "not-a-member"}, []string{message.ID}, true); err != nil || len(changed) != 0 {
		t.Fatalf("unauthorized receipt: %v %v", changed, err)
	}
	assertStatus("sent")
	if changed, err := p.RecordReceipts(member, []string{message.ID}, false); err != nil || len(changed) != 1 {
		t.Fatalf("delivery: %v %v", changed, err)
	}
	assertStatus("delivered")
	if changed, err := p.RecordReceipts(member, []string{message.ID}, false); err != nil || len(changed) != 0 {
		t.Fatalf("duplicate delivery: %v %v", changed, err)
	}
	newer, err := p.CreateMessage(admin, group.ID, "newer unread message", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = p.Pool.Exec(ctx, "DELETE FROM messages WHERE id=$1", newer.ID) })
	if _, err := p.RecordReceipts(member, []string{message.ID}, true); err != nil {
		t.Fatal(err)
	}
	assertStatus("read")
	statuses, err := p.ReceiptStatuses(admin, []string{newer.ID})
	if err != nil || statuses[newer.ID] != "sent" {
		t.Fatalf("unseen newer message marked: %v %v", statuses, err)
	}
	if changed, err := p.RecordReceipts(member, []string{message.ID}, true); err != nil || len(changed) != 0 {
		t.Fatalf("duplicate read: %v %v", changed, err)
	}
	for _, c := range p.Conversations(member.ID) {
		if c.ID == group.ID && c.UnreadCount != 1 {
			t.Fatalf("unread count: %d", c.UnreadCount)
		}
	}
	third := chat.User{ID: "test_third_repository", Email: "third@example.test", Name: "Third", Permissions: map[chat.Permission]bool{}}
	if err := p.AddUser(admin, third); err != nil {
		t.Fatal(err)
	}
	// Add a second recipient: group status requires all current recipients.
	if _, err := p.Pool.Exec(ctx, "INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)", group.ID, third.ID); err != nil {
		t.Fatal(err)
	}
	assertStatus("sent")
	if _, err := p.RecordReceipts(third, []string{message.ID}, false); err != nil {
		t.Fatal(err)
	}
	assertStatus("delivered")
	if _, err := p.RecordReceipts(third, []string{message.ID}, true); err != nil {
		t.Fatal(err)
	}
	assertStatus("read")
}
