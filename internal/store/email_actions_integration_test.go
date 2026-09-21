package store

import (
	"context"
	"crypto/sha256"
	"familychat/internal/chat"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestEmailActionsAtomicRegistrationAndReset(t *testing.T) {
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
	const email = "email-action-synthetic@example.test"
	const password = "Synthetic-strong-password-1"
	const newPassword = "Synthetic-strong-password-2"
	defer p.Pool.Exec(ctx, `DELETE FROM users WHERE email=$1`, email)
	defer p.Pool.Exec(ctx, `DELETE FROM email_actions WHERE email=$1`, email)
	token, err := p.IssueEmailAction(ctx, email, "register", "Synthetic", "Person", "")
	if err != nil || token == "" {
		t.Fatalf("issue: %v", err)
	}
	if _, ok := p.Authenticate(email, password); ok {
		t.Fatal("unconfirmed registration created an account")
	}
	if again, err := p.IssueEmailAction(ctx, email, "register", "Synthetic", "Person", ""); err != nil || again != "" {
		t.Fatal("cooldown failed")
	}
	if _, err = p.ConsumeEmailAction(ctx, "reset", token, password, 12); err == nil {
		t.Fatal("wrong purpose allowed")
	}
	if _, err = p.ConsumeEmailAction(ctx, "register", token, password, 12); err != nil {
		t.Fatal(err)
	}
	if _, err = p.ConsumeEmailAction(ctx, "register", token, password, 12); err == nil {
		t.Fatal("token reused")
	}
	user, ok := p.Authenticate(email, password)
	if !ok {
		t.Fatal("confirmed registration cannot login")
	}
	if token, err = p.IssueEmailAction(ctx, email, "register", "Other", "", ""); err != nil || token != "" {
		t.Fatal("duplicate registration eligible")
	}
	old := time.Now().Add(-time.Second)
	if !p.SessionAllowed(user.ID, old) {
		t.Fatal("initial session unexpectedly blocked")
	}
	token, err = p.IssueEmailAction(ctx, email, "reset", "", "", "")
	if err != nil || token == "" {
		t.Fatal("reset not issued")
	}
	// Concurrent submissions must produce exactly one committed reset.
	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.ConsumeEmailAction(ctx, "reset", token, newPassword, 12); err == nil {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatal("reset not one-time")
	}
	if p.SessionAllowed(user.ID, old) {
		t.Fatal("old session survived reset")
	}
	if !p.SessionAllowed(user.ID, time.Now()) {
		t.Fatal("new session blocked")
	}
	if _, ok = p.Authenticate(email, password); ok {
		t.Fatal("old password works")
	}
	if _, ok = p.Authenticate(email, newPassword); !ok {
		t.Fatal("new password rejected")
	}
	token, err = p.IssueEmailAction(ctx, email, "reset", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(token))
	if _, err = p.Pool.Exec(ctx, `UPDATE email_actions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`, hash[:]); err != nil {
		t.Fatal(err)
	}
	if _, err = p.ConsumeEmailAction(ctx, "reset", token, password, 12); err == nil {
		t.Fatal("expired token accepted")
	}
	token, err = p.IssueEmailAction(ctx, email, "reset", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = p.SetPassword(user.ID, password, 12); err != nil {
		t.Fatal(err)
	}
	if _, err = p.ConsumeEmailAction(ctx, "reset", token, newPassword, 12); err == nil {
		t.Fatal("token survived intervening password change")
	}
}

func TestEmailInvitationConfirmationAndRollback(t *testing.T) {
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
	const password = "Synthetic-password-mail-2026"
	const address = "mail-invited-synthetic@example.test"
	owner, err := p.Register("mail-owner-synthetic@example.test", "Synthetic owner", password, 12)
	if err != nil {
		t.Fatal(err)
	}
	family, err := p.CreateFamily(owner, "Synthetic email family", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		p.Pool.Exec(ctx, `DELETE FROM email_actions WHERE email=$1`, address)
		p.Pool.Exec(ctx, `DELETE FROM conversations WHERE family_id=$1`, family.ID)
		p.Pool.Exec(ctx, `DELETE FROM families WHERE id=$1`, family.ID)
		p.Pool.Exec(ctx, `DELETE FROM users WHERE id=$1 OR email=$2`, owner.ID, address)
	}()
	invite, err := p.CreateInvitation(owner, family.ID, address, nil, chat.FamilyMember, "Synthetic", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	token, err := p.IssueEmailAction(ctx, address, "register", "Synthetic", "Invited", invite)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.ConsumeEmailAction(ctx, "register", token, password, 12); err != nil {
		t.Fatal(err)
	}
	user, ok := p.Authenticate(address, password)
	if !ok {
		t.Fatal("confirmed invite cannot login")
	}
	var role string
	if err = p.Pool.QueryRow(ctx, `SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2`, family.ID, user.ID).Scan(&role); err != nil || role != "member" {
		t.Fatal("invitation membership not applied")
	}
	token, err = p.IssueEmailAction(ctx, address, "reset", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE users SET disabled_at=now() WHERE id=$1`, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = p.ConsumeEmailAction(ctx, "reset", token, password, 12); err == nil {
		t.Fatal("reset reactivated disabled account")
	}
}
