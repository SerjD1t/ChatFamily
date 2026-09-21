package main

import (
	"context"
	"encoding/json"
	"familychat/internal/chat"
	"familychat/internal/store"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestWidgetFamilyIsolationIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	p, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES
 ('widget_member','widget-member@example.test','Member','',ARRAY[]::text[]),
 ('widget_admin','widget-admin@example.test','Admin','',ARRAY['manage_application']);
 INSERT INTO families(id,title) VALUES('widget_family','Widget family');
 INSERT INTO family_members(family_id,user_id,role) VALUES('widget_family','widget_member','member');`)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM families WHERE id='widget_family';DELETE FROM users WHERE id IN ('widget_member','widget_admin')`)
	title, kind, description := "Family purchase", "purchase", "private description not for widget"
	if _, err = p.SaveNeed(chat.User{ID: "widget_member"}, "widget_family", "", store.NeedInput{Title: &title, Kind: &kind, Description: &description}); err != nil {
		t.Fatal(err)
	}
	title = "Personal secret"
	if _, err = p.SaveNeed(chat.User{ID: "widget_member"}, "", "", store.NeedInput{Title: &title, Kind: &kind}); err != nil {
		t.Fatal(err)
	}
	a := testApp()
	a.db = p
	a.chat = p
	call := func(actor, query, expected string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/v1/mobile/widget"+query, nil)
		r.Header.Set("X-Expected-User", expected)
		r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, actor))
		w := httptest.NewRecorder()
		a.mobileWidget(w, r)
		return w
	}
	query := "?familyId=widget_family&timezone=Europe%2FMoscow"
	for _, actor := range []string{"widget_member", "widget_admin"} {
		w := call(actor, query, actor)
		want := 200
		if actor == "widget_admin" {
			want = 403
		}
		if w.Code != want {
			t.Fatalf("%s status %d", actor, w.Code)
		}
		if strings.Contains(w.Body.String(), "Personal secret") || strings.Contains(w.Body.String(), description) {
			t.Fatal("widget exposed non-summary data")
		}
	}
	w := call("widget_admin", "", "widget_admin")
	var directory struct {
		Families []any `json:"families"`
	}
	if json.Unmarshal(w.Body.Bytes(), &directory) != nil || len(directory.Families) != 0 {
		t.Fatal("admin got other family directory")
	}
	if call("widget_member", query, "").Code != 403 {
		t.Fatal("summary requires account binding")
	}
	if call("widget_member", "?familyId=widget_family&timezone=Invalid/Timezone", "widget_member").Code != 400 {
		t.Fatal("invalid timezone accepted")
	}
	if _, err = p.Pool.Exec(ctx, `DELETE FROM family_members WHERE family_id='widget_family' AND user_id='widget_member'`); err != nil {
		t.Fatal(err)
	}
	if call("widget_member", query, "widget_member").Code != 403 {
		t.Fatal("removed member retains widget access")
	}
}
