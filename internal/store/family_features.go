package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

func (p *Postgres) UserPreferences(userID string) (chat.UserPreferences, error) {
	prefs := chat.UserPreferences{Locale: "ru", ColorScheme: "system"}
	err := p.Pool.QueryRow(context.Background(), `SELECT locale,color_scheme FROM user_preferences WHERE user_id=$1`, userID).Scan(&prefs.Locale, &prefs.ColorScheme)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return chat.UserPreferences{}, err
	}
	return prefs, nil
}

func (p *Postgres) SetUserPreferences(userID string, prefs chat.UserPreferences) (chat.UserPreferences, error) {
	if prefs.Locale != "ru" && prefs.Locale != "en" {
		return chat.UserPreferences{}, chat.ErrInvalid
	}
	if prefs.ColorScheme != "system" && prefs.ColorScheme != "light" && prefs.ColorScheme != "dark" && prefs.ColorScheme != "contrast" {
		return chat.UserPreferences{}, chat.ErrInvalid
	}
	_, err := p.Pool.Exec(context.Background(), `INSERT INTO user_preferences(user_id,locale,color_scheme,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(user_id) DO UPDATE SET locale=EXCLUDED.locale,color_scheme=EXCLUDED.color_scheme,updated_at=now()`, userID, prefs.Locale, prefs.ColorScheme)
	return prefs, err
}

func (p *Postgres) ShoppingItems(actor chat.User, familyID string) ([]chat.ShoppingItem, error) {
	if !p.FamilyMember(actor.ID, familyID) {
		return nil, chat.ErrForbidden
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT id,family_id,title,completed_at,created_by,created_at FROM shopping_items WHERE family_id=$1 ORDER BY completed_at NULLS FIRST,created_at DESC,id DESC`, familyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []chat.ShoppingItem{}
	for rows.Next() {
		var item chat.ShoppingItem
		if err := rows.Scan(&item.ID, &item.FamilyID, &item.Title, &item.CompletedAt, &item.CreatedBy, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (p *Postgres) AddShoppingItem(actor chat.User, familyID, title string) (chat.ShoppingItem, error) {
	if !p.FamilyMember(actor.ID, familyID) {
		return chat.ShoppingItem{}, chat.ErrForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 160 {
		return chat.ShoppingItem{}, chat.ErrInvalid
	}
	item := chat.ShoppingItem{ID: id(), FamilyID: familyID, Title: title, CreatedBy: actor.ID, CreatedAt: time.Now().UTC()}
	_, err := p.Pool.Exec(context.Background(), `INSERT INTO shopping_items(id,family_id,title,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`, item.ID, item.FamilyID, item.Title, item.CreatedBy, item.CreatedAt)
	return item, err
}

func (p *Postgres) ToggleShoppingItem(actor chat.User, familyID, itemID string, completed bool) (chat.ShoppingItem, error) {
	if !p.FamilyMember(actor.ID, familyID) {
		return chat.ShoppingItem{}, chat.ErrForbidden
	}
	var completedAt *time.Time
	if completed {
		now := time.Now().UTC()
		completedAt = &now
	}
	var item chat.ShoppingItem
	err := p.Pool.QueryRow(context.Background(), `UPDATE shopping_items SET completed_at=$1,updated_at=now() WHERE id=$2 AND family_id=$3 RETURNING id,family_id,title,completed_at,created_by,created_at`, completedAt, itemID, familyID).Scan(&item.ID, &item.FamilyID, &item.Title, &item.CompletedAt, &item.CreatedBy, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return chat.ShoppingItem{}, chat.ErrNotFound
	}
	return item, err
}

func (p *Postgres) DeleteShoppingItem(actor chat.User, familyID, itemID string) error {
	var createdBy string
	err := p.Pool.QueryRow(context.Background(), `SELECT created_by FROM shopping_items WHERE id=$1 AND family_id=$2`, itemID, familyID).Scan(&createdBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return chat.ErrNotFound
	}
	if err != nil {
		return err
	}
	if createdBy != actor.ID && !p.FamilyAdmin(actor.ID, familyID) {
		return chat.ErrForbidden
	}
	_, err = p.Pool.Exec(context.Background(), `DELETE FROM shopping_items WHERE id=$1 AND family_id=$2`, itemID, familyID)
	return err
}

func (p *Postgres) FamilyMember(userID, familyID string) bool {
	var ok bool
	_ = p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM family_members WHERE user_id=$1 AND family_id=$2)`, userID, familyID).Scan(&ok)
	return ok
}
