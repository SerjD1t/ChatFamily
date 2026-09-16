package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"os"
	"testing"
)

func needPtr[T any](v T) *T { return &v }
func TestFamilyNeeds(t *testing.T) {
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
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash) VALUES
 ('test_need_author','need-a@example.test','Author',''),('test_need_member','need-m@example.test','Member',''),('test_need_admin','need-d@example.test','Admin',''),('test_need_other','need-o@example.test','Other','');
 INSERT INTO families(id,title) VALUES('test_need_family','Test'),('test_need_outside','Outside');
 INSERT INTO family_members(family_id,user_id,role) VALUES('test_need_family','test_need_author','member'),('test_need_family','test_need_member','member'),('test_need_family','test_need_admin','admin'),('test_need_outside','test_need_other','owner');`)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM families WHERE id IN ('test_need_family','test_need_outside');DELETE FROM users WHERE id LIKE 'test_need_%'`)
	author, member, admin, outsider := chat.User{ID: "test_need_author"}, chat.User{ID: "test_need_member"}, chat.User{ID: "test_need_admin"}, chat.User{ID: "test_need_other"}
	const family = "test_need_family"
	n, err := p.SaveNeed(author, family, "", NeedInput{Title: needPtr("Test task"), Kind: needPtr("task")})
	if err != nil || n.Kind != "task" || n.PlannedDate != nil {
		t.Fatal("create optional date", err)
	}
	if _, err = p.SaveNeed(outsider, family, n.ID, NeedInput{Completed: needPtr(true)}); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("outsider write", err)
	}
	if _, err = p.NeedDetails(outsider, family, n.ID); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("outsider read", err)
	}
	if _, err = p.SaveNeed(member, family, n.ID, NeedInput{Title: needPtr("not allowed")}); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("member edit", err)
	}
	if _, err = p.SaveNeed(author, family, n.ID, NeedInput{AssigneeID: &outsider.ID}); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("foreign assignment", err)
	}
	originalVersion := n.Version
	n, err = p.SaveNeed(admin, family, n.ID, NeedInput{PlannedDate: needPtr("2026-10-01"), AssigneeID: &member.ID, Description: needPtr("details"), Version: &n.Version})
	if err != nil || n.AssigneeName != "Member" {
		t.Fatal("admin edit", err)
	}
	if _, err = p.SaveNeed(author, family, n.ID, NeedInput{Title: needPtr("stale"), Version: &originalVersion}); !errors.Is(err, ErrNeedConflict) {
		t.Fatal("conflict", err)
	}
	if err = p.CommentNeed(member, family, n.ID, "comment"); err != nil {
		t.Fatal(err)
	}
	n, err = p.ToggleShoppingItem(member, family, n.ID, true)
	if err != nil || n.CompletedAt == nil || n.PlannedDate.Format("2006-01-02") != "2026-10-01" {
		t.Fatal("complete preserves planned date", err)
	}
	completed := *n.CompletedAt
	n, err = p.ToggleShoppingItem(member, family, n.ID, true)
	if err != nil || !n.CompletedAt.Equal(completed) {
		t.Fatal("idempotent completion", err)
	}
	n, err = p.ToggleShoppingItem(member, family, n.ID, false)
	if err != nil || n.CompletedAt != nil {
		t.Fatal("reopen", err)
	}
	if err = p.DeleteShoppingItem(member, family, n.ID); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("member archive", err)
	}
	if err = p.DeleteShoppingItem(author, family, n.ID); err != nil {
		t.Fatal(err)
	}
	visible, err := p.ShoppingItems(member, family)
	if err != nil || len(visible) != 0 {
		t.Fatal("archive excluded", err)
	}
	archived, err := p.ListNeeds(member, family, true)
	if err != nil || len(archived) != 1 || archived[0].CommentCount != 1 {
		t.Fatal("archive retained", err)
	}
	if err = p.CommentNeed(member, family, n.ID, "archived"); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("archive read only", err)
	}
	if _, err = p.SaveNeed(admin, family, n.ID, NeedInput{Archived: needPtr(false)}); err != nil {
		t.Fatal("restore", err)
	}
	if _, err = p.SaveNeed(author, family, n.ID, NeedInput{PlannedDate: needPtr("")}); err != nil {
		t.Fatal("clear date", err)
	}
	if _, err = p.SaveNeed(author, family, n.ID, NeedInput{PlannedDate: needPtr("bad")}); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("invalid date", err)
	}
	var history, comments int
	err = p.Pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE action!='comment'),count(*) FILTER(WHERE action='comment') FROM family_need_activity WHERE item_id=$1`, n.ID).Scan(&history, &comments)
	if err != nil || history != 7 || comments != 1 {
		t.Fatalf("history=%d comments=%d err=%v", history, comments, err)
	}
	if _, err = p.NeedDetails(member, family, n.ID); err != nil {
		t.Fatal("details JSON", err)
	}
}
