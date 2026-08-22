package chat

import "strings"

// AddUser is used by invitation acceptance. It deliberately does not grant
// permissions implicitly: the invitation endpoint must pass every category.
func (s *Service) AddUser(actor, user User) error {
	if !actor.Permissions[ManageUsers] {
		return ErrForbidden
	}
	if strings.TrimSpace(user.ID) == "" || strings.TrimSpace(user.Email) == "" || strings.TrimSpace(user.Name) == "" {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.users[user.ID]; exists {
		return ErrInvalid
	}
	s.users[user.ID] = user
	return nil
}

func (s *Service) DirectConversation(actor User, otherID string) (Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, found := s.users[otherID]; !found {
		return Conversation{}, ErrNotFound
	}
	for _, c := range s.conversations {
		expectedMembers := 2
		if actor.ID == otherID {
			expectedMembers = 1
		}
		if c.Kind == Direct && len(c.Members) == expectedMembers && c.Members[actor.ID] && c.Members[otherID] {
			return *c, nil
		}
	}
	c := &Conversation{ID: newID(), Kind: Direct, Members: map[string]bool{actor.ID: true, otherID: true}}
	s.conversations[c.ID] = c
	return *c, nil
}

func (s *Service) AddMember(actor User, conversationID, memberID string) error {
	if !actor.Permissions[ManageGroupMembers] {
		return ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.conversations[conversationID]
	if c == nil {
		return ErrNotFound
	}
	if c.Kind != Group || !c.Members[actor.ID] {
		return ErrForbidden
	}
	if _, found := s.users[memberID]; !found {
		return ErrNotFound
	}
	c.Members[memberID] = true
	return nil
}
func (s *Service) DeleteGroup(actor User, conversationID string) error {
	if !actor.Permissions[ManageGroupSettings] {
		return ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.conversations[conversationID]
	if c == nil {
		return ErrNotFound
	}
	if c.Kind != Group || !c.Members[actor.ID] {
		return ErrForbidden
	}
	delete(s.conversations, conversationID)
	for id, message := range s.messages {
		if message.ConversationID == conversationID {
			delete(s.messages, id)
		}
	}
	return nil
}
