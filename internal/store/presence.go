package store

import (
	"context"
	"familychat/internal/chat"
	"time"
)

type Presence struct {
	LastActiveAt *time.Time `json:"lastActiveAt"`
	Online       bool       `json:"online"`
}

// Only explicit foreground activity calls this method. Background APIs never do.
// Server time and a conditional update make concurrent devices monotonic and
// bound writes even when several tabs report activity together.
func (p *Postgres) RecordActivity(ctx context.Context, uid string, ageMS int) error {
	if ageMS < 0 || ageMS > 30000 {
		return chat.ErrInvalid
	}
	_, err := p.Pool.Exec(ctx, `UPDATE users SET last_active_at=clock_timestamp()-$2*interval '1 millisecond'
 WHERE id=$1 AND disabled_at IS NULL
 AND (last_active_at IS NULL OR last_active_at<clock_timestamp()-$2*interval '1 millisecond'-interval '10 seconds')`, uid, ageMS)
	return err
}

// Presence has the same audience as the global personal contact directory:
// authenticated active users, no email or family membership is returned.
func (p *Postgres) UserPresence(ctx context.Context, ids []string) (map[string]Presence, error) {
	if len(ids) > 100 {
		return nil, chat.ErrInvalid
	}
	result := map[string]Presence{}
	rows, err := p.Pool.Query(ctx, `SELECT id,last_active_at,
 COALESCE(last_active_at>clock_timestamp()-interval '3 minutes',false)
 FROM users WHERE id=ANY($1::text[]) AND disabled_at IS NULL`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		var value Presence
		if err = rows.Scan(&uid, &value.LastActiveAt, &value.Online); err != nil {
			return nil, err
		}
		result[uid] = value
	}
	return result, rows.Err()
}
