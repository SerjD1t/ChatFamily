package store

import "context"

// UnreadTotal counts messages, not chats, across all current memberships.
// Query failures must not be interpreted as an empty inbox.
func (p *Postgres) UnreadTotal(ctx context.Context, uid string) (int, error) {
	var count int
	err := p.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM messages msg
 JOIN conversations c ON c.id=msg.conversation_id
 JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1
 JOIN users u ON u.id=cm.user_id AND u.disabled_at IS NULL
 WHERE c.archived_at IS NULL AND msg.deleted_at IS NULL AND msg.author_id<>$1
 AND NOT EXISTS (SELECT 1 FROM message_receipts r WHERE r.message_id=msg.id AND r.user_id=$1 AND r.read_at IS NOT NULL)`, uid).Scan(&count)
	return count, err
}
