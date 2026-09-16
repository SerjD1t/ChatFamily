package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"os"
	"testing"
	"time"
)

func TestUserLifecycle(t *testing.T) {
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
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES ('test_life_admin','lifecycle-admin@example.test','Admin','',ARRAY['manage_application']),('test_life_member','lifecycle-member@example.test','Member','',ARRAY[]::text[]),('test_life_empty','lifecycle-empty@example.test','Empty','',ARRAY[]::text[])`)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM users WHERE id LIKE 'test_life_%'`)
	admin := chat.User{ID: "test_life_admin", Permissions: map[chat.Permission]bool{chat.ManageApplication: true}}
	old := time.Now().Add(-time.Minute)
	if !p.SessionAllowed("test_life_member", old) {
		t.Fatal("active session rejected")
	}
	if err = p.ChangeUserLifecycle("test_life_member", "test_life_empty", "delete", "lifecycle-empty@example.test"); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("member authorization", err)
	}
	if err = p.ChangeUserLifecycle(admin.ID, admin.ID, "deactivate", "lifecycle-admin@example.test"); !errors.Is(err, ErrUserProtected) {
		t.Fatal("self protection", err)
	}
	if err = p.ChangeUserLifecycle(admin.ID, "test_life_member", "deactivate", "wrong@example.test"); !errors.Is(err, ErrEmailConfirmation) {
		t.Fatal("email confirmation", err)
	}
	if err = p.ChangeUserLifecycle(admin.ID, "test_life_member", "deactivate", "lifecycle-member@example.test"); err != nil {
		t.Fatal(err)
	}
	if p.SessionAllowed("test_life_member", time.Now()) {
		t.Fatal("disabled session accepted")
	}
	if err = p.ChangeUserLifecycle(admin.ID, "test_life_member", "activate", "lifecycle-member@example.test"); err != nil {
		t.Fatal(err)
	}
	if p.SessionAllowed("test_life_member", old) {
		t.Fatal("old session resurrected")
	}
	if !p.SessionAllowed("test_life_member", time.Now().Add(time.Second)) {
		t.Fatal("new session rejected")
	}
	// A created conversation is retained, including empty conversations.
	_, err = p.Pool.Exec(ctx, `INSERT INTO conversations(id,kind,title,created_by) VALUES('test_life_chat','direct','History','test_life_member')`)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM conversations WHERE id='test_life_chat'`)
	if err = p.ChangeUserLifecycle(admin.ID, "test_life_member", "delete", "lifecycle-member@example.test"); !errors.Is(err, ErrUserHistory) {
		t.Fatal("history protection", err)
	}
	if err = p.ChangeUserLifecycle(admin.ID, "test_life_empty", "delete", "lifecycle-empty@example.test"); err != nil {
		t.Fatal(err)
	}
	if p.SessionAllowed("test_life_empty", time.Now()) {
		t.Fatal("deleted session accepted")
	}
	// Test an isolated last-admin condition without depending on other fixtures.
	var admins int
	p.Pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE disabled_at IS NULL AND permissions @> ARRAY['manage_application']::text[]`).Scan(&admins)
	if admins == 1 {
		if _, err = p.UpdateUserPermissions(admin, admin.ID, nil); !errors.Is(err, chat.ErrForbidden) {
			t.Fatal("last admin demotion", err)
		}
	}
}
