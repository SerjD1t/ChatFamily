package store

import (
	"context"
	"familychat/internal/chat"
	"regexp"
	"strings"
	"time"
)

var installationPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func ValidInstallationID(id string) bool { return installationPattern.MatchString(id) }

type MobileDevice struct{ InstallationID, UserID, Token string }

func (p *Postgres) SaveMobileDevice(ctx context.Context, uid, installation, token string) error {
	if !ValidInstallationID(installation) || len(token) < 20 || len(token) > 4096 || strings.ContainsAny(token, " \r\n\t") {
		return chat.ErrInvalid
	}
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Rotation/reinstallation must never deliver the same device token to two accounts.
	if _, err = tx.Exec(ctx, `DELETE FROM mobile_push_devices WHERE token=$1 AND installation_id<>$2`, token, installation); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mobile_push_devices(installation_id,user_id,token,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(installation_id) DO UPDATE SET user_id=EXCLUDED.user_id,token=EXCLUDED.token,updated_at=now(),expires_at=EXCLUDED.expires_at`, installation, uid, token, time.Now().Add(14*24*time.Hour)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (p *Postgres) DeleteMobileDevice(ctx context.Context, uid, installation string) error {
	_, err := p.Pool.Exec(ctx, `DELETE FROM mobile_push_devices WHERE installation_id=$1 AND user_id=$2`, installation, uid)
	return err
}
func (p *Postgres) MobileDevices(ctx context.Context, cid, excluded string) ([]MobileDevice, error) {
	rows, err := p.Pool.Query(ctx, `SELECT d.installation_id,d.user_id,d.token FROM mobile_push_devices d JOIN conversation_members m ON m.user_id=d.user_id JOIN users u ON u.id=d.user_id WHERE m.conversation_id=$1 AND d.user_id<>$2 AND d.expires_at>now() AND u.disabled_at IS NULL`, cid, excluded)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MobileDevice{}
	for rows.Next() {
		var d MobileDevice
		if err = rows.Scan(&d.InstallationID, &d.UserID, &d.Token); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
func (p *Postgres) RemoveInvalidMobileToken(ctx context.Context, token string) error {
	_, err := p.Pool.Exec(ctx, `DELETE FROM mobile_push_devices WHERE token=$1`, token)
	return err
}
