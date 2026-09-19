package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"os"
	"testing"
)

func TestIndependentGroupsMigrationPreservesExistingGroups(t *testing.T) {
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
	tx, e := p.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `CREATE TEMP TABLE users(id text PRIMARY KEY);
 CREATE TEMP TABLE conversations(id text PRIMARY KEY,kind text,family_id text,created_by text,CONSTRAINT conversations_family_scope CHECK(kind='direct' OR family_id IS NOT NULL));
 CREATE TEMP TABLE conversation_members(conversation_id text,user_id text);
 CREATE TEMP TABLE messages(id text,conversation_id text,body text);
 INSERT INTO users VALUES('creator'),('remaining');
 INSERT INTO conversations VALUES('legacy','group','family-a','creator');
 INSERT INTO conversation_members VALUES('legacy','remaining');
 INSERT INTO messages VALUES('history','legacy','Synthetic retained history');`)
	if e != nil {
		t.Fatal(e)
	}
	sql, e := migrationFiles.ReadFile("migrations/030_independent_groups.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, string(sql)); e != nil {
		t.Fatal(e)
	}
	var owner, body string
	var family *string
	var members int
	if e = tx.QueryRow(ctx, `SELECT group_owner_id,family_id FROM conversations WHERE id='legacy'`).Scan(&owner, &family); e != nil {
		t.Fatal(e)
	}
	if owner != "creator" || family != nil {
		t.Fatal("legacy ownership not preserved")
	}
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM conversation_members WHERE user_id='creator'`).Scan(&members); e != nil || members != 0 {
		t.Fatal("migration rejoined departed creator", e)
	}
	if e = tx.QueryRow(ctx, `SELECT body FROM messages WHERE id='history'`).Scan(&body); e != nil || body != "Synthetic retained history" {
		t.Fatal("history changed", e)
	}
}

func TestIndependentGroupRolesAndIsolation(t *testing.T) {
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
	families := []string{}
	defer func() {
		p.Pool.Exec(ctx, `DELETE FROM messages WHERE author_id=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM conversations WHERE created_by=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM families WHERE id=ANY($1::text[])`, families)
		p.Pool.Exec(ctx, `DELETE FROM users WHERE id=ANY($1::text[])`, ids)
	}()
	users := []chat.User{}
	for _, name := range []string{"group-owner", "group-admin", "group-member", "group-outsider", "group-appadmin"} {
		u, err := p.Register(name+"@example.test", name, "Synthetic-password-2026", 12)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, u.ID)
		users = append(users, u)
	}
	a, b, c, d, app := users[0], users[1], users[2], users[3], users[4]
	app.Permissions = map[chat.Permission]bool{chat.ManageApplication: true}
	if _, e = p.Pool.Exec(ctx, `UPDATE users SET permissions=ARRAY['manage_application']::text[] WHERE id=$1`, app.ID); e != nil {
		t.Fatal(e)
	}
	g, e := p.CreateGroup(a, "Independent", []string{b.ID, c.ID})
	if e != nil {
		t.Fatal(e)
	}
	if g.FamilyID != "" || g.GroupRole != "owner" {
		t.Fatal("not independent")
	}
	change := func(actor chat.User, action string, in GroupChange, forbidden bool) {
		t.Helper()
		err := p.ChangeGroup(actor, g.ID, action, in)
		if forbidden {
			if !errors.Is(err, chat.ErrForbidden) {
				t.Fatalf("%s expected forbidden, got %v", action, err)
			}
		} else if err != nil {
			t.Fatalf("%s: %v", action, err)
		}
	}
	change(c, "add", GroupChange{UserID: d.ID}, true)
	change(app, "add", GroupChange{UserID: d.ID}, true)
	change(a, "permissions", GroupChange{UserID: b.ID, Role: "admin"}, false)
	change(b, "permissions", GroupChange{UserID: c.ID, Role: "admin"}, true)
	change(b, "remove", GroupChange{UserID: a.ID}, true)
	change(a, "leave", GroupChange{}, true)
	change(b, "permissions", GroupChange{UserID: c.ID, Role: "member", CanInvite: true}, false)
	change(c, "add", GroupChange{UserID: d.ID}, false)
	change(c, "add", GroupChange{UserID: d.ID}, false)
	change(c, "remove", GroupChange{UserID: d.ID}, true)
	icon := "🎮"
	change(b, "settings", GroupChange{Icon: &icon}, false)
	bad := "<script>"
	if e = p.ChangeGroup(a, g.ID, "settings", GroupChange{Icon: &bad}); !errors.Is(e, chat.ErrInvalid) {
		t.Fatal("invalid icon", e)
	}
	f, e := p.CreateFamily(a, "Synthetic family", "")
	if e != nil {
		t.Fatal(e)
	}
	families = append(families, f.ID)
	for _, u := range []chat.User{b, c, d} {
		if _, e = p.Pool.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'member')`, f.ID, u.ID); e != nil {
			t.Fatal(e)
		}
	}
	find := func() chat.Conversation {
		t.Helper()
		for _, v := range p.Conversations(a.ID) {
			if v.ID == g.ID {
				return v
			}
		}
		t.Fatal("group missing")
		return chat.Conversation{}
	}
	v := find()
	if len(v.FamilyIDs) != 1 || v.FamilyIDs[0] != f.ID || v.Icon != icon {
		t.Fatalf("classification or icon missing: %+v", v)
	}
	if _, e = p.Pool.Exec(ctx, `DELETE FROM family_members WHERE family_id=$1 AND user_id=$2`, f.ID, d.ID); e != nil {
		t.Fatal(e)
	}
	if len(find().FamilyIDs) != 0 || !p.member(g.ID, d.ID) {
		t.Fatal("family removal must only reclassify")
	}
	change(a, "transfer", GroupChange{UserID: b.ID}, false)
	change(a, "transfer", GroupChange{UserID: c.ID}, true)
	change(a, "remove", GroupChange{UserID: b.ID}, true)
	change(a, "leave", GroupChange{}, false)
	if _, e = p.GroupMembers(a, g.ID); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("former member sees group", e)
	}
	change(app, "recover", GroupChange{UserID: c.ID}, true)
	if _, e = p.Pool.Exec(ctx, `UPDATE users SET disabled_at=now() WHERE id=$1`, b.ID); e != nil {
		t.Fatal(e)
	}
	missing, e := p.OwnerlessGroups(app)
	if e != nil || len(missing) != 1 {
		t.Fatal("recovery list", e, len(missing))
	}
	change(app, "recover", GroupChange{UserID: c.ID}, false)
	if p.member(g.ID, app.ID) {
		t.Fatal("recovery granted membership")
	}
	if _, e = p.Messages(app, g.ID); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("application admin can read", e)
	}
	change(c, "archive", GroupChange{}, false)
	if _, e = p.CreateMessage(d, g.ID, "Denied", nil); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("archived write", e)
	}
}
