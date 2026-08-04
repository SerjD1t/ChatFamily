package chat

import "testing"

func owner() User {
	return User{ID: "owner", Name: "Владелец", Permissions: map[Permission]bool{
		CreateGroups: true, SendMessages: true, EditOwnMessages: true, DeleteOwnMessages: true,
	}}
}

func TestOnlyAuthorCanEditOrDeleteMessage(t *testing.T) {
	s := New(owner())
	m, err := s.CreateMessage(owner(), "family", "Первое сообщение", nil)
	if err != nil {
		t.Fatal(err)
	}
	other := User{ID: "other", Permissions: map[Permission]bool{EditOwnMessages: true, DeleteOwnMessages: true}}
	if _, err := s.EditMessage(other, m.ID, "Чужая правка"); err != ErrForbidden {
		t.Fatalf("edit error = %v, want forbidden", err)
	}
	if _, err := s.DeleteMessage(other, m.ID); err != ErrForbidden {
		t.Fatalf("delete error = %v, want forbidden", err)
	}
}

func TestGroupCreationRequiresPermission(t *testing.T) {
	s := New(owner())
	member := User{ID: "member", Permissions: map[Permission]bool{}}
	if _, err := s.CreateGroup(member, "Без прав", nil); err != ErrForbidden {
		t.Fatalf("create group error = %v, want forbidden", err)
	}
}
