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

func TestConversationsIncludeLatestMessagePreview(t *testing.T) {
	s := New(owner())
	message, err := s.CreateMessage(owner(), "family", "Последнее сообщение", nil)
	if err != nil {
		t.Fatal(err)
	}

	conversations := s.Conversations(owner().ID)
	if len(conversations) != 1 {
		t.Fatalf("conversation count = %d, want 1", len(conversations))
	}
	if conversations[0].LastMessage != message.Body {
		t.Fatalf("last message = %q, want %q", conversations[0].LastMessage, message.Body)
	}
	if conversations[0].LastMessageAt == nil || !conversations[0].LastMessageAt.Equal(message.CreatedAt) {
		t.Fatalf("last message time = %v, want %v", conversations[0].LastMessageAt, message.CreatedAt)
	}
}
