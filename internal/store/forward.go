package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

var ErrForwardCommitUnknown = errors.New("forward commit outcome unknown")

// ForwardMessage copies content, not access to the source conversation. copyFile
// must create a new independent object. A retry returns the original receipt.
func (p *Postgres) ForwardMessage(ctx context.Context, actor chat.User, source, destination, requestID string, copyFile func(string, chat.Attachment) (chat.Attachment, error)) (chat.Message, bool, error) {
	var m chat.Message
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return m, false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "forward:"+actor.ID+":"+requestID); err != nil {
		return m, false, err
	}
	var allowed string
	// Lock destination membership against concurrent exclusion.
	err = tx.QueryRow(ctx, `SELECT cm.user_id FROM conversation_members cm JOIN users u ON u.id=cm.user_id JOIN conversations c ON c.id=cm.conversation_id WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND u.disabled_at IS NULL AND c.archived_at IS NULL FOR SHARE OF cm,u,c`, destination, actor.ID).Scan(&allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, false, chat.ErrForbidden
	}
	if err != nil {
		return m, false, err
	}
	var oldSource, oldDestination string
	err = tx.QueryRow(ctx, `SELECT source_id,conversation_id,message_id FROM message_forwards WHERE user_id=$1 AND request_id=$2`, actor.ID, requestID).Scan(&oldSource, &oldDestination, &m.ID)
	if err == nil {
		if oldSource != source || oldDestination != destination {
			return m, false, ErrShareConflict
		}
		m.ConversationID = destination
		return m, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return m, false, err
	}
	err = tx.QueryRow(ctx, `SELECT m.body FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id JOIN conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND cm.user_id=$2 AND m.deleted_at IS NULL AND c.archived_at IS NULL FOR SHARE OF m,cm,c`, source, actor.ID).Scan(&m.Body)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, false, chat.ErrForbidden
	}
	if err != nil {
		return m, false, err
	}
	rows, err := tx.Query(ctx, `SELECT id,object_key,filename,content_type,bytes,deleted_at IS NOT NULL FROM attachments WHERE message_id=$1 ORDER BY id FOR SHARE`, source)
	if err != nil {
		return m, false, err
	}
	type object struct {
		key  string
		file chat.Attachment
	}
	var objects []object
	for rows.Next() {
		var o object
		var deleted bool
		if err = rows.Scan(&o.file.ID, &o.key, &o.file.Filename, &o.file.ContentType, &o.file.Bytes, &deleted); err != nil {
			break
		}
		if deleted {
			err = chat.ErrInvalid
			break
		}
		objects = append(objects, o)
	}
	rowErr := rows.Err()
	rows.Close()
	if err != nil {
		return m, false, err
	}
	if rowErr != nil {
		return m, false, rowErr
	}
	if m.Body == "" && len(objects) == 0 {
		return m, false, chat.ErrInvalid
	}
	m.ID = id()
	m.ConversationID = destination
	m.AuthorID = actor.ID
	m.CreatedAt = time.Now().UTC()
	m.Forwarded = true
	if err = tx.QueryRow(ctx, `SELECT chat_author_label($1,$2)`, actor.ID, destination).Scan(&m.AuthorName); err != nil {
		return m, false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO messages(id,conversation_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5)`, m.ID, destination, actor.ID, m.Body, m.CreatedAt); err != nil {
		return m, false, err
	}
	for _, o := range objects {
		file, e := copyFile(o.key, o.file)
		if e != nil {
			return m, false, e
		}
		if _, err = tx.Exec(ctx, `INSERT INTO attachments(id,message_id,object_key,filename,content_type,bytes) VALUES($1,$2,$1,$3,$4,$5)`, file.ID, m.ID, file.Filename, file.ContentType, file.Bytes); err != nil {
			return m, false, err
		}
		m.Attachments = append(m.Attachments, file)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO message_forwards(user_id,request_id,source_id,conversation_id,message_id) VALUES($1,$2,$3,$4,$5)`, actor.ID, requestID, source, destination, m.ID); err != nil {
		return m, false, err
	}
	err = tx.Commit(ctx)
	if err != nil {
		return m, false, fmt.Errorf("%w: %w", ErrForwardCommitUnknown, err)
	}
	return m, err == nil, err
}
