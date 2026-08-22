package store

import (
	"context"
	"strings"

	"familychat/internal/chat"
)

func (p *Postgres) UpdateFamilyMember(actor chat.User, familyID, userID string, role chat.FamilyRole, relationship string, categories []chat.FamilyCategory) error {
	if !p.FamilyAdmin(actor.ID, familyID) {
		return chat.ErrForbidden
	}
	if role != chat.FamilyOwner && role != chat.FamilyAdmin && role != chat.FamilyMember {
		return chat.ErrInvalid
	}
	relationship = strings.TrimSpace(relationship)
	if relationship == "" {
		relationship = "Неопределено"
	}
	var currentRole chat.FamilyRole
	if err := p.Pool.QueryRow(context.Background(), `SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2`, familyID, userID).Scan(&currentRole); err != nil {
		return chat.ErrNotFound
	}
	if currentRole != role && !p.FamilyOwner(actor.ID, familyID) {
		return chat.ErrForbidden
	}
	if currentRole == chat.FamilyOwner && role != chat.FamilyOwner {
		var owners int
		if err := p.Pool.QueryRow(context.Background(), `SELECT count(*) FROM family_members WHERE family_id=$1 AND role='owner'`, familyID).Scan(&owners); err != nil {
			return err
		}
		if owners < 2 {
			return chat.ErrInvalid
		}
	}
	if categories == nil {
		_, err := p.Pool.Exec(context.Background(), `UPDATE family_members SET role=$1,relationship=$2 WHERE family_id=$3 AND user_id=$4`, role, relationship, familyID, userID)
		return err
	}
	normalized, err := normalizeFamilyCategories(categories)
	if err != nil {
		return err
	}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE family_members SET role=$1,relationship=$2 WHERE family_id=$3 AND user_id=$4`, role, relationship, familyID, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM family_member_categories WHERE family_id=$1 AND user_id=$2`, familyID, userID); err != nil {
		return err
	}
	for _, category := range normalized {
		if _, err = tx.Exec(ctx, `INSERT INTO family_member_categories(family_id,user_id,category) VALUES($1,$2,$3)`, familyID, userID, category); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func normalizeFamilyCategories(categories []chat.FamilyCategory) ([]string, error) {
	allowed := map[chat.FamilyCategory]bool{chat.FamilyChild: true, chat.FamilyParent: true, chat.FamilyGrandparent: true, chat.FamilyGuardian: true, chat.FamilyRelative: true}
	unique := map[chat.FamilyCategory]bool{}
	result := make([]string, 0, len(categories))
	for _, category := range categories {
		if !allowed[category] || unique[category] {
			if !allowed[category] {
				return nil, chat.ErrInvalid
			}
			continue
		}
		unique[category] = true
		result = append(result, string(category))
	}
	return result, nil
}
