package chat

import "testing"

func TestBasicMessagesWithoutFlags(t *testing.T) {
	u := User{ID: "basic"}
	s := New(u)
	m, err := s.CreateMessage(u, "family", "hello", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.EditMessage(u, m.ID, "edited"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DeleteMessage(u, m.ID); err != nil {
		t.Fatal(err)
	}
	m, err = s.CreateMessage(u, "family", "", []Attachment{{ID: "synthetic"}})
	if err != nil {
		t.Fatal(err)
	}
	delete(s.conversations["family"].Members, u.ID)
	if _, err = s.EditMessage(u, m.ID, "blocked"); err != ErrForbidden {
		t.Fatal("edit after exclusion", err)
	}
	if _, err = s.DeleteMessage(u, m.ID); err != ErrForbidden {
		t.Fatal("delete after exclusion", err)
	}
}
