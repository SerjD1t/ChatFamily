package chat

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrForbidden = errors.New("forbidden")
	ErrNotFound  = errors.New("not found")
	ErrInvalid   = errors.New("invalid input")
)

// Service isolates domain rules. The in-memory repository is deliberate for the first vertical slice;
// its API will be preserved when PostgreSQL storage is wired in the next step.
type Service struct {
	mu            sync.RWMutex
	users         map[string]User
	conversations map[string]*Conversation
	messages      map[string]*Message
}

func New(admin User) *Service {
	s := &Service{users: map[string]User{admin.ID: admin}, conversations: map[string]*Conversation{}, messages: map[string]*Message{}}
	s.conversations["family"] = &Conversation{ID: "family", Kind: Family, Title: "Семья", Members: map[string]bool{admin.ID: true}}
	return s
}
func (s *Service) User(id string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	return u, ok
}
func (s *Service) Conversations(userID string) []Conversation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Conversation{}
	for _, c := range s.conversations {
		if c.Members[userID] {
			out = append(out, *c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	return out
}
func (s *Service) CreateGroup(actor User, title string, members []string) (Conversation, error) {
	if !actor.Permissions[CreateGroups] {
		return Conversation{}, ErrForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 120 {
		return Conversation{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := &Conversation{ID: newID(), Kind: Group, Title: title, Members: map[string]bool{actor.ID: true}}
	for _, id := range members {
		if _, ok := s.users[id]; ok {
			c.Members[id] = true
		}
	}
	s.conversations[c.ID] = c
	return *c, nil
}
func (s *Service) CreateMessage(actor User, conversationID, body string, attachments []Attachment) (Message, error) {
	if !actor.Permissions[SendMessages] {
		return Message{}, ErrForbidden
	}
	body = strings.TrimSpace(body)
	if body == "" && len(attachments) == 0 || len([]rune(body)) > 4000 {
		return Message{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.conversations[conversationID]
	if c == nil {
		return Message{}, ErrNotFound
	}
	if !c.Members[actor.ID] {
		return Message{}, ErrForbidden
	}
	m := &Message{ID: newID(), ConversationID: conversationID, AuthorID: actor.ID, AuthorName: actor.Name, Body: body, Attachments: attachments, CreatedAt: time.Now().UTC()}
	s.messages[m.ID] = m
	return *m, nil
}
func (s *Service) Messages(actor User, conversationID string) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := s.conversations[conversationID]
	if c == nil {
		return nil, ErrNotFound
	}
	if !c.Members[actor.ID] {
		return nil, ErrForbidden
	}
	out := []Message{}
	for _, m := range s.messages {
		if m.ConversationID == conversationID {
			out = append(out, *m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}
func (s *Service) EditMessage(actor User, messageID, body string) (Message, error) {
	if !actor.Permissions[EditOwnMessages] {
		return Message{}, ErrForbidden
	}
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > 4000 {
		return Message{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.messages[messageID]
	if m == nil {
		return Message{}, ErrNotFound
	}
	if m.AuthorID != actor.ID || m.DeletedAt != nil {
		return Message{}, ErrForbidden
	}
	now := time.Now().UTC()
	m.Body = body
	m.EditedAt = &now
	return *m, nil
}
func (s *Service) DeleteMessage(actor User, messageID string) (Message, error) {
	if !actor.Permissions[DeleteOwnMessages] {
		return Message{}, ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.messages[messageID]
	if m == nil {
		return Message{}, ErrNotFound
	}
	if m.AuthorID != actor.ID || m.DeletedAt != nil {
		return Message{}, ErrForbidden
	}
	now := time.Now().UTC()
	m.Body = ""
	m.DeletedAt = &now
	return *m, nil
}
func newID() string { b := make([]byte, 16); _, _ = rand.Read(b); return hex.EncodeToString(b) }
