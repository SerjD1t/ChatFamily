package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"os"
	"sync"
	"testing"
)

func TestApplicationFamilyAdministration(t *testing.T) {
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
	admin, owner, user := id(), id(), id()
	for _, uid := range []string{admin, owner, user} {
		if _, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Synthetic User','')`, uid, uid+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	defer p.Pool.Exec(ctx, `DELETE FROM users WHERE id=ANY($1)`, []string{admin, owner, user})
	if _, err = p.Pool.Exec(ctx, `UPDATE users SET permissions=ARRAY['manage_application']::text[] WHERE id=$1`, admin); err != nil {
		t.Fatal(err)
	}
	f, err := p.CreateFamily(chat.User{ID: owner}, "Synthetic Family "+id(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM families WHERE id=$1`, f.ID)
	defer p.Pool.Exec(ctx, `DELETE FROM conversations WHERE family_id=$1`, f.ID)
	var cid string
	if err = p.Pool.QueryRow(ctx, `SELECT id FROM conversations WHERE family_id=$1 AND kind='family'`, f.ID).Scan(&cid); err != nil {
		t.Fatal(err)
	}
	if _, _, err = p.ApplicationFamilies(owner, "", 0); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("family owner got global access", err)
	}
	rows, total, err := p.ApplicationFamilies(admin, f.Title, 0)
	if err != nil || total != 1 || len(rows) != 1 || rows[0].Members != 1 {
		t.Fatal("family listing", err)
	}
	if _, err = p.Messages(chat.User{ID: admin}, cid); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("global role granted messages", err)
	}
	in := FamilyAdminChange{Role: chat.FamilyAdmin, Relationship: "Parent", Categories: []chat.FamilyCategory{chat.FamilyParent}}
	if err = p.ChangeApplicationFamily(owner, f.ID, user, "add", in); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("unauthorized mutation", err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, user, "add", in); err != nil {
		t.Fatal(err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, user, "add", FamilyAdminChange{Role: chat.FamilyOwner}); err != nil {
		t.Fatal(err)
	}
	members, n, err := p.ApplicationFamilyUsers(admin, f.ID, "", 0, false)
	if err != nil || n != 2 {
		t.Fatal("members", err)
	}
	for _, u := range members {
		if u.ID == user && u.Role != chat.FamilyAdmin {
			t.Fatal("repeated add changed role")
		}
	}
	if _, err = p.Messages(chat.User{ID: user}, cid); err != nil {
		t.Fatal("new member lacks family chat", err)
	}
	group, direct := id(), id()
	if _, err = p.Pool.Exec(ctx, `INSERT INTO conversations(id,kind,family_id) VALUES($1,'group',$2),($3,'direct',NULL)`, group, f.ID, direct); err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM conversations WHERE id=$1`, direct)
	if _, err = p.Pool.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$3),($2,$3)`, group, direct, user); err != nil {
		t.Fatal(err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, user, "update", FamilyAdminChange{Role: chat.FamilyMember, Categories: []chat.FamilyCategory{"invalid"}}); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("invalid category", err)
	}
	if err = p.UpdateFamilyMember(chat.User{ID: user}, f.ID, owner, chat.FamilyMember, "", nil); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("family admin changed owner", err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, owner, "remove", FamilyAdminChange{}); !errors.Is(err, ErrLastFamilyOwner) {
		t.Fatal("last owner removed", err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, user, "update", FamilyAdminChange{Role: chat.FamilyOwner}); err != nil {
		t.Fatal(err)
	}
	// Old family UI and global administration must share the same last-owner lock.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		results <- p.UpdateFamilyMember(chat.User{ID: owner}, f.ID, owner, chat.FamilyMember, "", nil)
	}()
	go func() {
		defer wg.Done()
		results <- p.ChangeApplicationFamily(admin, f.ID, user, "update", FamilyAdminChange{Role: chat.FamilyMember})
	}()
	wg.Wait()
	close(results)
	ok, blocked := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrLastFamilyOwner) {
			blocked++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 1 || blocked != 1 {
		t.Fatal("concurrent changes removed last owner")
	}
	// Ensure the original owner is available before removing the test member.
	if err = p.ChangeApplicationFamily(admin, f.ID, owner, "update", FamilyAdminChange{Role: chat.FamilyOwner}); err != nil {
		t.Fatal(err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, user, "remove", FamilyAdminChange{}); err != nil {
		t.Fatal(err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, user, "remove", FamilyAdminChange{}); err != nil {
		t.Fatal("remove retry", err)
	}
	if _, err = p.Messages(chat.User{ID: user}, cid); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("removed member still reads", err)
	}
	if _, err = p.Messages(chat.User{ID: user}, group); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("removed member reads group", err)
	}
	if _, err = p.Messages(chat.User{ID: user}, direct); err != nil {
		t.Fatal("personal dialog affected", err)
	}
	var count int
	p.Pool.QueryRow(ctx, `SELECT count(*) FROM family_member_categories WHERE family_id=$1 AND user_id=$2`, f.ID, user).Scan(&count)
	if count != 0 {
		t.Fatal("orphan categories")
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, "", "rename", FamilyAdminChange{Title: "Renamed"}); err != nil {
		t.Fatal(err)
	}
	var title string
	p.Pool.QueryRow(ctx, `SELECT title FROM conversations WHERE id=$1`, cid).Scan(&title)
	if title != "Renamed" {
		t.Fatal("family chat title not synchronized")
	}
	if _, err = p.Messages(chat.User{ID: admin}, cid); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("management joined administrator", err)
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE users SET permissions='{}' WHERE id=$1`, admin); err != nil {
		t.Fatal(err)
	}
	if err = p.ChangeApplicationFamily(admin, f.ID, owner, "remove", FamilyAdminChange{}); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("revoked permission accepted", err)
	}
}
