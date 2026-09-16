package store

import (
	"context"
	"familychat/internal/chat"
	"strings"
	"unicode/utf8"
)

func NormalizeUserNames(first, last string) (string, string, error) {
	first = strings.TrimSpace(first)
	last = strings.TrimSpace(last)
	if first == "" || utf8.RuneCountInString(first) > 120 || utf8.RuneCountInString(last) > 120 || strings.ContainsAny(first+last, "\r\n\t") {
		return "", "", chat.ErrInvalid
	}
	return first, last, nil
}
func (p *Postgres) UpdateUserNames(uid, first, last string) (chat.User, error) {
	first, last, err := NormalizeUserNames(first, last)
	if err != nil {
		return chat.User{}, err
	}
	tag, err := p.Pool.Exec(context.Background(), `UPDATE users SET first_name=$2,last_name=$3,display_name=concat_ws(' ',$2::text,NULLIF($3::text,'')) WHERE id=$1 AND disabled_at IS NULL`, uid, first, last)
	if err != nil {
		return chat.User{}, err
	}
	if tag.RowsAffected() != 1 {
		return chat.User{}, chat.ErrNotFound
	}
	u, ok := p.User(uid)
	if !ok {
		return u, chat.ErrNotFound
	}
	return u, nil
}
