package chat

import "time"

type Permission string

const (
	ManageUsers         Permission = "manage_users"
	CreateGroups        Permission = "create_groups"
	ManageGroupMembers  Permission = "manage_group_members"
	ManageGroupSettings Permission = "manage_group_settings"
	SendMessages        Permission = "send_messages"
	EditOwnMessages     Permission = "edit_own_messages"
	DeleteOwnMessages   Permission = "delete_own_messages"
)

type User struct {
	ID, Email, Name string
	AvatarURL       string `json:"avatarUrl,omitempty"`
	Permissions     map[Permission]bool
}
type ConversationKind string

const (
	Family ConversationKind = "family"
	Group  ConversationKind = "group"
	Direct ConversationKind = "direct"
)

type Conversation struct {
	ID          string           `json:"id"`
	Kind        ConversationKind `json:"kind"`
	Title       string           `json:"title"`
	PeerUserID  string           `json:"peerUserId,omitempty"`
	UnreadCount int64            `json:"unreadCount"`
	Members     map[string]bool  `json:"-"`
}
type Attachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Bytes       int64  `json:"bytes"`
}
type Reaction struct {
	Emoji   string `json:"emoji"`
	Count   int64  `json:"count"`
	Reacted bool   `json:"reacted"`
}
type Message struct {
	ID              string       `json:"id"`
	ConversationID  string       `json:"conversationId"`
	AuthorID        string       `json:"authorId"`
	AuthorName      string       `json:"authorName"`
	AuthorAvatarURL string       `json:"authorAvatarUrl,omitempty"`
	Body            string       `json:"body"`
	Attachments     []Attachment `json:"attachments,omitempty"`
	Reactions       []Reaction   `json:"reactions,omitempty"`
	CreatedAt       time.Time    `json:"createdAt"`
	EditedAt        *time.Time   `json:"editedAt,omitempty"`
	DeletedAt       *time.Time   `json:"deletedAt,omitempty"`
	Status          string       `json:"status,omitempty"`
}
type MessagePage struct {
	Messages   []Message `json:"messages"`
	NextBefore string    `json:"nextBefore,omitempty"`
}

type Backend interface {
	User(string) (User, bool)
	Conversations(string) []Conversation
	CreateGroup(User, string, []string) (Conversation, error)
	CreateMessage(User, string, string, []Attachment) (Message, error)
	Messages(User, string) ([]Message, error)
	EditMessage(User, string, string) (Message, error)
	DeleteMessage(User, string) (Message, error)
	AddUser(User, User) error
	DirectConversation(User, string) (Conversation, error)
	AddMember(User, string, string) error
	DeleteGroup(User, string) error
}
type PagedBackend interface {
	MessagesPage(User, string, string, int) (MessagePage, error)
	MarkDelivered(User, string) error
}
