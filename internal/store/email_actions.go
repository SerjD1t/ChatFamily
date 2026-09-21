package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"familychat/internal/chat"
	"golang.org/x/crypto/bcrypt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

func NormalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value || len(value) > 254 || strings.ContainsAny(value, "\r\n") {
		return "", chat.ErrInvalid
	}
	return value, nil
}

// Empty token means an existing account / cooldown / ineligible account. Never
// expose which condition occurred through the anonymous HTTP response.
func (p *Postgres) IssueEmailAction(ctx context.Context, email, purpose, first, last, invite string) (string, error) {
	var err error
	email, err = NormalizeEmail(email)
	if err != nil {
		return "", err
	}
	if purpose != "register" && purpose != "reset" {
		return "", chat.ErrInvalid
	}
	if purpose == "register" {
		first, last, err = NormalizeUserNames(first, last)
		if err != nil {
			return "", err
		}
	}
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	// Expired entries do not become a permanent directory of unregistered email.
	if _, err = tx.Exec(ctx, `DELETE FROM email_actions WHERE expires_at<now()`); err != nil {
		return "", err
	}
	var uid *string
	var epoch *time.Time
	var existing bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE lower(email)=$1)`, email).Scan(&existing); err != nil {
		return "", err
	}
	if purpose == "register" && existing {
		return "", nil
	}
	if purpose == "reset" {
		if !existing {
			return "", nil
		}
		var idValue string
		var timeValue time.Time
		err = tx.QueryRow(ctx, `SELECT id,sessions_revoked_at FROM users WHERE lower(email)=$1 AND disabled_at IS NULL`, email).Scan(&idValue, &timeValue)
		if err != nil {
			return "", nil
		}
		uid = &idValue
		epoch = &timeValue
	}
	var inviteHash []byte
	if invite != "" {
		hash := sha256.Sum256([]byte(invite))
		inviteHash = hash[:]
		var valid bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM invitations WHERE token_hash=$1 AND lower(email)=$2 AND accepted_at IS NULL AND expires_at>now())`, inviteHash, email).Scan(&valid); err != nil {
			return "", err
		}
		if !valid {
			return "", chat.ErrForbidden
		}
	}
	bytes := make([]byte, 32)
	if _, err = rand.Read(bytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	hash := sha256.Sum256([]byte(token))
	expiry := time.Now().Add(24 * time.Hour)
	if purpose == "reset" {
		expiry = time.Now().Add(30 * time.Minute)
	}
	result, err := tx.Exec(ctx, `INSERT INTO email_actions(email,purpose,token_hash,user_id,first_name,last_name,invitation_hash,session_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(email,purpose) DO UPDATE SET token_hash=EXCLUDED.token_hash,user_id=EXCLUDED.user_id,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,invitation_hash=EXCLUDED.invitation_hash,session_epoch=EXCLUDED.session_epoch,created_at=now(),expires_at=EXCLUDED.expires_at WHERE email_actions.created_at<now()-interval '1 minute'`, email, purpose, hash[:], uid, first, last, inviteHash, epoch, expiry)
	if err != nil {
		return "", err
	}
	if result.RowsAffected() == 0 {
		return "", nil
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return token, nil
}
func (p *Postgres) InvitationEmail(ctx context.Context, token string) (string, error) {
	hash := sha256.Sum256([]byte(token))
	var email string
	err := p.Pool.QueryRow(ctx, `SELECT email FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()`, hash[:]).Scan(&email)
	if err != nil {
		return "", chat.ErrForbidden
	}
	return email, nil
}
func (p *Postgres) CancelEmailAction(ctx context.Context, token string) {
	hash := sha256.Sum256([]byte(token))
	_, _ = p.Pool.Exec(ctx, `DELETE FROM email_actions WHERE token_hash=$1`, hash[:])
}

// Consume + account creation/password update + revocation are one transaction.
// A caller cannot change the purpose, account, address or family from the link.
func (p *Postgres) ConsumeEmailAction(ctx context.Context, purpose, token, password string, min int) (string, error) {
	if (purpose != "register" && purpose != "reset") || len(token) != 43 || !utf8.ValidString(password) || utf8.RuneCountInString(password) < min || len(password) > 72 {
		return "", chat.ErrInvalid
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	hash := sha256.Sum256([]byte(token))
	var email, first, last string
	var uid *string
	var invitation []byte
	var epoch *time.Time
	err = tx.QueryRow(ctx, `DELETE FROM email_actions WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING email,user_id,first_name,last_name,invitation_hash,session_epoch`, hash[:], purpose).Scan(&email, &uid, &first, &last, &invitation, &epoch)
	if err != nil {
		return "", chat.ErrForbidden
	}
	if purpose == "reset" {
		result, err := tx.Exec(ctx, `UPDATE users SET password_hash=$1,sessions_revoked_at=clock_timestamp(),email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$2 AND lower(email)=$3 AND disabled_at IS NULL AND sessions_revoked_at=$4`, string(passwordHash), uid, email, epoch)
		if err != nil {
			return "", err
		}
		if result.RowsAffected() != 1 {
			return "", chat.ErrForbidden
		}
		if _, err = tx.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id=$1`, uid); err != nil {
			return "", err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM mobile_push_devices WHERE user_id=$1`, uid); err != nil {
			return "", err
		}
	} else {
		userID := id()
		if _, err = tx.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions,first_name,last_name,email_verified_at) VALUES($1,$2,$3,$4,'{}',$5,$6,now())`, userID, email, strings.TrimSpace(first+" "+last), string(passwordHash), first, last); err != nil {
			return "", chat.ErrInvalid
		}
		if len(invitation) > 0 {
			var family, role, relationship string
			if err = tx.QueryRow(ctx, `UPDATE invitations SET accepted_at=now() WHERE token_hash=$1 AND lower(email)=$2 AND accepted_at IS NULL AND expires_at>now() RETURNING family_id,family_role,relationship`, invitation, email).Scan(&family, &role, &relationship); err != nil {
				return "", chat.ErrForbidden
			}
			if _, err = tx.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role,relationship) VALUES($1,$2,$3,$4)`, family, userID, role, relationship); err != nil {
				return "", err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT id,$1 FROM conversations WHERE family_id=$2 AND kind='family'`, userID, family); err != nil {
				return "", err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return email, nil
}
func (p *Postgres) BootstrapPasswordAllowed() bool {
	var allowed bool
	err := p.Pool.QueryRow(context.Background(), `SELECT password_hash='' AND disabled_at IS NULL FROM users WHERE id='admin'`).Scan(&allowed)
	return err == nil && allowed
}
