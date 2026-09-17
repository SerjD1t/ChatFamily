package store

import (
	"context"
	"familychat/internal/chat"
	"time"
)

// RecordReceipts acknowledges exact messages, never messages merely fetched by a GET.
func (p *Postgres) RecordReceipts(actor chat.User, ids []string, read bool) ([]string, error) {
	if len(ids) == 0 || len(ids) > 100 {
		return nil, chat.ErrInvalid
	}
	rows, err := p.Pool.Query(context.Background(), `WITH updated AS (
 INSERT INTO message_receipts(message_id,user_id,read_at)
 SELECT m.id,$1,CASE WHEN $3 THEN now() ELSE NULL END
 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1
 WHERE m.id=ANY($2) AND m.author_id<>$1
 ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=COALESCE(message_receipts.read_at,EXCLUDED.read_at)
 WHERE message_receipts.read_at IS NULL AND EXCLUDED.read_at IS NOT NULL
 RETURNING message_id)
 SELECT DISTINCT m.conversation_id FROM updated JOIN messages m ON m.id=updated.message_id`, actor.ID, ids, read)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var cid string
		if err := rows.Scan(&cid); err != nil {
			return nil, err
		}
		result = append(result, cid)
	}
	return result, rows.Err()
}

func (p *Postgres) PendingDeliveries(actor chat.User) ([]string, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT m.id FROM messages m
 JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1
 JOIN conversations c ON c.id=m.conversation_id AND c.archived_at IS NULL
 WHERE m.author_id<>$1 AND m.deleted_at IS NULL AND NOT EXISTS
 (SELECT 1 FROM message_receipts r WHERE r.message_id=m.id AND r.user_id=$1)
 ORDER BY m.created_at,m.id LIMIT 100`, actor.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func (p *Postgres) ReceiptStatuses(actor chat.User, ids []string) (map[string]string, error) {
	summaries, err := p.ReceiptSummaries(actor, ids)
	if err != nil {
		return nil, err
	}
	result := map[string]string{}
	for id, summary := range summaries {
		result[id] = summary.Status
	}
	return result, nil
}

type ReceiptSummary struct {
	Status    string `json:"status"`
	Total     int    `json:"total"`
	Delivered int    `json:"delivered"`
	Read      int    `json:"read"`
}

func (p *Postgres) ReceiptSummaries(actor chat.User, ids []string) (map[string]ReceiptSummary, error) {
	if len(ids) > 100 {
		return nil, chat.ErrInvalid
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT m.id,CASE
 WHEN count(cm.user_id)=0 THEN 'sent'
 WHEN count(r.read_at)=count(cm.user_id) THEN 'read'
 WHEN count(r.delivered_at)=count(cm.user_id) THEN 'delivered'
 ELSE 'sent' END,count(cm.user_id),count(r.delivered_at),count(r.read_at) FROM messages m
 JOIN conversation_members viewer ON viewer.conversation_id=m.conversation_id AND viewer.user_id=$1
 LEFT JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id<>m.author_id
 LEFT JOIN message_receipts r ON r.message_id=m.id AND r.user_id=cm.user_id
 WHERE m.author_id=$1 AND m.id=ANY($2) GROUP BY m.id`, actor.ID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]ReceiptSummary{}
	for rows.Next() {
		var id string
		var summary ReceiptSummary
		if err := rows.Scan(&id, &summary.Status, &summary.Total, &summary.Delivered, &summary.Read); err != nil {
			return nil, err
		}
		result[id] = summary
	}
	return result, rows.Err()
}

type ReceiptRecipient struct {
	UserID      string     `json:"userId"`
	Name        string     `json:"name"`
	DeliveredAt *time.Time `json:"deliveredAt"`
	ReadAt      *time.Time `json:"readAt"`
}

// Only the author, while still a member, may inspect current recipients.
// LEFT JOIN retains one authorization row for a self-dialog with no recipients.
func (p *Postgres) ReceiptDetails(actor chat.User, messageID string) ([]ReceiptRecipient, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT u.id,COALESCE(chat_author_label(u.id,m.conversation_id),''),r.delivered_at,r.read_at
 FROM messages m
 JOIN conversation_members viewer ON viewer.conversation_id=m.conversation_id AND viewer.user_id=$1
 LEFT JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id<>m.author_id
 LEFT JOIN users u ON u.id=cm.user_id
 LEFT JOIN message_receipts r ON r.message_id=m.id AND r.user_id=cm.user_id
 WHERE m.id=$2 AND m.author_id=$1 ORDER BY u.display_name,u.id`, actor.ID, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ReceiptRecipient{}
	found := false
	for rows.Next() {
		found = true
		var uid *string
		var entry ReceiptRecipient
		if err := rows.Scan(&uid, &entry.Name, &entry.DeliveredAt, &entry.ReadAt); err != nil {
			return nil, err
		}
		if uid != nil {
			entry.UserID = *uid
			result = append(result, entry)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !found {
		return nil, chat.ErrNotFound
	}
	return result, nil
}
