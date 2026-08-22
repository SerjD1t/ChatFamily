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
	if err := p.Pool.QueryRow(context.Background(), `SELECT id,email,display_name,permissions,COALESCE(avatar_key,'') FROM users WHERE id=$1`, id).Scan(&u.ID, &u.Email, &u.Name, &permissions, &u.AvatarURL); err != nil {
		return chat.User{}, false
	}
	u.Permissions = permissionMap(permissions)
	if u.AvatarURL != "" {
		u.AvatarURL = avatarURL(u.ID)
	}
	return u, true
}

func (p *Postgres) Users(actor chat.User) ([]chat.User, error) {
	if !actor.Permissions[chat.ManageUsers] {
		return nil, chat.ErrForbidden
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT id, email, display_name, permissions, COALESCE(avatar_key,'') FROM users ORDER BY display_name, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []chat.User{}
	for rows.Next() {
		var user chat.User
		var permissions []string
		if err := rows.Scan(&user.ID, &user.Email, &user.Name, &permissions, &user.AvatarURL); err != nil {
			return nil, err
		}
		user.Permissions = permissionMap(permissions)
		if user.AvatarURL != "" {
			user.AvatarURL = avatarURL(user.ID)
		}
		users = append(users, user)
	}
	return users, rows.Err()
}
func (p *Postgres) Contacts(actor chat.User) ([]chat.User, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT id,display_name,COALESCE(avatar_key,'') FROM users WHERE id<>$1 ORDER BY display_name,id`, actor.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	contacts := []chat.User{}
	for rows.Next() {
		var contact chat.User
		if err := rows.Scan(&contact.ID, &contact.Name, &contact.AvatarURL); err != nil {
			return nil, err
		}
		if contact.AvatarURL != "" {
			contact.AvatarURL = avatarURL(contact.ID)
		}
		contacts = append(contacts, contact)
	}
	return contacts, rows.Err()
}
func (p *Postgres) FavoriteIDs(actor chat.User) ([]string, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT conversation_id FROM conversation_favorites WHERE user_id=$1`, actor.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
func (p *Postgres) SetFavorite(actor chat.User, conversationID string, favorite bool) error {
	if !p.member(conversationID, actor.ID) {
		return chat.ErrForbidden
	}
	if favorite {
		result, err := p.Pool.Exec(context.Background(), `INSERT INTO conversation_favorites(user_id,conversation_id) SELECT $1,id FROM conversations WHERE id=$2 AND kind='group' ON CONFLICT DO NOTHING`, actor.ID, conversationID)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return chat.ErrInvalid
		}
		return nil
	}
	_, err := p.Pool.Exec(context.Background(), `DELETE FROM conversation_favorites WHERE user_id=$1 AND conversation_id=$2`, actor.ID, conversationID)
	return err
}

func (p *Postgres) UpdateUserPermissions(actor chat.User, userID string, granted []chat.Permission) (chat.User, error) {
	if !actor.Permissions[chat.ManageUsers] || strings.TrimSpace(userID) == "" {
		return chat.User{}, chat.ErrForbidden
	}
	permissions := make([]string, 0, len(granted))
	for _, permission := range granted {
		permissions = append(permissions, string(permission))
	}
	var user chat.User
	var stored []string
	err := p.Pool.QueryRow(context.Background(), `UPDATE users SET permissions=$1 WHERE id=$2 RETURNING id,email,display_name,permissions`, permissions, userID).Scan(&user.ID, &user.Email, &user.Name, &stored)
	if err != nil {
		return chat.User{}, chat.ErrNotFound
	}
	user.Permissions = permissionMap(stored)
	return user, nil
}
func (p *Postgres) Conversations(userID string) []chat.Conversation {
	rows, err := p.Pool.Query(context.Background(), `SELECT c.id,c.kind,COALESCE(NULLIF(c.title,''),(SELECT u.display_name FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=c.id AND cm.user_id<>$1 LIMIT 1),CASE WHEN c.kind='direct' THEN (SELECT display_name FROM users WHERE id=$1) ELSE 'Личный диалог' END),COALESCE((SELECT cm.user_id FROM conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id<>$1 LIMIT 1),CASE WHEN c.kind='direct' THEN $1 ELSE '' END),COUNT(message.id) FILTER (WHERE message.author_id <> $1 AND message.deleted_at IS NULL AND message.created_at > COALESCE(m.last_read_at,'epoch'::timestamptz)),COALESCE(c.family_id,'') FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id LEFT JOIN messages message ON message.conversation_id=c.id WHERE m.user_id=$1 AND c.archived_at IS NULL GROUP BY c.id,c.kind,c.title,c.family_id,m.last_read_at ORDER BY c.title,c.id`, userID)
	if err != nil {
		return []chat.Conversation{}
	}
	defer rows.Close()
	var out []chat.Conversation
	for rows.Next() {
		var c chat.Conversation
		if rows.Scan(&c.ID, &c.Kind, &c.Title, &c.PeerUserID, &c.UnreadCount, &c.FamilyID) == nil {
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
	rows, e := p.Pool.Query(context.Background(), `SELECT m.id,m.conversation_id,m.author_id,u.display_name,COALESCE(u.avatar_key,''),m.body,m.created_at,m.edited_at,m.deleted_at FROM messages m JOIN users u ON u.id=m.author_id WHERE m.conversation_id=$1 ORDER BY m.created_at,m.id`, cid)
	if e != nil {
		return nil, e
	}
	out := []chat.Message{}
	for rows.Next() {
		var m chat.Message
		if e = rows.Scan(&m.ID, &m.ConversationID, &m.AuthorID, &m.AuthorName, &m.AuthorAvatarURL, &m.Body, &m.CreatedAt, &m.EditedAt, &m.DeletedAt); e != nil {
			rows.Close()
			return nil, e
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	attachments := p.attachmentsFor(out)
	reactions := p.reactionsFor(out, a.ID)
	for i := range out {
		if out[i].AuthorAvatarURL != "" {
			out[i].AuthorAvatarURL = avatarURL(out[i].AuthorID)
		}
		out[i].Attachments = attachments[out[i].ID]
		out[i].Reactions = reactions[out[i].ID]
	}
	if _, err := p.Pool.Exec(context.Background(), `UPDATE conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2`, cid, a.ID); err != nil {
		return nil, err
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
	if _, ok := p.User(other); !ok {
		return chat.Conversation{}, chat.ErrNotFound
	}
	key := a.ID + ":" + other
	if other < a.ID {
		key = other + ":" + a.ID
	}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.Conversation{}, err
	}
	defer tx.Rollback(ctx)
	conversationID := id()
	if err = tx.QueryRow(ctx, `INSERT INTO conversations(id,kind,direct_key,created_by) VALUES($1,'direct',$2,$3) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id`, conversationID, key, a.ID).Scan(&conversationID); err != nil {
		return chat.Conversation{}, err
	}
	for _, userID := range []string{a.ID, other} {
		if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, conversationID, userID); err != nil {
			return chat.Conversation{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return chat.Conversation{}, err
	}
	return chat.Conversation{ID: conversationID, Kind: chat.Direct, PeerUserID: other}, nil
}
func (p *Postgres) AddMember(a chat.User, cid, uid string) error {
	familyID, ok := p.FamilyForConversation(cid)
	if !ok || !p.FamilyAdmin(a.ID, familyID) {
		return chat.ErrForbidden
	}
	result, e := p.Pool.Exec(context.Background(), `INSERT INTO conversation_members(conversation_id,user_id) SELECT $1,user_id FROM family_members WHERE family_id=$2 AND user_id=$3 ON CONFLICT DO NOTHING`, cid, familyID, uid)
	if e != nil {
		return e
	}
	if result.RowsAffected() == 0 {
		if _, ok := p.User(uid); !ok {
			return chat.ErrNotFound
		}
	}
	return nil
}
func (p *Postgres) DeleteGroup(actor chat.User, conversationID string) error {
	familyID, ok := p.FamilyForConversation(conversationID)
	if !ok || !p.FamilyAdmin(actor.ID, familyID) {
		return chat.ErrForbidden
	}
	var kind string
	if err := p.Pool.QueryRow(context.Background(), `SELECT kind FROM conversations WHERE id=$1 AND archived_at IS NULL`, conversationID).Scan(&kind); err != nil {
		return chat.ErrNotFound
	}
	if kind != "group" {
		return chat.ErrForbidden
	}
	_, err := p.Pool.Exec(context.Background(), `UPDATE conversations SET archived_at=now() WHERE id=$1`, conversationID)
	return err
}

func (p *Postgres) RenameConversation(actor chat.User, conversationID, title string) error {
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 120 {
		return chat.ErrInvalid
	}
	familyID, ok := p.FamilyForConversation(conversationID)
	if !ok || !p.FamilyAdmin(actor.ID, familyID) {
		return chat.ErrForbidden
	}
	result, err := p.Pool.Exec(context.Background(), `UPDATE conversations SET title=$1 WHERE id=$2 AND archived_at IS NULL`, title, conversationID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return chat.ErrNotFound
	}
	if _, err = p.Pool.Exec(context.Background(), `UPDATE families SET title=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM conversations WHERE id=$3 AND kind='family')`, title, familyID, conversationID); err != nil {
		return err
	}
	return nil
}

func (p *Postgres) SearchMessages(actor chat.User, conversationID, query string) ([]chat.Message, error) {
	if !p.member(conversationID, actor.ID) {
		return nil, chat.ErrForbidden
	}
	query = strings.TrimSpace(query)
	if len([]rune(query)) < 2 || len([]rune(query)) > 120 {
		return nil, chat.ErrInvalid
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT m.id,m.conversation_id,m.author_id,u.display_name,m.body,m.created_at,m.edited_at,m.deleted_at FROM messages m JOIN users u ON u.id=m.author_id JOIN conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 AND c.archived_at IS NULL AND m.deleted_at IS NULL AND m.body ILIKE '%' || $2 || '%' ORDER BY m.created_at DESC,m.id DESC LIMIT 50`, conversationID, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []chat.Message{}
	for rows.Next() {
		var m chat.Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.AuthorID, &m.AuthorName, &m.Body, &m.CreatedAt, &m.EditedAt, &m.DeletedAt); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (p *Postgres) Members(actor chat.User, cid string) ([]chat.User, error) {
	if !p.member(cid, actor.ID) {
		return nil, chat.ErrForbidden
	}
	familyID, inFamily := p.FamilyForConversation(cid)
	showEmails := inFamily && p.FamilyAdmin(actor.ID, familyID)
	rows, err := p.Pool.Query(context.Background(), `SELECT u.id,u.email,u.display_name,u.permissions,COALESCE(u.avatar_key,''),COALESCE(fm.relationship,'Неопределено'),COALESCE(fm.role,'member'),COALESCE((SELECT array_agg(category ORDER BY category) FROM family_member_categories c WHERE c.family_id=fm.family_id AND c.user_id=u.id),ARRAY[]::text[]) FROM users u JOIN conversation_members m ON m.user_id=u.id LEFT JOIN family_members fm ON fm.user_id=u.id AND fm.family_id=(SELECT family_id FROM conversations WHERE id=$1) WHERE m.conversation_id=$1 ORDER BY u.display_name,u.id`, cid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []chat.User{}
	for rows.Next() {
		var u chat.User
		var permissions []string
		var categories []string
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &permissions, &u.AvatarURL, &u.FamilyRelationship, &u.FamilyRole, &categories); err != nil {
			return nil, err
		}
		u.Permissions = permissionMap(permissions)
		u.FamilyCategories = toFamilyCategories(categories)
		if !showEmails {
			u.Email = ""
		}
		if u.AvatarURL != "" {
			u.AvatarURL = avatarURL(u.ID)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (p *Postgres) RemoveMember(actor chat.User, cid, uid string) error {
	familyID, ok := p.FamilyForConversation(cid)
	if !ok || !p.FamilyAdmin(actor.ID, familyID) {
		return chat.ErrForbidden
	}
	if uid == actor.ID {
		return chat.ErrInvalid
	}
	result, err := p.Pool.Exec(context.Background(), `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, cid, uid)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return chat.ErrNotFound
	}
	return nil
}

func (p *Postgres) MemberCandidates(actor chat.User, cid string) ([]chat.User, error) {
	familyID, ok := p.FamilyForConversation(cid)
	if !ok || !p.FamilyAdmin(actor.ID, familyID) {
		return nil, chat.ErrForbidden
	}
	return p.FamilyUsers(familyID)
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
func (p *Postgres) attachmentsFor(messages []chat.Message) map[string][]chat.Attachment {
	result := make(map[string][]chat.Attachment)
	if len(messages) == 0 {
		return result
	}
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT message_id,id,filename,content_type,bytes FROM attachments WHERE message_id=ANY($1) AND deleted_at IS NULL ORDER BY created_at`, ids)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var messageID string
		var attachment chat.Attachment
		if rows.Scan(&messageID, &attachment.ID, &attachment.Filename, &attachment.ContentType, &attachment.Bytes) == nil {
			result[messageID] = append(result[messageID], attachment)
		}
	}
	return result
}
func (p *Postgres) reactions(mid, userID string) []chat.Reaction {
	rows, e := p.Pool.Query(context.Background(), `SELECT emoji,COUNT(*),BOOL_OR(user_id=$2) FROM message_reactions WHERE message_id=$1 GROUP BY emoji ORDER BY emoji`, mid, userID)
	if e != nil {
		return nil
	}
	defer rows.Close()
	var out []chat.Reaction
	for rows.Next() {
		var reaction chat.Reaction
		if rows.Scan(&reaction.Emoji, &reaction.Count, &reaction.Reacted) == nil {
			out = append(out, reaction)
		}
	}
	return out
}
func (p *Postgres) reactionsFor(messages []chat.Message, userID string) map[string][]chat.Reaction {
	result := make(map[string][]chat.Reaction)
	if len(messages) == 0 {
		return result
	}
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT message_id,emoji,COUNT(*),BOOL_OR(user_id=$2) FROM message_reactions WHERE message_id=ANY($1) GROUP BY message_id,emoji ORDER BY emoji`, ids, userID)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var messageID string
		var reaction chat.Reaction
		if rows.Scan(&messageID, &reaction.Emoji, &reaction.Count, &reaction.Reacted) == nil {
			result[messageID] = append(result[messageID], reaction)
		}
	}
	return result
}
func (p *Postgres) ToggleReaction(actor chat.User, mid, emoji string) error {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len([]rune(emoji)) > 8 {
		return chat.ErrInvalid
	}
	ctx := context.Background()
	tx, e := p.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	deleted, e := tx.Exec(ctx, `DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`, mid, actor.ID, emoji)
	if e != nil {
		return e
	}
	if deleted.RowsAffected() == 0 {
		inserted, e := tx.Exec(ctx, `INSERT INTO message_reactions(message_id,user_id,emoji) SELECT m.id,$2,$3 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=$1 AND cm.user_id=$2`, mid, actor.ID, emoji)
		if e != nil {
			return e
		}
		if inserted.RowsAffected() == 0 {
			return chat.ErrForbidden
		}
	}
	return tx.Commit(ctx)
}
func (p *Postgres) ReactionConversation(actor chat.User, messageID string) (string, error) {
	var conversationID string
	err := p.Pool.QueryRow(context.Background(), `SELECT m.conversation_id FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=$1 AND cm.user_id=$2`, messageID, actor.ID).Scan(&conversationID)
	if err != nil {
		return "", chat.ErrForbidden
	}
	return conversationID, nil
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

// MessagesPage returns a bounded, chronological page ending before the supplied message ID.
func (p *Postgres) MessagesPage(a chat.User, cid, before string, limit int) (chat.MessagePage, error) {
	if !p.member(cid, a.ID) {
		return chat.MessagePage{}, chat.ErrForbidden
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT m.id,m.conversation_id,m.author_id,u.display_name,COALESCE(u.avatar_key,''),m.body,m.created_at,m.edited_at,m.deleted_at FROM messages m JOIN users u ON u.id=m.author_id WHERE m.conversation_id=$1 AND ($2='' OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$2 AND conversation_id=$1)) ORDER BY m.created_at DESC,m.id DESC LIMIT $3`, cid, before, limit+1)
	if err != nil {
		return chat.MessagePage{}, err
	}
	defer rows.Close()
	out := []chat.Message{}
	for rows.Next() {
		var m chat.Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.AuthorID, &m.AuthorName, &m.AuthorAvatarURL, &m.Body, &m.CreatedAt, &m.EditedAt, &m.DeletedAt); err != nil {
			return chat.MessagePage{}, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return chat.MessagePage{}, err
	}
	page := chat.MessagePage{}
	if len(out) > limit {
		page.NextBefore = out[limit-1].ID
		out = out[:limit]
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	attachments := p.attachmentsFor(out)
	reactions := p.reactionsFor(out, a.ID)
	for i := range out {
		if out[i].AuthorAvatarURL != "" {
			out[i].AuthorAvatarURL = avatarURL(out[i].AuthorID)
		}
		out[i].Attachments = attachments[out[i].ID]
		out[i].Reactions = reactions[out[i].ID]
		if out[i].AuthorID == a.ID {
			out[i].Status = p.messageStatus(out[i])
		}
	}
	if _, err := p.Pool.Exec(context.Background(), `UPDATE conversation_members SET last_read_at=now(),last_delivered_at=now() WHERE conversation_id=$1 AND user_id=$2`, cid, a.ID); err != nil {
		return chat.MessagePage{}, err
	}
	page.Messages = out
	return page, nil
}
func (p *Postgres) MarkDelivered(a chat.User, cid string) error {
	result, err := p.Pool.Exec(context.Background(), `UPDATE conversation_members SET last_delivered_at=now() WHERE conversation_id=$1 AND user_id=$2`, cid, a.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return chat.ErrForbidden
	}
	return nil
}
func (p *Postgres) messageStatus(m chat.Message) string {
	var recipients, unread, undelivered int
	err := p.Pool.QueryRow(context.Background(), `SELECT COUNT(*),COUNT(*) FILTER (WHERE last_read_at IS NULL OR last_read_at<$2),COUNT(*) FILTER (WHERE last_delivered_at IS NULL OR last_delivered_at<$2) FROM conversation_members WHERE conversation_id=$1 AND user_id<>$3`, m.ConversationID, m.CreatedAt, m.AuthorID).Scan(&recipients, &unread, &undelivered)
	if err != nil || recipients == 0 {
		return "sent"
	}
	if unread == 0 {
		return "read"
	}
	if undelivered == 0 {
		return "delivered"
	}
	return "sent"
}

func avatarURL(userID string) string { return "/api/v1/users/" + userID + "/avatar" }
func (p *Postgres) SetAvatar(userID, key, contentType string) error {
	result, err := p.Pool.Exec(context.Background(), `UPDATE users SET avatar_key=$1,avatar_content_type=$2 WHERE id=$3`, key, contentType, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return chat.ErrNotFound
	}
	return nil
}
func (p *Postgres) AvatarObject(viewerID, userID string) (string, string, error) {
	if _, ok := p.User(viewerID); !ok {
		return "", "", chat.ErrForbidden
	}
	var key, contentType string
	err := p.Pool.QueryRow(context.Background(), `SELECT COALESCE(avatar_key,''),COALESCE(avatar_content_type,'') FROM users WHERE id=$1`, userID).Scan(&key, &contentType)
	if err != nil || key == "" {
		return "", "", chat.ErrNotFound
	}
	return key, contentType, nil
}
