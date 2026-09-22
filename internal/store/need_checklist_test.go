package store

import (
	"familychat/internal/chat"
	"testing"
)

func TestChecklistValidation(t *testing.T) {
	version := int64(1)
	n := chat.ShoppingItem{Kind: "purchase"}
	entries := []chat.ChecklistItem{{Text: " Bread "}, {Text: "Milk 1,5 l"}}
	if e := applyChecklist(&n, NeedInput{Checklist: &entries, Version: &version}, false); e != nil {
		t.Fatal(e)
	}
	if n.Checklist[0].ID == "" || n.Checklist[0].Text != "Bread" {
		t.Fatal("normalization")
	}
	if e := applyChecklist(&n, NeedInput{CheckItem: &chat.ChecklistItem{ID: n.Checklist[0].ID, Completed: true}, Version: &version}, false); e != nil {
		t.Fatal(e)
	}
	if !n.Checklist[0].Completed || n.CompletedAt != nil {
		t.Fatal("must not complete purchase automatically")
	}
	if e := applyChecklist(&n, NeedInput{CheckItem: &chat.ChecklistItem{ID: n.Checklist[0].ID}}, false); e == nil {
		t.Fatal("missing version")
	}
	if e := applyChecklist(&n, NeedInput{CheckItem: &chat.ChecklistItem{ID: "foreign"}, Version: &version}, false); e == nil {
		t.Fatal("foreign entry")
	}
	duplicate := []chat.ChecklistItem{n.Checklist[0], n.Checklist[0]}
	if e := applyChecklist(&n, NeedInput{Checklist: &duplicate, Version: &version}, false); e == nil {
		t.Fatal("duplicate IDs")
	}
	n.Kind = "task"
	if e := applyChecklist(&n, NeedInput{}, false); e == nil {
		t.Fatal("task must not hide checklist")
	}
}
