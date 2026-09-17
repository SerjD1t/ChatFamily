package store

import (
	"familychat/internal/chat"
)

func (p *Postgres) UpdateFamilyMember(actor chat.User, familyID, userID string, role chat.FamilyRole, relationship string, categories []chat.FamilyCategory) error {
	return p.changeFamily(actor.ID, familyID, userID, "update", FamilyAdminChange{Role: role, Relationship: relationship, Categories: categories}, false)
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
