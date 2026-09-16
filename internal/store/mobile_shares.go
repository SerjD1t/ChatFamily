package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

var ErrShareConflict = errors.New("share request already used with different content")

// CreateSharedMessage commits the message and retry acknowledgement atomically.
// The caller supplies trusted attachment metadata obtained by streaming uploads.
func (p *Postgres) CreateSharedMessage(ctx context.Context, actor chat.User, requestID, hash, cid, body string, attachments []chat.Attachment) (chat.Message, bool, error) {
	if !actor.Permissions[chat.SendMessages] {
		return chat.Message{}, false, chat.ErrForbidden
	}
	body = strings.TrimSpace(body)
	if len([]rune(body)) > 4000 || (body == "" && len(attachments) == 0) {
		return chat.Message{}, false, chat.ErrInvalid
	}
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.Message{}, false, err
	}
	defer tx.Rollback(ctx)
	// Serializes concurrent retries without blocking unrelated shares.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, actor.ID+":"+requestID); err != nil {
		return chat.Message{}, false, err
	}
	var member bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2)`, cid, actor.ID).Scan(&member); err != nil {
		return chat.Message{}, false, err
	}
	if !member {
		return chat.Message{}, false, chat.ErrForbidden
	}
	var oldHash string
	m := chat.Message{ConversationID: cid}
	err = tx.QueryRow(ctx, `SELECT request_hash,message_id FROM mobile_shares WHERE user_id=$1 AND request_id=$2`, actor.ID, requestID).Scan(&oldHash, &m.ID)
	if err == nil {
		if oldHash != hash {
			return chat.Message{}, false, ErrShareConflict
		}
		return m, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return chat.Message{}, false, err
	}
	m = chat.Message{ID: id(), ConversationID: cid, AuthorID: actor.ID, AuthorName: actor.Name, Body: body, Attachments: attachments, CreatedAt: time.Now().UTC()}
	if _, err = tx.Exec(ctx, `INSERT INTO messages(id,conversation_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5)`, m.ID, cid, actor.ID, body, m.CreatedAt); err != nil {
		return chat.Message{}, false, err
	}
	for _, a := range attachments {
		if _, err = tx.Exec(ctx, `INSERT INTO attachments(id,message_id,object_key,filename,content_type,bytes) VALUES($1,$2,$1,$3,$4,$5)`, a.ID, m.ID, a.Filename, a.ContentType, a.Bytes); err != nil {
			return chat.Message{}, false, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mobile_shares(user_id,request_id,request_hash,message_id,conversation_id) VALUES($1,$2,$3,$4,$5)`, actor.ID, requestID, hash, m.ID, cid); err != nil {
		return chat.Message{}, false, err
	}
	err = tx.Commit(ctx)
	return m, err == nil, err
}
