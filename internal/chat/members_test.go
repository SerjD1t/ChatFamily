package chat

import "testing"

func TestDirectConversationIsUniqueForPair(t *testing.T) {
	admin := owner()
	s := New(admin)
	if err := s.AddUser(User{ID: "owner", Permissions: map[Permission]bool{ManageUsers: true}}, User{ID: "other", Email: "other@example.test", Name: "Друг", Permissions: map[Permission]bool{}}); err != nil {
		t.Fatal(err)
	}
	first, err := s.DirectConversation(admin, "other")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.DirectConversation(admin, "other")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("got two direct conversations: %s and %s", first.ID, second.ID)
	}
}

func TestDirectConversationWithSelf(t *testing.T) {
	admin := owner()
	s := New(admin)
	first, err := s.DirectConversation(admin, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.DirectConversation(admin, admin.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("got two self conversations: %s and %s", first.ID, second.ID)
	}
	if len(first.Members) != 1 || !first.Members[admin.ID] {
		t.Fatalf("unexpected self conversation members: %#v", first.Members)
	}
}
