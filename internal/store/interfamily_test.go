package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"os"
	"testing"
)

func TestInterfamilyApprovalIsolationAndRevocation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	p, e := Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	if e = p.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	ids := []string{}
	fids := []string{}
	defer func() {
		p.Pool.Exec(ctx, `DELETE FROM messages WHERE author_id=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM conversations WHERE created_by=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM families WHERE id=ANY($1::text[])`, fids)
		p.Pool.Exec(ctx, `DELETE FROM users WHERE id=ANY($1::text[])`, ids)
	}()
	users := []chat.User{}
	for _, name := range []string{"bridge-admin-a", "bridge-admin-b", "bridge-rep-a", "bridge-rep-b", "bridge-outsider"} {
		u, err := p.Register(name+"@example.test", name, "Synthetic-password-2026", 12)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, u.ID)
		users = append(users, u)
	}
	a, b, ra, rb, out := users[0], users[1], users[2], users[3], users[4]
	fa, e := p.CreateFamily(a, "Bridge family A", "")
	if e != nil {
		t.Fatal(e)
	}
	fids = append(fids, fa.ID)
	fb, e := p.CreateFamily(b, "Bridge family B", "")
	if e != nil {
		t.Fatal(e)
	}
	fids = append(fids, fb.ID)
	if _, e = p.Pool.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'member'),($3,$4,'member')`, fa.ID, ra.ID, fb.ID, rb.ID); e != nil {
		t.Fatal(e)
	}
	in := InterfamilyInput{FamilyID: fa.ID, Title: "Shared synthetic", Members: []string{ra.ID}, RequestKey: "synthetic-key-000001"}
	if _, e = p.CreateInterfamily(ra, in); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("ordinary member created bridge", e)
	}
	created, e := p.CreateInterfamily(a, in)
	if e != nil {
		t.Fatal(e)
	}
	cid := created["id"]
	again, e := p.CreateInterfamily(a, in)
	if e != nil || again["id"] != cid {
		t.Fatal("duplicate create", e)
	}
	if _, e = p.Messages(ra, cid); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("pending chat accessible", e)
	}
	join := InterfamilyInput{FamilyID: fb.ID, Members: []string{rb.ID}, Token: created["token"]}
	if _, e = p.ChangeInterfamily(out, "", "join", join); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("outsider accepted invitation", e)
	}
	if _, e = p.ChangeInterfamily(b, "", "join", join); e != nil {
		t.Fatal(e)
	}
	if _, e = p.ChangeInterfamily(b, "", "join", join); e != nil {
		t.Fatal("retry join", e)
	}
	if _, e = p.Messages(rb, cid); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("unapproved target reads", e)
	}
	list, e := p.InterfamilyChats(a, fa.ID)
	if e != nil || len(list) != 1 || list[0].State != "requested" {
		t.Fatal("request not listed", e)
	}
	v := list[0].Version
	if _, e = p.ChangeInterfamily(b, cid, "approve", InterfamilyInput{FamilyID: fb.ID, Version: v}); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("self approval", e)
	}
	if _, e = p.ChangeInterfamily(a, cid, "approve", InterfamilyInput{FamilyID: fa.ID, Version: v}); e != nil {
		t.Fatal(e)
	}
	if p.member(cid, a.ID) || p.member(cid, b.ID) {
		t.Fatal("admins automatically enrolled")
	}
	msg, e := p.CreateMessage(ra, cid, "Visible to representatives", nil)
	if e != nil {
		t.Fatal(e)
	}
	messages, e := p.Messages(rb, cid)
	if e != nil || len(messages) != 1 || messages[0].ID != msg.ID {
		t.Fatal("representative cannot read", e)
	}
	for _, c := range p.Conversations(ra.ID) {
		if c.ID == cid && (len(c.FamilyIDs) != 1 || c.FamilyIDs[0] != fa.ID) {
			t.Fatal("wrong navigation scope")
		}
	}
	list, _ = p.InterfamilyChats(a, fa.ID)
	v = list[0].Version
	if _, e = p.ChangeInterfamily(a, cid, "members", InterfamilyInput{FamilyID: fa.ID, Members: []string{rb.ID}, Version: v}); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("foreign member selected", e)
	}
	if _, e = p.ChangeInterfamily(a, cid, "members", InterfamilyInput{FamilyID: fa.ID, Members: []string{ra.ID}, Version: v - 1}); !errors.Is(e, ErrShareConflict) {
		t.Fatal("stale version allowed", e)
	}
	if _, e = p.Pool.Exec(ctx, `DELETE FROM family_members WHERE family_id=$1 AND user_id=$2`, fb.ID, rb.ID); e != nil {
		t.Fatal(e)
	}
	if p.member(cid, rb.ID) {
		t.Fatal("departed representative retained access")
	}
	if _, e = p.Pool.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'member')`, fb.ID, rb.ID); e != nil {
		t.Fatal(e)
	}
	if p.member(cid, rb.ID) {
		t.Fatal("returning family member auto-enrolled")
	}
	list, _ = p.InterfamilyChats(a, fa.ID)
	v = list[0].Version
	if _, e = p.ChangeInterfamily(a, cid, "close", InterfamilyInput{FamilyID: fa.ID, Version: v}); e != nil {
		t.Fatal(e)
	}
	if p.member(cid, ra.ID) {
		t.Fatal("closed chat accessible")
	}
	var count int
	p.Pool.QueryRow(ctx, `SELECT count(*) FROM messages WHERE id=$1`, msg.ID).Scan(&count)
	if count != 1 {
		t.Fatal("close deleted history")
	}
	// Renewed codes cannot join, and family archival closes the pending chat.
	in.RequestKey = "synthetic-key-000002"
	c2, e := p.CreateInterfamily(a, in)
	if e != nil {
		t.Fatal(e)
	}
	renewed, e := p.ChangeInterfamily(a, c2["id"], "renew", InterfamilyInput{FamilyID: fa.ID, Version: 1})
	if e != nil {
		t.Fatal(e)
	}
	join.Token = c2["token"]
	if _, e = p.ChangeInterfamily(b, "", "join", join); !errors.Is(e, chat.ErrNotFound) {
		t.Fatal("old code accepted", e)
	}
	join.Token = renewed["token"]
	if _, e = p.ChangeInterfamily(b, "", "join", join); e != nil {
		t.Fatal(e)
	}
	if _, e = p.Pool.Exec(ctx, `UPDATE families SET archived_at=now() WHERE id=$1`, fb.ID); e != nil {
		t.Fatal(e)
	}
	list, e = p.InterfamilyChats(a, fa.ID)
	if e != nil || len(list) != 0 {
		t.Fatal("archived family chat still available", e)
	}
}
