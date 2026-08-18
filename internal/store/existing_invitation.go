package store

import (
	"context"
	"crypto/sha256"

	"familychat/internal/chat"
)

// AcceptInvitationForUser joins an already registered account to the invited family.
func (p *Postgres) AcceptInvitationForUser(token, userID string) error {
	hash := sha256.Sum256([]byte(token))
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var familyID, role, relationship string
	err = tx.QueryRow(ctx, `UPDATE invitations i SET accepted_at=now() FROM users u WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at>now() AND u.id=$2 AND lower(u.email)=lower(i.email) RETURNING i.family_id,i.family_role,i.relationship`, hash[:], userID).Scan(&familyID, &role, &relationship)
	if err != nil {
		return chat.ErrForbidden
	}
	_, err = tx.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role,relationship) VALUES($1,$2,$3,$4) ON CONFLICT (family_id,user_id) DO NOTHING`, familyID, userID, role, relationship)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT id,$1 FROM conversations WHERE family_id=$2 AND kind='family' ON CONFLICT DO NOTHING`, userID, familyID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
