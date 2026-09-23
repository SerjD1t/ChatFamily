package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"os"
	"sync"
	"testing"
)

func TestWidgetPinsIsolationAndConcurrency(t *testing.T) {
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
	cleanup := func() {
		_, e := p.Pool.Exec(ctx, `DELETE FROM shopping_items WHERE created_by IN ('pin_a','pin_b','pin_admin');DELETE FROM families WHERE id IN ('pin_family','pin_other');DELETE FROM users WHERE id IN ('pin_a','pin_b','pin_admin')`)
		if e != nil {
			t.Error(e)
		}
	}
	cleanup()
	defer cleanup()
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES
 ('pin_a','pin-a@example.test','A','',ARRAY[]::text[]),('pin_b','pin-b@example.test','B','',ARRAY[]::text[]),('pin_admin','pin-admin@example.test','Admin','',ARRAY['manage_application']);
 INSERT INTO families(id,title) VALUES('pin_family','Test family'),('pin_other','Other family');
 INSERT INTO family_members(family_id,user_id,role) VALUES('pin_family','pin_a','member'),('pin_family','pin_b','member'),('pin_other','pin_b','owner')`)
	if err != nil {
		t.Fatal(err)
	}
	a, b, admin := chat.User{ID: "pin_a"}, chat.User{ID: "pin_b"}, chat.User{ID: "pin_admin"}
	create := func(actor chat.User, family, kind string) chat.ShoppingItem {
		title := "Synthetic purchase"
		n, e := p.SaveNeed(actor, family, "", NeedInput{Title: &title, Kind: &kind})
		if e != nil {
			t.Fatal(e)
		}
		return n
	}
	purchase := create(a, "pin_family", "purchase")
	personal := create(a, "", "purchase")
	foreign := create(b, "pin_other", "purchase")
	task := create(a, "pin_family", "task")
	if !errors.Is(p.SetWidgetPin(admin, "pin_family", purchase.ID, true), chat.ErrForbidden) {
		t.Fatal("admin bypassed membership")
	}
	for _, n := range []chat.ShoppingItem{personal, foreign, task} {
		if p.SetWidgetPin(a, "pin_family", n.ID, true) == nil {
			t.Fatal("ineligible item pinned")
		}
	}
	for i := 0; i < 2; i++ {
		if err = p.SetWidgetPin(b, "pin_family", purchase.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	pins, err := p.WidgetPinIDs(a.ID, "pin_family")
	if err != nil || len(pins) != 0 {
		t.Fatal("pins leaked to another member")
	}
	pins, err = p.WidgetPinIDs(b.ID, "pin_family")
	if err != nil || len(pins) != 1 {
		t.Fatal("idempotency failed")
	}
	detail, err := p.NeedDetails(b, "pin_family", purchase.ID)
	if err != nil || detail == nil {
		t.Fatal("details failed", err)
	}
	items := []chat.ShoppingItem{purchase, create(a, "pin_family", "purchase"), create(a, "pin_family", "purchase"), create(a, "pin_family", "purchase")}
	var wg sync.WaitGroup
	results := make(chan error, 4)
	for _, n := range items {
		wg.Add(1)
		go func(id string) { defer wg.Done(); results <- p.SetWidgetPin(a, "pin_family", id, true) }(n.ID)
	}
	wg.Wait()
	close(results)
	ok, limited := 0, 0
	for e := range results {
		if e == nil {
			ok++
		} else if errors.Is(e, ErrWidgetPinLimit) {
			limited++
		} else {
			t.Fatal(e)
		}
	}
	if ok != 3 || limited != 1 {
		t.Fatalf("concurrent pin limit: %d/%d", ok, limited)
	}
	// Moving to personal removes everybody's pins, and returning does not restore them.
	empty := ""
	moved, err := p.SaveNeed(a, "pin_family", purchase.ID, NeedInput{TargetFamilyID: &empty, Version: &purchase.Version})
	if err != nil {
		t.Fatal(err)
	}
	pins, err = p.WidgetPinIDs(b.ID, "pin_family")
	if err != nil || len(pins) != 0 {
		t.Fatal("moved item retained")
	}
	family := "pin_family"
	_, err = p.SaveNeed(a, "", purchase.ID, NeedInput{TargetFamilyID: &family, Version: &moved.Version})
	if err != nil {
		t.Fatal(err)
	}
	pins, err = p.WidgetPinIDs(b.ID, family)
	if err != nil || len(pins) != 0 {
		t.Fatal("old pin returned after move")
	}
	if err = p.SetWidgetPin(b, family, purchase.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = p.Pool.Exec(ctx, `DELETE FROM family_members WHERE user_id='pin_b' AND family_id='pin_family'`); err != nil {
		t.Fatal(err)
	}
	pins, err = p.WidgetPinIDs(b.ID, family)
	if err != nil || len(pins) != 0 {
		t.Fatal("removed member retained pins")
	}
	if p.SetWidgetPin(b, family, purchase.ID, true) == nil {
		t.Fatal("removed member can pin")
	}
}
