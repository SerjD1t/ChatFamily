package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"time"

	"familychat/internal/chat"
	"golang.org/x/crypto/bcrypt"
)

func (p *Postgres) CreateInvitation(actor chat.User, email string, granted []chat.Permission, expiresAt time.Time) (string, error) {
	if !actor.Permissions[chat.ManageUsers] {
		return "", chat.ErrForbidden
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !expiresAt.After(time.Now()) {
		return "", chat.ErrInvalid
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	hash := sha256.Sum256([]byte(token))
	permissions := make([]string, len(granted))
	for i, permission := range granted {
		permissions[i] = string(permission)
	}
	_, err := p.Pool.Exec(context.Background(), `INSERT INTO invitations(id,email,token_hash,permissions,expires_at) VALUES($1,$2,$3,$4,$5)`, id(), email, hash[:], permissions, expiresAt.UTC())
	return token, err
}

func (p *Postgres) AcceptInvitation(token, name, password string) (chat.User, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(password) < 5 {
		return chat.User{}, chat.ErrInvalid
	}
	hash := sha256.Sum256([]byte(token))
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.User{}, err
	}
	defer tx.Rollback(ctx)
	var email string
	var permissions []string
	err = tx.QueryRow(ctx, `UPDATE invitations SET accepted_at=now() WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() RETURNING email,permissions`, hash[:]).Scan(&email, &permissions)
	if err != nil {
		return chat.User{}, chat.ErrForbidden
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return chat.User{}, err
	}
	u := chat.User{ID: id(), Email: email, Name: name, Permissions: permissionMap(permissions)}
	if _, err = tx.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES($1,$2,$3,$4,$5)`, u.ID, u.Email, u.Name, string(passwordHash), permissions); err != nil {
		return chat.User{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return chat.User{}, err
	}
	return u, nil
}

func (p *Postgres) Authenticate(email, password string) (chat.User, bool) {
	var user chat.User
	var permissions []string
	var passwordHash string
	err := p.Pool.QueryRow(context.Background(), `SELECT id,email,display_name,password_hash,permissions FROM users WHERE lower(email)=lower($1)`, strings.TrimSpace(email)).Scan(&user.ID, &user.Email, &user.Name, &passwordHash, &permissions)
	if err != nil || passwordHash == "" || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil {
		return chat.User{}, false
	}
	user.Permissions = permissionMap(permissions)
	return user, true
}
