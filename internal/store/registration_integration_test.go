package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"github.com/SherClockHolmes/webpush-go"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRegistrationMessagingWithoutFamily(t *testing.T) {
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
	const password = "Synthetic-test-password-2026"
	a, err := p.Register("register-a@example.test", "Synthetic A", password, 12)
	if err != nil {
		t.Fatal(err)
	}
	ids = append(ids, a.ID)
	b, err := p.Register("register-b@example.test", "Synthetic B", password, 12)
	if err != nil {
		t.Fatal(err)
	}
	ids = append(ids, b.ID)
	prefs, err := p.UserPreferences(a.ID)
	if err != nil || prefs.SendShortcut != "ctrl_enter" {
		t.Fatal("bad default shortcut", err)
	}
	prefs.SendShortcut = "enter"
	if _, err = p.SetUserPreferences(a.ID, prefs); err != nil {
		t.Fatal(err)
	}
	prefs.SendShortcut = ""
	if prefs, err = p.SetUserPreferences(a.ID, prefs); err != nil || prefs.SendShortcut != "enter" {
		t.Fatal("old client reset shortcut", err)
	}
	if prefs, err = p.UserPreferences(b.ID); err != nil || prefs.SendShortcut != "ctrl_enter" {
		t.Fatal("shortcut leaked to another user", err)
	}
	prefs.SendShortcut = "invalid"
	if _, err = p.SetUserPreferences(b.ID, prefs); !errors.Is(err, chat.ErrInvalid) {
		t.Fatal("invalid shortcut accepted", err)
	}
	if len(a.Permissions) != 0 {
		t.Fatal("incorrect registration permissions")
	}
	loaded, ok := p.Authenticate(a.Email, password)
	if !ok || len(loaded.Permissions) != 0 {
		t.Fatal("permissions not persisted")
	}
	var count int
	if err = p.Pool.QueryRow(ctx, `SELECT count(*) FROM family_members WHERE user_id=ANY($1::text[])`, ids).Scan(&count); err != nil || count != 0 {
		t.Fatal("unexpected family membership", err)
	}
	for _, peer := range []string{b.ID, a.ID} {
		c, e := p.DirectConversation(loaded, peer)
		if e != nil {
			t.Fatal(e)
		}
		if peer == b.ID {
			// Two devices per account: excluding the reacting account must exclude both.
			for i, user := range []chat.User{a, b} {
				for j := 0; j < 2; j++ {
					s := webpush.Subscription{Endpoint: "https://push.example.test/" + user.ID + string(rune('a'+j))}
					s.Keys.P256dh, s.Keys.Auth = "synthetic", "synthetic"
					if e = p.SavePushSubscription(user, s); e != nil {
						t.Fatal(e)
					}
					installation := "00000000-0000-0000-0000-00000000000" + string(rune('0'+i*2+j))
					if e = p.SaveMobileDevice(ctx, user.ID, installation, "synthetic-token-for-test-"+installation); e != nil {
						t.Fatal(e)
					}
				}
			}
			subs, e := p.PushSubscriptions(c.ID, a.ID)
			if e != nil || len(subs) != 2 {
				t.Fatal("wrong web push recipients", e)
			}
			for _, s := range subs {
				if !strings.Contains(s.Endpoint, b.ID) {
					t.Fatal("self web push")
				}
			}
			devices, e := p.MobileDevices(ctx, c.ID, a.ID)
			if e != nil || len(devices) != 2 {
				t.Fatal("wrong mobile recipients", e)
			}
			for _, d := range devices {
				if d.UserID != b.ID {
					t.Fatal("self mobile push")
				}
			}
		}
		m, e := p.CreateMessage(loaded, c.ID, "Synthetic message", nil)
		if e != nil {
			t.Fatal("new user cannot send", e)
		}
		if _, e = p.EditMessage(loaded, m.ID, "Edited"); e != nil {
			t.Fatal("basic edit denied", e)
		}
		if _, e = p.DeleteMessage(loaded, m.ID); e != nil {
			t.Fatal("basic delete denied", e)
		}
		m, e = p.CreateMessage(loaded, c.ID, "Membership check", nil)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = p.Pool.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, c.ID, loaded.ID); e != nil {
			t.Fatal(e)
		}
		if _, e = p.EditMessage(loaded, m.ID, "Blocked"); !errors.Is(e, chat.ErrForbidden) {
			t.Fatal("edit after exclusion allowed", e)
		}
		if _, e = p.DeleteMessage(loaded, m.ID); !errors.Is(e, chat.ErrForbidden) {
			t.Fatal("delete after exclusion allowed", e)
		}
		if _, e = p.CreateMessage(loaded, c.ID, "Blocked", nil); !errors.Is(e, chat.ErrForbidden) {
			t.Fatal("send after exclusion allowed", e)
		}
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE users SET permissions='{}' WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	loaded, ok = p.User(a.ID)
	if !ok || loaded.Permissions[chat.SendMessages] {
		t.Fatal("revoked right restored")
	}
	f, err := p.CreateFamily(a, "Synthetic family", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		p.Pool.Exec(ctx, `DELETE FROM invitations WHERE family_id=$1`, f.ID)
		p.Pool.Exec(ctx, `DELETE FROM conversations WHERE family_id=$1`, f.ID)
		p.Pool.Exec(ctx, `DELETE FROM family_members WHERE family_id=$1`, f.ID)
		p.Pool.Exec(ctx, `DELETE FROM families WHERE id=$1`, f.ID)
	}()
	if f.Role != chat.FamilyOwner {
		t.Fatal("creator must own family")
	}
	if _, err = p.Pool.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'admin')`, f.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(time.Hour)
	if _, err = p.CreateInvitation(a, f.ID, "invite@example.test", []chat.Permission{chat.ManageApplication}, chat.FamilyMember, "", until); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("platform privilege invitation accepted", err)
	}
	if _, err = p.CreateInvitation(b, f.ID, "invite@example.test", nil, chat.FamilyAdmin, "", until); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("family admin promoted another admin", err)
	}
	if _, err = p.CreateInvitation(b, f.ID, "member@example.test", nil, chat.FamilyMember, "", until); err != nil {
		t.Fatal("member invitation denied", err)
	}
	token, err := p.CreateInvitation(a, f.ID, "invite@example.test", nil, chat.FamilyAdmin, "", until)
	if err != nil {
		t.Fatal("owner admin invitation denied", err)
	}
	// Simulate an old invitation issued before server-side permission filtering.
	if _, err = p.Pool.Exec(ctx, `UPDATE invitations SET permissions=ARRAY['manage_application']::text[] WHERE family_id=$1`, f.ID); err != nil {
		t.Fatal(err)
	}
	invited, err := p.AcceptInvitation(token, "Synthetic invited", password, 12)
	if err != nil {
		t.Fatal(err)
	}
	ids = append(ids, invited.ID)
	if len(invited.Permissions) != 0 {
		t.Fatal("old invitation granted platform rights")
	}
}
