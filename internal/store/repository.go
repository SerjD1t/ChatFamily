package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sort"
	"strings"
	"time"

	"familychat/internal/chat"
)

func (p *Postgres) User(id string) (chat.User, bool) {
	var u chat.User
	var permissions []string
	if err := p.Pool.QueryRow(context.Background(), `SELECT id,email,display_name,permissions FROM users WHERE id=$1`, id).Scan(&u.ID, &u.Email, &u.Name, &permissions); err != nil {
		return chat.User{}, false
	}
	u.Permissions = permissionMap(permissions)
	return u, true
}
func (p *Postgres) Conversations(userID string) []chat.Conversation {
	rows, err := p.Pool.Query(context.Background(), `SELECT c.id,c.kind,COALESCE(c.title,'') FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=$1 ORDER BY c.title,c.id`, userID)
	if err != nil {
		return []chat.Conversation{}
	}
	defer rows.Close()
	var out []chat.Conversation
	for rows.Next() {
		var c chat.Conversation
		if rows.Scan(&c.ID, &c.Kind, &c.Title) == nil {
			c.Members = p.members(c.ID)
			out = append(out, c)
		}
	}
	return out
}
func (p *Postgres) CreateGroup(a chat.User, title string, ids []string) (chat.Conversation, error) {
	if !a.Permissions[chat.CreateGroups] {
		return chat.Conversation{}, chat.ErrForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 120 {
		return chat.Conversation{}, chat.ErrInvalid
	}
	id := id()
	ctx := context.Background()
	if _, e := p.Pool.Exec(ctx, `INSERT INTO conversations(id,kind,title,created_by) VALUES($1,'group',$2,$3)`, id, title, a.ID); e != nil {
		return chat.Conversation{}, e
	}
	for _, member := range unique(append(ids, a.ID)) {
		if _, e := p.Pool.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT $1,id FROM users WHERE id=$2 ON CONFLICT DO NOTHING`, id, member); e != nil {
			return chat.Conversation{}, e
		}
	}
	return chat.Conversation{ID: id, Kind: chat.Group, Title: title, Members: p.members(id)}, nil
}
func (p *Postgres) CreateMessage(a chat.User, cid, body string, attachments []chat.Attachment) (chat.Message, error) {
	if !a.Permissions[chat.SendMessages] {
		return chat.Message{}, chat.ErrForbidden
	}
	body = strings.TrimSpace(body)
	if (body == "" && len(attachments) == 0) || len([]rune(body)) > 4000 {
		return chat.Message{}, chat.ErrInvalid
	}
	if !p.member(cid, a.ID) {
		return chat.Message{}, chat.ErrForbidden
	}
	m := chat.Message{ID: id(), ConversationID: cid, AuthorID: a.ID, AuthorName: a.Name, Body: body, Attachments: attachments, CreatedAt: time.Now().UTC()}
	ctx := context.Background()
	tx, e := p.Pool.Begin(ctx)
	if e != nil {
		return chat.Message{}, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `INSERT INTO messages(id,conversation_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5)`, m.ID, cid, a.ID, body, m.CreatedAt); e != nil {
		return chat.Message{}, e
	}
	for _, attachment := range attachments {
		if attachment.ID == "" || attachment.Bytes < 1 {
			return chat.Message{}, chat.ErrInvalid
		}
		if _, e = tx.Exec(ctx, `INSERT INTO attachments(id,message_id,object_key,filename,content_type,bytes) VALUES($1,$2,$1,$3,$4,$5)`, attachment.ID, m.ID, attachment.Filename, attachment.ContentType, attachment.Bytes); e != nil {
			return chat.Message{}, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return chat.Message{}, e
	}
	return m, nil
}
func (p *Postgres) Messages(a chat.User, cid string) ([]chat.Message, error) {
	if !p.member(cid, a.ID) {
		return nil, chat.ErrForbidden
	}
	rows, e := p.Pool.Query(context.Background(), `SELECT m.id,m.conversation_id,m.author_id,u.display_name,m.body,m.created_at,m.edited_at,m.deleted_at FROM messages m JOIN users u ON u.id=m.author_id WHERE m.conversation_id=$1 ORDER BY m.created_at,m.id`, cid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var out []chat.Message
	for rows.Next() {
		var m chat.Message
		if e = rows.Scan(&m.ID, &m.ConversationID, &m.AuthorID, &m.AuthorName, &m.Body, &m.CreatedAt, &m.EditedAt, &m.DeletedAt); e != nil {
			return nil, e
		}
		m.Attachments = p.attachments(m.ID)
		out = append(out, m)
	}
	return out, nil
}
func (p *Postgres) EditMessage(a chat.User, mid, body string) (chat.Message, error) {
	if !a.Permissions[chat.EditOwnMessages] {
		return chat.Message{}, chat.ErrForbidden
	}
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > 4000 {
		return chat.Message{}, chat.ErrInvalid
	}
	now := time.Now().UTC()
	row := p.Pool.QueryRow(context.Background(), `UPDATE messages SET body=$1,edited_at=$2 WHERE id=$3 AND author_id=$4 AND deleted_at IS NULL RETURNING conversation_id`, body, now, mid, a.ID)
	var cid string
	if e := row.Scan(&cid); e != nil {
		return chat.Message{}, chat.ErrForbidden
	}
	return chat.Message{ID: mid, ConversationID: cid, AuthorID: a.ID, AuthorName: a.Name, Body: body, EditedAt: &now}, nil
}
func (p *Postgres) DeleteMessage(a chat.User, mid string) (chat.Message, error) {
	if !a.Permissions[chat.DeleteOwnMessages] {
		return chat.Message{}, chat.ErrForbidden
	}
	now := time.Now().UTC()
	var cid string
	if e := p.Pool.QueryRow(context.Background(), `UPDATE messages SET body='',deleted_at=$1 WHERE id=$2 AND author_id=$3 AND deleted_at IS NULL RETURNING conversation_id`, now, mid, a.ID).Scan(&cid); e != nil {
		return chat.Message{}, chat.ErrForbidden
	}
	return chat.Message{ID: mid, ConversationID: cid, AuthorID: a.ID, AuthorName: a.Name, DeletedAt: &now}, nil
}
func (p *Postgres) AddUser(a, u chat.User) error {
	if !a.Permissions[chat.ManageUsers] {
		return chat.ErrForbidden
	}
	if strings.TrimSpace(u.ID) == "" || strings.TrimSpace(u.Email) == "" || strings.TrimSpace(u.Name) == "" {
		return chat.ErrInvalid
	}
	_, e := p.Pool.Exec(context.Background(), `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES($1,$2,$3,'',$4)`, u.ID, u.Email, u.Name, permissions(u.Permissions))
	return e
}
func (p *Postgres) DirectConversation(a chat.User, other string) (chat.Conversation, error) {
	if a.ID == other {
		return chat.Conversation{}, chat.ErrInvalid
	}
	if _, ok := p.User(other); !ok {
		return chat.Conversation{}, chat.ErrNotFound
	}
	key := a.ID + ":" + other
	if other < a.ID {
		key = other + ":" + a.ID
	}
	var conversationID string
	e := p.Pool.QueryRow(context.Background(), `SELECT id FROM conversations WHERE direct_key=$1`, key).Scan(&conversationID)
	if e != nil {
		conversationID = id()
		if _, e = p.Pool.Exec(context.Background(), `INSERT INTO conversations(id,kind,direct_key,created_by) VALUES($1,'direct',$2,$3)`, id, key, a.ID); e != nil {
			return chat.Conversation{}, e
		}
		for _, u := range []string{a.ID, other} {
			p.Pool.Exec(context.Background(), `INSERT INTO conversation_members(conversation_id,user_id) SELECT $1,id FROM users WHERE id=$2`, conversationID, u)
		}
	}
	return chat.Conversation{ID: conversationID, Kind: chat.Direct, Members: p.members(conversationID)}, nil
}
func (p *Postgres) AddMember(a chat.User, cid, uid string) error {
	if !a.Permissions[chat.ManageGroupMembers] || !p.groupMember(cid, a.ID) {
		return chat.ErrForbidden
	}
	_, e := p.Pool.Exec(context.Background(), `INSERT INTO conversation_members(conversation_id,user_id) SELECT $1,id FROM users WHERE id=$2 ON CONFLICT DO NOTHING`, cid, uid)
	return e
}

func (p *Postgres) groupMember(cid, uid string) bool {
	var ok bool
	_ = p.Pool.QueryRow(context.Background(), `SELECT EXISTS(
		SELECT 1 FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id
		WHERE c.id=$1 AND c.kind='group' AND m.user_id=$2)`, cid, uid).Scan(&ok)
	return ok
}
func (p *Postgres) members(cid string) map[string]bool {
	rows, e := p.Pool.Query(context.Background(), `SELECT user_id FROM conversation_members WHERE conversation_id=$1`, cid)
	if e != nil {
		return map[string]bool{}
	}
	defer rows.Close()
	r := map[string]bool{}
	for rows.Next() {
		var x string
		if rows.Scan(&x) == nil {
			r[x] = true
		}
	}
	return r
}
func (p *Postgres) member(cid, uid string) bool {
	var ok bool
	p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2)`, cid, uid).Scan(&ok)
	return ok
}
func (p *Postgres) attachments(mid string) []chat.Attachment {
	rows, e := p.Pool.Query(context.Background(), `SELECT id,filename,content_type,bytes FROM attachments WHERE message_id=$1 AND deleted_at IS NULL ORDER BY created_at`, mid)
	if e != nil {
		return nil
	}
	defer rows.Close()
	var out []chat.Attachment
	for rows.Next() {
		var a chat.Attachment
		if rows.Scan(&a.ID, &a.Filename, &a.ContentType, &a.Bytes) == nil {
			out = append(out, a)
		}
	}
	return out
}
func (p *Postgres) AttachmentObject(userID, attachmentID string) (string, chat.Attachment, error) {
	var key string
	var a chat.Attachment
	err := p.Pool.QueryRow(context.Background(), `SELECT a.object_key,a.id,a.filename,a.content_type,a.bytes FROM attachments a JOIN messages m ON m.id=a.message_id JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE a.id=$1 AND a.deleted_at IS NULL AND cm.user_id=$2`, attachmentID, userID).Scan(&key, &a.ID, &a.Filename, &a.ContentType, &a.Bytes)
	if err != nil {
		return "", chat.Attachment{}, chat.ErrNotFound
	}
	return key, a, nil
}
func permissions(m map[chat.Permission]bool) []string {
	r := []string{}
	for k, v := range m {
		if v {
			r = append(r, string(k))
		}
	}
	sort.Strings(r)
	return r
}
func permissionMap(a []string) map[chat.Permission]bool {
	r := map[chat.Permission]bool{}
	for _, x := range a {
		r[chat.Permission(x)] = true
	}
	return r
}
func unique(a []string) []string {
	r := []string{}
	seen := map[string]bool{}
	for _, x := range a {
		if !seen[x] {
			seen[x] = true
			r = append(r, x)
		}
	}
	return r
}
func id() string { b := make([]byte, 16); rand.Read(b); return hex.EncodeToString(b) }
