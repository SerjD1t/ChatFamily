package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

var ErrWidgetPinLimit = errors.New("widget pin limit")

func (p *Postgres) WidgetPinIDs(user, family string) ([]string, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT p.item_id FROM widget_purchase_pins p
 JOIN family_members fm ON fm.user_id=p.user_id AND fm.family_id=p.family_id
 JOIN shopping_items s ON s.id=p.item_id AND s.family_id=p.family_id
 WHERE p.user_id=$1 AND p.family_id=$2 AND s.kind='purchase' AND s.completed_at IS NULL AND s.archived_at IS NULL
 ORDER BY p.created_at,p.item_id LIMIT 3`, user, family)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (p *Postgres) SetWidgetPin(actor chat.User, family, item string, pinned bool) error {
	if actor.ID == "" || family == "" {
		return chat.ErrForbidden
	}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serializes pins for one user/family and protects against membership removal.
	var member string
	err = tx.QueryRow(ctx, `SELECT user_id FROM family_members WHERE user_id=$1 AND family_id=$2 FOR UPDATE`, actor.ID, family).Scan(&member)
	if errors.Is(err, pgx.ErrNoRows) {
		return chat.ErrForbidden
	}
	if err != nil {
		return err
	}
	n, err := scanNeed(tx.QueryRow(ctx, `SELECT `+needColumns+` FROM shopping_items s WHERE s.id=$1 AND s.family_id=$2 FOR SHARE OF s`, item, family))
	if err != nil {
		return err
	}
	if !pinned {
		_, err = tx.Exec(ctx, `DELETE FROM widget_purchase_pins WHERE user_id=$1 AND item_id=$2`, actor.ID, item)
	} else {
		if n.Kind != "purchase" || n.CompletedAt != nil || n.ArchivedAt != nil || n.OwnerUserID != nil {
			return chat.ErrInvalid
		}
		// Completed/archived/transferred pins no longer consume available slots.
		_, err = tx.Exec(ctx, `DELETE FROM widget_purchase_pins p USING shopping_items s WHERE p.user_id=$1 AND p.family_id=$2 AND p.item_id=s.id AND (s.family_id IS DISTINCT FROM p.family_id OR s.kind!='purchase' OR s.completed_at IS NOT NULL OR s.archived_at IS NOT NULL)`, actor.ID, family)
		if err != nil {
			return err
		}
		var count int
		var exists bool
		err = tx.QueryRow(ctx, `SELECT count(*),COALESCE(bool_or(item_id=$3),false) FROM widget_purchase_pins WHERE user_id=$1 AND family_id=$2`, actor.ID, family, item).Scan(&count, &exists)
		if err != nil {
			return err
		}
		if count >= 3 && !exists {
			return ErrWidgetPinLimit
		}
		_, err = tx.Exec(ctx, `INSERT INTO widget_purchase_pins(user_id,family_id,item_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, actor.ID, family, item)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
