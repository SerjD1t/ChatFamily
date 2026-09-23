package main

import (
	"familychat/internal/chat"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWidgetUnreadChatsAreGlobalAndBounded(t *testing.T) {
	chats := []chat.Conversation{
		{ID: "direct", Kind: chat.Direct, UnreadCount: 2},
		{ID: "group", Kind: chat.Group, UnreadCount: 3, Icon: "🛒"},
		{ID: "family", Kind: chat.Family, FamilyID: "other-family", UnreadCount: 4},
		{ID: "read", UnreadCount: 0},
		{ID: "fourth", UnreadCount: 1}, {ID: "fifth", UnreadCount: 7},
	}
	rows, total := widgetUnreadChats(chats)
	if len(rows) != 5 || total != 17 || rows[0].ID != "direct" || rows[2].ID != "family" || rows[1].Icon != "🛒" {
		t.Fatalf("unexpected unread summary: %+v %d", rows, total)
	}
	empty, n := widgetUnreadChats(nil)
	if empty == nil || len(empty) != 0 || n != 0 {
		t.Fatal("expected empty array")
	}
}

func TestWidgetPinsRespectScopeAndCurrentState(t *testing.T) {
	user := "self"
	now := time.Now()
	items := []chat.ShoppingItem{
		{ID: "ok", FamilyID: "f", Kind: "purchase", Version: 3, Checklist: []chat.ChecklistItem{{ID: "entry", Text: "Bread"}}},
		{ID: "private", OwnerUserID: &user, Kind: "purchase"},
		{ID: "foreign", FamilyID: "other", Kind: "purchase"},
		{ID: "archived", FamilyID: "f", Kind: "purchase", ArchivedAt: &now},
		{ID: "done", FamilyID: "f", Kind: "purchase", CompletedAt: &now},
		{ID: "task", FamilyID: "f", Kind: "task"},
	}
	pins := widgetPinned(items, "f", []string{"private", "foreign", "archived", "done", "task", "ok", "ok"})
	if len(pins) != 1 || pins[0].ID != "ok" || pins[0].Version != 3 || len(pins[0].Checklist) != 1 {
		t.Fatal("incorrect pin projection")
	}
}

func TestWidgetRequiresSessionAndExpectedAccount(t *testing.T) {
	a := testApp()
	for _, authenticated := range []bool{false, true} {
		r := httptest.NewRequest("GET", "/api/v1/mobile/widget", nil)
		want := 401
		if authenticated {
			r = authenticatedRequest(t, a, "GET", "/api/v1/mobile/widget", "")
			r.Header.Set("X-Expected-User", "different-account")
			want = 403
		}
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("authenticated=%v: status %d", authenticated, w.Code)
		}
	}
}

func TestWidgetCountsAreNotTruncatedWithRows(t *testing.T) {
	items := []chat.ShoppingItem{}
	for _, id := range []string{"1", "2", "3", "4", "5", "6"} {
		items = append(items, chat.ShoppingItem{ID: id, FamilyID: "family", Kind: "purchase"})
	}
	s := summarizeWidget(items, "self", "family", "2026-09-21", false)
	if s.Purchases != 6 || len(s.Shopping) != 4 {
		t.Fatalf("invalid counts: %+v", s)
	}
}

func TestWidgetSummary(t *testing.T) {
	today := time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)
	old := today.AddDate(0, 0, -1)
	future := today.AddDate(0, 0, 1)
	user := "self"
	items := []chat.ShoppingItem{
		{ID: "1", FamilyID: "family", Kind: "task", PlannedDate: &old, AssigneeID: &user},
		{ID: "2", FamilyID: "family", Kind: "task", PlannedDate: &today},
		{ID: "3", FamilyID: "family", Kind: "task", PlannedDate: &future},
		{ID: "4", FamilyID: "family", Kind: "purchase"},
		{ID: "5", FamilyID: "family", Kind: "purchase", CompletedAt: &today},
		{ID: "6", FamilyID: "other", Kind: "purchase"},
		{ID: "7", FamilyID: "family", OwnerUserID: &user, Kind: "purchase"},
		{ID: "8", FamilyID: "family", Kind: "task", PlannedDate: &old, ArchivedAt: &today},
	}
	s := summarizeWidget(items, user, "family", "2026-09-21", false)
	if s.Due != 1 || s.Overdue != 1 || s.Purchases != 1 || len(s.Tasks) != 2 || s.Tasks[0].ID != "1" {
		t.Fatalf("invalid summary %+v", s)
	}
	s = summarizeWidget(items, user, "family", "2026-09-21", true)
	if s.Due != 0 || s.Overdue != 1 || s.Purchases != 1 {
		t.Fatalf("invalid assigned filter %+v", s)
	}
}
