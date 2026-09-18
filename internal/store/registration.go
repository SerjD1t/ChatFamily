package store

import (
	"context"
	"strings"

	"familychat/internal/chat"
	"golang.org/x/crypto/bcrypt"
)

// Register creates a global account with basic messaging, without family membership.
func (p *Postgres) Register(email, name, password string, minPasswordLength int, surname ...string) (chat.User, error) {
	last := ""
	if len(surname) > 0 {
		last = surname[0]
	}
	first, last, validation := NormalizeUserNames(name, last)
	if validation != nil {
		return chat.User{}, validation
	}
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || name == "" || len(password) < minPasswordLength {
		return chat.User{}, chat.ErrInvalid
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return chat.User{}, err
	}
	u := chat.User{ID: id(), Email: email, Name: strings.TrimSpace(first + " " + last), FirstName: first, LastName: last, Permissions: map[chat.Permission]bool{}}
	_, err = p.Pool.Exec(context.Background(), `INSERT INTO users(id,email,display_name,password_hash,permissions,first_name,last_name) VALUES($1,$2,$3,$4,$7,$5,$6)`, u.ID, u.Email, u.Name, string(hash), first, last, permissions(u.Permissions))
	if err != nil {
		return chat.User{}, chat.ErrInvalid
	}
	return u, nil
}
