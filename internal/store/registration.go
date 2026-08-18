package store

import (
	"context"
	"strings"

	"familychat/internal/chat"
	"golang.org/x/crypto/bcrypt"
)

// Register creates a global account without assigning it to a family.
func (p *Postgres) Register(email, name, password string, minPasswordLength int) (chat.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if email == "" || name == "" || len(password) < minPasswordLength {
		return chat.User{}, chat.ErrInvalid
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return chat.User{}, err
	}
	u := chat.User{ID: id(), Email: email, Name: name, Permissions: map[chat.Permission]bool{}}
	_, err = p.Pool.Exec(context.Background(), `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES($1,$2,$3,$4,'{}')`, u.ID, u.Email, u.Name, string(hash))
	if err != nil {
		return chat.User{}, chat.ErrInvalid
	}
	return u, nil
}
