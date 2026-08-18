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

func (p *Postgres) CreateInvitation(actor chat.User, familyID, email string, granted []chat.Permission, role chat.FamilyRole, relationship string, expiresAt time.Time) (string, error) {
	if !p.FamilyAdmin(actor.ID, familyID) {
		return "", chat.ErrForbidden
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !expiresAt.After(time.Now()) {
		return "", chat.ErrInvalid
	}
	if role == "" {
		role = chat.FamilyMember
	}
	if role != chat.FamilyMember && role != chat.FamilyAdmin {
		return "", chat.ErrInvalid
	}
	if relationship = strings.TrimSpace(relationship); relationship == "" {
		relationship = "Неопределено"
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
	_, err := p.Pool.Exec(context.Background(), `INSERT INTO invitations(id,family_id,email,token_hash,permissions,family_role,relationship,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id(), familyID, email, hash[:], permissions, role, relationship, expiresAt.UTC())
	return token, err
}

func (p *Postgres) AcceptInvitation(token, name, password string, minPasswordLength int) (chat.User, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(password) < minPasswordLength {
		return chat.User{}, chat.ErrInvalid
	}
	hash := sha256.Sum256([]byte(token))
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.User{}, err
	}
	defer tx.Rollback(ctx)
	var email, familyID, relationship string
	var role chat.FamilyRole
	var permissions []string
	err = tx.QueryRow(ctx, `UPDATE invitations SET accepted_at=now() WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() RETURNING email,family_id,permissions,family_role,relationship`, hash[:]).Scan(&email, &familyID, &permissions, &role, &relationship)
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
	if _, err = tx.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role,relationship) VALUES($1,$2,$3,$4)`, familyID, u.ID, role, relationship); err != nil {
		return chat.User{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT id,$1 FROM conversations WHERE family_id=$2 AND kind='family'`, u.ID, familyID); err != nil {
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

func (p *Postgres) ChangePassword(userID, currentPassword, newPassword string, minPasswordLength int) error {
	if len(newPassword) < minPasswordLength {
		return chat.ErrInvalid
	}
	var hash string
	if err := p.Pool.QueryRow(context.Background(), `SELECT password_hash FROM users WHERE id=$1`, userID).Scan(&hash); err != nil {
		return chat.ErrNotFound
	}
	if hash == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(currentPassword)) != nil {
		return chat.ErrForbidden
	}
	return p.SetPassword(userID, newPassword, minPasswordLength)
}

func (p *Postgres) SetPassword(userID, newPassword string, minPasswordLength int) error {
	if len(newPassword) < minPasswordLength {
		return chat.ErrInvalid
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = p.Pool.Exec(context.Background(), `UPDATE users SET password_hash=$1 WHERE id=$2`, string(newHash), userID)
	return err
}
