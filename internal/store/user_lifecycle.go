package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"github.com/jackc/pgx/v5/pgconn"
	"strings"
	"time"
)

var ErrUserProtected = errors.New("protected user")
var ErrUserHistory = errors.New("user has related history")
var ErrEmailConfirmation = errors.New("email confirmation mismatch")

func (p *Postgres) SessionAllowed(uid string, issued time.Time) bool {
	if p.Pool == nil {
		return false
	}
	var ok bool
	err := p.Pool.QueryRow(context.Background(), `SELECT disabled_at IS NULL AND sessions_revoked_at<$2 FROM users WHERE id=$1`, uid, issued).Scan(&ok)
	return err == nil && ok
}

// ChangeUserLifecycle serializes all administrative user changes and checks live permissions.
func (p *Postgres) ChangeUserLifecycle(actorID, targetID, action, email string) error {
	if actorID == targetID || targetID == "admin" {
		return ErrUserProtected
	}
	if action != "deactivate" && action != "activate" && action != "delete" {
		return chat.ErrInvalid
	}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT disabled_at IS NULL AND permissions @> ARRAY['manage_application']::text[] FROM users WHERE id=$1`, actorID).Scan(&allowed); err != nil || !allowed {
		return chat.ErrForbidden
	}
	var address string
	var admin, disabled bool
	if err = tx.QueryRow(ctx, `SELECT email,permissions @> ARRAY['manage_application']::text[],disabled_at IS NOT NULL FROM users WHERE id=$1 FOR UPDATE`, targetID).Scan(&address, &admin, &disabled); err != nil {
		return chat.ErrNotFound
	}
	if strings.TrimSpace(email) != address {
		return ErrEmailConfirmation
	}
	if action != "activate" && admin && !disabled {
		var count int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE disabled_at IS NULL AND permissions @> ARRAY['manage_application']::text[]`).Scan(&count); err != nil {
			return err
		}
		if count <= 1 {
			return ErrUserProtected
		}
	}
	if action == "delete" {
		var history bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE author_id=$1) OR EXISTS(SELECT 1 FROM conversations WHERE created_by=$1) OR EXISTS(SELECT 1 FROM families WHERE created_by=$1) OR EXISTS(SELECT 1 FROM shopping_items WHERE created_by=$1) OR EXISTS(SELECT 1 FROM message_reactions WHERE user_id=$1) OR EXISTS(SELECT 1 FROM message_receipts WHERE user_id=$1) OR EXISTS(SELECT 1 FROM mobile_shares WHERE user_id=$1) OR EXISTS(SELECT 1 FROM conversation_members m JOIN conversations c ON c.id=m.conversation_id JOIN messages msg ON msg.conversation_id=c.id WHERE m.user_id=$1 AND c.kind='direct') OR EXISTS(SELECT 1 FROM users WHERE id=$1 AND avatar_key IS NOT NULL AND avatar_key<>'')`, targetID).Scan(&history)
		if err != nil {
			return err
		}
		if history {
			return ErrUserHistory
		}
		// Revoke outstanding invitations so a deleted account cannot be recreated with an old code.
		if _, err = tx.Exec(ctx, `UPDATE invitations SET expires_at=now() WHERE lower(email)=lower($1) AND accepted_at IS NULL`, address); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM users WHERE id=$1`, targetID)
	} else if action == "deactivate" {
		_, err = tx.Exec(ctx, `UPDATE users SET disabled_at=COALESCE(disabled_at,now()),sessions_revoked_at=now() WHERE id=$1`, targetID)
	} else {
		_, err = tx.Exec(ctx, `UPDATE users SET disabled_at=NULL WHERE id=$1`, targetID)
	}
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23503" {
			return ErrUserHistory
		}
		return err
	}
	if action != "activate" {
		if _, err = tx.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id=$1`, targetID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM mobile_push_devices WHERE user_id=$1`, targetID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
