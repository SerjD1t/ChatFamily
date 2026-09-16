package store

import (
	"context"
	"errors"
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
	return p.ListNeeds(actor, familyID, false)
}
func (p *Postgres) AddShoppingItem(actor chat.User, familyID, title string, date time.Time) (chat.ShoppingItem, error) {
	value := date.Format("2006-01-02")
	return p.SaveNeed(actor, familyID, "", NeedInput{Title: &title, PlannedDate: &value})
}
func (p *Postgres) ToggleShoppingItem(actor chat.User, familyID, itemID string, completed bool) (chat.ShoppingItem, error) {
	return p.SaveNeed(actor, familyID, itemID, NeedInput{Completed: &completed})
}
func (p *Postgres) SetShoppingPlannedDate(actor chat.User, familyID, itemID string, date time.Time) (chat.ShoppingItem, error) {
	value := date.Format("2006-01-02")
	return p.SaveNeed(actor, familyID, itemID, NeedInput{PlannedDate: &value})
}
func (p *Postgres) DeleteShoppingItem(actor chat.User, familyID, itemID string) error {
	archived := true
	_, err := p.SaveNeed(actor, familyID, itemID, NeedInput{Archived: &archived})
	return err
}

func (p *Postgres) FamilyMember(userID, familyID string) bool {
	var ok bool
	_ = p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM family_members WHERE user_id=$1 AND family_id=$2)`, userID, familyID).Scan(&ok)
	return ok
}
