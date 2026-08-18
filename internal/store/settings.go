package store

import (
	"context"
	"strconv"

	"familychat/internal/chat"
)

const defaultPasswordMinLength = 12

func (p *Postgres) PasswordMinLength() int {
	var value string
	if err := p.Pool.QueryRow(context.Background(), `SELECT value FROM application_settings WHERE key='min_password_length'`).Scan(&value); err != nil {
		return defaultPasswordMinLength
	}
	length, err := strconv.Atoi(value)
	if err != nil || length < 8 || length > 128 {
		return defaultPasswordMinLength
	}
	return length
}

func (p *Postgres) SetPasswordMinLength(actor chat.User, length int) error {
	if !actor.Permissions[chat.ManageApplication] {
		return chat.ErrForbidden
	}
	if length < 8 || length > 128 {
		return chat.ErrInvalid
	}
	_, err := p.Pool.Exec(context.Background(), `INSERT INTO application_settings(key,value,updated_at) VALUES('min_password_length',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, strconv.Itoa(length))
	return err
}
