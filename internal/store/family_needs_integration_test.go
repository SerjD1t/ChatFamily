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
	personal, err := p.SaveNeed(author, "", "", NeedInput{Title: needPtr("Private"), Kind: needPtr("task")})
	if err != nil || personal.OwnerUserID == nil || *personal.OwnerUserID != author.ID || personal.FamilyID != "" {
		t.Fatal("personal creation", err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM shopping_items WHERE id=$1`, personal.ID)
	appAdmin := chat.User{ID: outsider.ID, Permissions: map[chat.Permission]bool{chat.ManageApplication: true}}
	for _, other := range []chat.User{member, admin, outsider, appAdmin} {
		if _, err = p.NeedDetails(other, "", personal.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Fatal("private details leaked", err)
		}
		if _, err = p.SaveNeed(other, "", personal.ID, NeedInput{Completed: needPtr(true)}); !errors.Is(err, chat.ErrNotFound) {
			t.Fatal("private mutation allowed", err)
		}
		if err = p.CommentNeed(other, "", personal.ID, "forbidden"); !errors.Is(err, chat.ErrNotFound) {
			t.Fatal("private comment allowed", err)
		}
		privateList, e := p.ListNeeds(other, "", false)
		if e != nil || len(privateList) != 0 {
			t.Fatal("private list leaked", e)
		}
	}
	if _, err = p.NeedDetails(author, family, personal.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal("personal accessible through family", err)
	}
	if _, err = p.NeedDetails(author, "", n.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal("family accessible through personal", err)
	}
	if _, err = p.SaveNeed(author, "", personal.ID, NeedInput{AssigneeID: &member.ID}); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("personal assignment", err)
	}
	if err = p.CommentNeed(author, "", personal.ID, "private comment"); err != nil {
		t.Fatal(err)
	}
	personal, err = p.SaveNeed(author, "", personal.ID, NeedInput{Completed: needPtr(true), Version: &personal.Version})
	if err != nil || personal.CompletedAt == nil {
		t.Fatal("personal completion", err)
	}
	if _, err = p.SaveNeed(author, "", personal.ID, NeedInput{Archived: needPtr(true)}); err != nil {
		t.Fatal(err)
	}
	privateArchive, err := p.ListNeeds(author, "", true)
	if err != nil || len(privateArchive) != 1 {
		t.Fatal("private archive", err)
	}
	if _, err = p.SaveNeed(author, "", personal.ID, NeedInput{Archived: needPtr(false)}); err != nil {
		t.Fatal(err)
	}
	if _, err = p.NeedDetails(author, "", personal.ID); err != nil {
		t.Fatal("private history", err)
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE shopping_items SET family_id=$1 WHERE id=$2`, family, personal.ID); err == nil {
		t.Fatal("dual ownership accepted")
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE shopping_items SET owner_user_id=NULL WHERE id=$1`, personal.ID); err == nil {
		t.Fatal("missing ownership accepted")
	}
	moving, err := p.SaveNeed(author, "", "", NeedInput{Title: needPtr("Move me"), PlannedDate: needPtr("2026-10-02"), Completed: needPtr(true)})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM shopping_items WHERE id=$1`, moving.ID)
	if err = p.CommentNeed(author, "", moving.ID, "Keep history"); err != nil {
		t.Fatal(err)
	}
	oldVersion := moving.Version
	if _, err = p.SaveNeed(author, "", moving.ID, NeedInput{TargetFamilyID: needPtr(family)}); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("move needs version", err)
	}
	if _, err = p.SaveNeed(author, "", moving.ID, NeedInput{TargetFamilyID: needPtr("test_need_outside"), Version: &moving.Version}); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("foreign target", err)
	}
	moving, err = p.SaveNeed(author, "", moving.ID, NeedInput{TargetFamilyID: needPtr(family), Version: &moving.Version})
	if err != nil || moving.FamilyID != family || moving.OwnerUserID != nil || moving.CompletedAt == nil || moving.PlannedDate == nil || moving.CommentCount != 1 {
		t.Fatal("move to family preserves fields", err)
	}
	if _, err = p.NeedDetails(member, family, moving.ID); err != nil {
		t.Fatal("family cannot read moved item", err)
	}
	if _, err = p.SaveNeed(author, "", moving.ID, NeedInput{TargetFamilyID: needPtr(family), Version: &oldVersion}); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal("repeat old scope", err)
	}
	for _, other := range []chat.User{member, admin} {
		if _, err = p.SaveNeed(other, family, moving.ID, NeedInput{TargetFamilyID: needPtr(""), Version: &moving.Version}); !errors.Is(err, chat.ErrForbidden) {
			t.Fatal("non-author took item", err)
		}
	}
	moving, err = p.SaveNeed(author, family, moving.ID, NeedInput{AssigneeID: &member.ID, Version: &moving.Version})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.SaveNeed(author, family, moving.ID, NeedInput{TargetFamilyID: needPtr(""), Version: &oldVersion}); !errors.Is(err, ErrNeedConflict) {
		t.Fatal("stale transfer", err)
	}
	moving, err = p.SaveNeed(author, family, moving.ID, NeedInput{TargetFamilyID: needPtr(""), Version: &moving.Version})
	if err != nil || moving.OwnerUserID == nil || *moving.OwnerUserID != author.ID || moving.FamilyID != "" || moving.AssigneeID != nil || moving.CompletedAt == nil || moving.CommentCount != 1 {
		t.Fatal("move private", err)
	}
	if _, err = p.NeedDetails(member, family, moving.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal("old family access", err)
	}
	if err = p.CommentNeed(member, family, moving.ID, "forbidden"); !errors.Is(err, chat.ErrNotFound) {
		t.Fatal("old family comment", err)
	}
	if _, err = p.NeedDetails(author, "", moving.ID); err != nil {
		t.Fatal("private details after transfer", err)
	}
	t.Run("purchase checklist permissions history and conflicts", func(t *testing.T) {
		purchase, e := p.SaveNeed(author, family, "", NeedInput{Title: needPtr("Bread, milk 1,5 l")})
		if e != nil {
			t.Fatal(e)
		}
		entries := []chat.ChecklistItem{{Text: "Bread"}, {Text: "Milk 1,5 l"}}
		if _, e = p.SaveNeed(member, family, purchase.ID, NeedInput{Checklist: &entries, Version: &purchase.Version}); !errors.Is(e, chat.ErrForbidden) {
			t.Fatal("member replacement", e)
		}
		purchase, e = p.SaveNeed(author, family, purchase.ID, NeedInput{Checklist: &entries, ChecklistSource: needPtr("client source"), Version: &purchase.Version})
		if e != nil {
			t.Fatal(e)
		}
		var original string
		if e = p.Pool.QueryRow(ctx, `SELECT body FROM family_need_activity WHERE item_id=$1 AND action='checklist_created'`, purchase.ID).Scan(&original); e != nil || original != "Bread, milk 1,5 l" {
			t.Fatal("original history", e)
		}
		old := purchase.Version
		check := chat.ChecklistItem{ID: purchase.Checklist[0].ID, Completed: true}
		if _, e = p.SaveNeed(outsider, family, purchase.ID, NeedInput{CheckItem: &check, Version: &old}); !errors.Is(e, chat.ErrForbidden) {
			t.Fatal("outsider check", e)
		}
		purchase, e = p.SaveNeed(member, family, purchase.ID, NeedInput{CheckItem: &check, Version: &old})
		if e != nil || !purchase.Checklist[0].Completed || purchase.CompletedAt != nil {
			t.Fatal("member check", e)
		}
		var previous bool
		if e = p.Pool.QueryRow(ctx, `SELECT (before_state->'checklist'->0->>'completed')::boolean FROM family_need_activity WHERE item_id=$1 AND action='checklist_checked'`, purchase.ID).Scan(&previous); e != nil || previous {
			t.Fatal("immutable before", e)
		}
		if _, e = p.SaveNeed(member, family, purchase.ID, NeedInput{CheckItem: &check, Version: &old}); !errors.Is(e, ErrNeedConflict) {
			t.Fatal("stale check", e)
		}
		v := purchase.Version
		purchase, e = p.SaveNeed(member, family, purchase.ID, NeedInput{CheckItem: &check, Version: &v})
		if e != nil || purchase.Version != v {
			t.Fatal("idempotent explicit state", e)
		}
	})
	if _, err = p.Pool.Exec(ctx, `DELETE FROM family_members WHERE user_id=$1`, author.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = p.NeedDetails(author, "", personal.ID); err != nil {
		t.Fatal("personal requires family", err)
	}
}
