package store

import (
	"context"
	"errors"
	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
	"strings"
)

var ErrLastFamilyOwner = errors.New("family must retain an active owner")

type ApplicationFamily struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Members  int      `json:"members"`
	Owners   []string `json:"owners"`
	Archived bool     `json:"archived"`
}
type ApplicationFamilyUser struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Role         chat.FamilyRole `json:"role"`
	Relationship string          `json:"relationship"`
	Categories   []string        `json:"categories"`
	Disabled     bool            `json:"disabled"`
}
type FamilyAdminChange struct {
	Title        string                `json:"title"`
	Role         chat.FamilyRole       `json:"role"`
	Relationship string                `json:"relationship"`
	Categories   []chat.FamilyCategory `json:"categories"`
}

func (p *Postgres) applicationFamilyAccess(ctx context.Context, actorID string) error {
	var ok bool
	if err := p.Pool.QueryRow(ctx, `SELECT disabled_at IS NULL AND permissions @> ARRAY['manage_application']::text[] FROM users WHERE id=$1`, actorID).Scan(&ok); err != nil || !ok {
		return chat.ErrForbidden
	}
	return nil
}

func (p *Postgres) ApplicationFamilies(actorID, search string, offset int) ([]ApplicationFamily, int, error) {
	ctx := context.Background()
	if err := p.applicationFamilyAccess(ctx, actorID); err != nil {
		return nil, 0, err
	}
	if offset < 0 {
		return nil, 0, chat.ErrInvalid
	}
	search = strings.ToLower(strings.TrimSpace(search))
	var total int
	if err := p.Pool.QueryRow(ctx, `SELECT count(*) FROM families WHERE strpos(lower(title),$1)>0`, search).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := p.Pool.Query(ctx, `SELECT f.id,f.title,(SELECT count(*) FROM family_members m WHERE m.family_id=f.id),
 COALESCE((SELECT array_agg(u.display_name ORDER BY u.display_name,u.id) FROM family_members m JOIN users u ON u.id=m.user_id WHERE m.family_id=f.id AND m.role='owner'),ARRAY[]::text[]), f.archived_at IS NOT NULL
 FROM families f WHERE strpos(lower(f.title),$1)>0 ORDER BY lower(f.title),f.id LIMIT 25 OFFSET $2`, search, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []ApplicationFamily{}
	for rows.Next() {
		var f ApplicationFamily
		if err = rows.Scan(&f.ID, &f.Title, &f.Members, &f.Owners, &f.Archived); err != nil {
			return nil, 0, err
		}
		out = append(out, f)
	}
	return out, total, rows.Err()
}

func (p *Postgres) ApplicationFamilyUsers(actorID, familyID, search string, offset int, candidates bool) ([]ApplicationFamilyUser, int, error) {
	ctx := context.Background()
	if err := p.applicationFamilyAccess(ctx, actorID); err != nil {
		return nil, 0, err
	}
	if offset < 0 {
		return nil, 0, chat.ErrInvalid
	}
	var exists bool
	if err := p.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM families WHERE id=$1)`, familyID).Scan(&exists); err != nil {
		return nil, 0, err
	}
	if !exists {
		return nil, 0, chat.ErrNotFound
	}
	search = strings.ToLower(strings.TrimSpace(search))
	filter := ` FROM users u LEFT JOIN family_members m ON m.user_id=u.id AND m.family_id=$1 WHERE ((NOT $3 AND m.user_id IS NOT NULL) OR ($3 AND m.user_id IS NULL AND u.disabled_at IS NULL)) AND strpos(lower(u.display_name),$2)>0`
	var total int
	if err := p.Pool.QueryRow(ctx, `SELECT count(*)`+filter, familyID, search, candidates).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := p.Pool.Query(ctx, `SELECT u.id,u.display_name,COALESCE(m.role,'member'),COALESCE(m.relationship,''),COALESCE((SELECT array_agg(category ORDER BY category) FROM family_member_categories c WHERE c.family_id=$1 AND c.user_id=u.id),ARRAY[]::text[]),u.disabled_at IS NOT NULL`+filter+` ORDER BY lower(u.display_name),u.id LIMIT 25 OFFSET $4`, familyID, search, candidates, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []ApplicationFamilyUser{}
	for rows.Next() {
		var u ApplicationFamilyUser
		if err = rows.Scan(&u.ID, &u.Name, &u.Role, &u.Relationship, &u.Categories, &u.Disabled); err != nil {
			return nil, 0, err
		}
		out = append(out, u)
	}
	return out, total, rows.Err()
}

// All membership/role changes serialize on the family row, including ordinary family administration.
func (p *Postgres) changeFamily(actorID, familyID, userID, action string, in FamilyAdminChange, applicationOnly bool) error {
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var archived bool
	if err = tx.QueryRow(ctx, `SELECT archived_at IS NOT NULL FROM families WHERE id=$1 FOR UPDATE`, familyID).Scan(&archived); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return chat.ErrNotFound
		}
		return err
	}
	var allowed bool
	var actorRole string
	if applicationOnly {
		if err = tx.QueryRow(ctx, `SELECT disabled_at IS NULL AND permissions @> ARRAY['manage_application']::text[] FROM users WHERE id=$1`, actorID).Scan(&allowed); err != nil || !allowed {
			return chat.ErrForbidden
		}
	} else {
		if err = tx.QueryRow(ctx, `SELECT m.role FROM family_members m JOIN users u ON u.id=m.user_id WHERE m.family_id=$1 AND m.user_id=$2 AND u.disabled_at IS NULL`, familyID, actorID).Scan(&actorRole); err != nil || (actorRole != "owner" && actorRole != "admin") {
			return chat.ErrForbidden
		}
	}
	if archived {
		return chat.ErrInvalid
	}
	if action == "rename" {
		title := strings.TrimSpace(in.Title)
		if title == "" || len([]rune(title)) > 120 {
			return chat.ErrInvalid
		}
		if _, err = tx.Exec(ctx, `UPDATE families SET title=$2 WHERE id=$1`, familyID, title); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE conversations SET title=$2 WHERE family_id=$1 AND kind='family'`, familyID, title); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	var current chat.FamilyRole
	err = tx.QueryRow(ctx, `SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2`, familyID, userID).Scan(&current)
	if action == "add" && err == nil {
		return tx.Commit(ctx)
	} // Repeated add cannot overwrite an existing role.
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if action == "remove" && errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if action == "update" && err != nil {
		return chat.ErrNotFound
	}
	if !applicationOnly && current != in.Role && actorRole != "owner" {
		return chat.ErrForbidden
	}
	if action == "remove" || (current == chat.FamilyOwner && in.Role != chat.FamilyOwner) {
		if current == chat.FamilyOwner {
			var count int
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM family_members m JOIN users u ON u.id=m.user_id WHERE m.family_id=$1 AND m.role='owner' AND m.user_id<>$2 AND u.disabled_at IS NULL`, familyID, userID).Scan(&count); err != nil {
				return err
			}
			if count == 0 {
				return ErrLastFamilyOwner
			}
		}
	}
	if action == "remove" {
		if _, err = tx.Exec(ctx, `DELETE FROM family_member_categories WHERE family_id=$1 AND user_id=$2`, familyID, userID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM conversation_members WHERE user_id=$2 AND conversation_id IN (SELECT id FROM conversations WHERE family_id=$1)`, familyID, userID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM family_members WHERE family_id=$1 AND user_id=$2`, familyID, userID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE invitations SET expires_at=now() WHERE family_id=$1 AND lower(email)=(SELECT lower(email) FROM users WHERE id=$2) AND accepted_at IS NULL`, familyID, userID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if action != "add" && action != "update" {
		return chat.ErrInvalid
	}
	if in.Role != chat.FamilyOwner && in.Role != chat.FamilyAdmin && in.Role != chat.FamilyMember {
		return chat.ErrInvalid
	}
	relationship := strings.TrimSpace(in.Relationship)
	if len([]rune(relationship)) > 80 {
		return chat.ErrInvalid
	}
	if relationship == "" {
		relationship = "Неопределено"
	}
	categories, err := normalizeFamilyCategories(in.Categories)
	if err != nil {
		return err
	}
	if action == "add" || in.Role == chat.FamilyOwner {
		var active bool
		if err = tx.QueryRow(ctx, `SELECT disabled_at IS NULL FROM users WHERE id=$1`, userID).Scan(&active); err != nil || !active {
			return chat.ErrInvalid
		}
	}
	if action == "add" {
		if _, err = tx.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role,relationship) VALUES($1,$2,$3,$4)`, familyID, userID, in.Role, relationship); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT id,$2 FROM conversations WHERE family_id=$1 AND kind='family' AND archived_at IS NULL ON CONFLICT DO NOTHING`, familyID, userID); err != nil {
			return err
		}
	} else {
		if _, err = tx.Exec(ctx, `UPDATE family_members SET role=$3,relationship=$4 WHERE family_id=$1 AND user_id=$2`, familyID, userID, in.Role, relationship); err != nil {
			return err
		}
	}
	if in.Categories != nil {
		if _, err = tx.Exec(ctx, `DELETE FROM family_member_categories WHERE family_id=$1 AND user_id=$2`, familyID, userID); err != nil {
			return err
		}
		for _, category := range categories {
			if _, err = tx.Exec(ctx, `INSERT INTO family_member_categories(family_id,user_id,category) VALUES($1,$2,$3)`, familyID, userID, category); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func (p *Postgres) ChangeApplicationFamily(actorID, familyID, userID, action string, in FamilyAdminChange) error {
	// Check before lookup as well: unauthorized callers cannot probe family IDs.
	if err := p.applicationFamilyAccess(context.Background(), actorID); err != nil {
		return err
	}
	return p.changeFamily(actorID, familyID, userID, action, in, true)
}
