package store

import (
	"context"
	"encoding/json"
	"errors"
	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

type StorageSettings struct {
	Images     bool `json:"images"`
	Videos     bool `json:"videos"`
	PDFs       bool `json:"pdfs"`
	CacheDays  int  `json:"cacheDays"`
	OrphanDays int  `json:"orphanDays"`
	TrashDays  int  `json:"trashDays"`
}

func DefaultStorageSettings() StorageSettings { return StorageSettings{true, true, true, 30, 30, 30} }
func (s StorageSettings) Valid() bool {
	return s.CacheDays >= 1 && s.CacheDays <= 3650 && s.OrphanDays >= 7 && s.OrphanDays <= 3650 && s.TrashDays >= 7 && s.TrashDays <= 3650
}
func (p *Postgres) StorageSettings(ctx context.Context) (StorageSettings, error) {
	s := DefaultStorageSettings()
	var value string
	err := p.Pool.QueryRow(ctx, `SELECT value FROM application_settings WHERE key='storage_settings'`).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err = json.Unmarshal([]byte(value), &s); err != nil {
		return s, err
	}
	if !s.Valid() {
		return s, chat.ErrInvalid
	}
	return s, nil
}
func (p *Postgres) SetStorageSettings(ctx context.Context, actor chat.User, s StorageSettings) error {
	if !actor.Permissions[chat.ManageApplication] {
		return chat.ErrForbidden
	}
	if !s.Valid() {
		return chat.ErrInvalid
	}
	data, _ := json.Marshal(s)
	_, err := p.Pool.Exec(ctx, `INSERT INTO application_settings(key,value,updated_at) VALUES('storage_settings',$1,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, string(data))
	return err
}
func (p *Postgres) StorageReferences(ctx context.Context) (map[string]bool, error) {
	rows, err := p.Pool.Query(ctx, `SELECT object_key FROM attachments UNION SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := map[string]bool{}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			return nil, err
		}
		refs[key] = true
	}
	return refs, rows.Err()
}

type StorageEvent struct {
	At     string `json:"at"`
	Action string `json:"action"`
	Count  int    `json:"count"`
	Bytes  int64  `json:"bytes"`
	Status string `json:"status"`
}

func (p *Postgres) StorageHistory(ctx context.Context) ([]StorageEvent, error) {
	result := []StorageEvent{}
	var value string
	err := p.Pool.QueryRow(ctx, `SELECT value FROM application_settings WHERE key='storage_history'`).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal([]byte(value), &result)
	return result, err
}
func (p *Postgres) AddStorageEvent(ctx context.Context, event StorageEvent) error {
	events, err := p.StorageHistory(ctx)
	if err != nil {
		return err
	}
	events = append([]StorageEvent{event}, events...)
	if len(events) > 20 {
		events = events[:20]
	}
	data, _ := json.Marshal(events)
	_, err = p.Pool.Exec(ctx, `INSERT INTO application_settings(key,value,updated_at) VALUES('storage_history',$1,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, string(data))
	return err
}
