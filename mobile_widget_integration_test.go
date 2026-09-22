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
	cleanup := func() {
		_, e := p.Pool.Exec(ctx, `DELETE FROM shopping_items WHERE created_by IN ('widget_member','widget_admin');DELETE FROM families WHERE id='widget_family';DELETE FROM users WHERE id IN ('widget_member','widget_admin')`)
		if e != nil {
			t.Error("widget fixture cleanup", e)
		}
	}
	cleanup()
	defer cleanup()
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES
 ('widget_member','widget-member@example.test','Member','',ARRAY[]::text[]),
 ('widget_admin','widget-admin@example.test','Admin','',ARRAY['manage_application']);
 INSERT INTO families(id,title) VALUES('widget_family','Widget family');
 INSERT INTO family_members(family_id,user_id,role) VALUES('widget_family','widget_member','member');`)
	if err != nil {
		t.Fatal(err)
	}
	title, kind, description := "Family purchase", "purchase", "private description not for widget"
	checklist := []chat.ChecklistItem{{Text: "Bread"}}
	purchase, err := p.SaveNeed(chat.User{ID: "widget_member"}, "widget_family", "", store.NeedInput{Title: &title, Kind: &kind, Description: &description, Checklist: &checklist})
	if err != nil {
		t.Fatal(err)
	}
	title = "Personal secret"
	if _, err = p.SaveNeed(chat.User{ID: "widget_member"}, "", "", store.NeedInput{Title: &title, Kind: &kind}); err != nil {
		t.Fatal(err)
	}
	a := testApp()
	a.hub = &hub{}
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
	selected := call("widget_member", query+"&pins="+purchase.ID+"&configure=true", "widget_member")
	var pinResponse struct {
		Pinned    []widgetPin  `json:"pinned"`
		Purchases []widgetItem `json:"purchases"`
	}
	if selected.Code != 200 || json.Unmarshal(selected.Body.Bytes(), &pinResponse) != nil || len(pinResponse.Pinned) != 1 || len(pinResponse.Purchases) != 1 || len(pinResponse.Pinned[0].Checklist) != 1 {
		t.Fatal("pinned selection")
	}
	if strings.Contains(selected.Body.String(), description) || strings.Contains(selected.Body.String(), "Personal secret") {
		t.Fatal("private fields in pins")
	}
	if call("widget_member", query+"&pins=a,b,c,d", "widget_member").Code != 400 {
		t.Fatal("unbounded pins")
	}
	patch := func(expected string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("PATCH", "/api/v1/families/widget_family/needs/"+purchase.ID, strings.NewReader(`{"version":1,"checkItem":{"id":"`+purchase.Checklist[0].ID+`","completed":true}}`))
		r.SetPathValue("familyID", "widget_family")
		r.SetPathValue("itemID", purchase.ID)
		r.Header.Set("X-Expected-User", expected)
		r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, "widget_member"))
		w := httptest.NewRecorder()
		a.needs(w, r)
		return w
	}
	if patch("widget_admin").Code != 403 {
		t.Fatal("mutation must bind account")
	}
	if patch("widget_member").Code != 200 {
		t.Fatal("widget check failed")
	}
	if patch("widget_member").Code != 409 {
		t.Fatal("stale widget check accepted")
	}
	if _, err = p.Pool.Exec(ctx, `DELETE FROM family_members WHERE family_id='widget_family' AND user_id='widget_member'`); err != nil {
		t.Fatal(err)
	}
	if call("widget_member", query, "widget_member").Code != 403 {
		t.Fatal("removed member retains widget access")
	}
}
