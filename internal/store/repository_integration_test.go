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
	group, err := p.CreateGroup(admin, "Test group", []string{member.ID})
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
	messages, err := p.Messages(member, group.ID)
	if err != nil || len(messages) != 1 {
		t.Fatalf("messages = %d, err = %v", len(messages), err)
	}
}
