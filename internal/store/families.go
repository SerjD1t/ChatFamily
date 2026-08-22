package store

import (
	"context"
	"strings"

	"familychat/internal/chat"
)

func (p *Postgres) Families(userID string) ([]chat.FamilyInfo, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT f.id,f.title,m.role FROM families f JOIN family_members m ON m.family_id=f.id WHERE m.user_id=$1 AND f.archived_at IS NULL ORDER BY f.title,f.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.FamilyInfo{}
	for rows.Next() {
		var f chat.FamilyInfo
		if err := rows.Scan(&f.ID, &f.Title, &f.Role); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (p *Postgres) FamilyAdmin(userID, familyID string) bool {
	var ok bool
	_ = p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM family_members WHERE family_id=$1 AND user_id=$2 AND role IN ('owner','admin'))`, familyID, userID).Scan(&ok)
	return ok
}

func (p *Postgres) FamilyOwner(userID, familyID string) bool {
	var ok bool
	_ = p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM family_members WHERE family_id=$1 AND user_id=$2 AND role='owner')`, familyID, userID).Scan(&ok)
	return ok
}

func (p *Postgres) FamilyForConversation(conversationID string) (string, bool) {
	var familyID string
	err := p.Pool.QueryRow(context.Background(), `SELECT COALESCE(family_id,'') FROM conversations WHERE id=$1 AND archived_at IS NULL`, conversationID).Scan(&familyID)
	return familyID, err == nil && familyID != ""
}

func (p *Postgres) CreateFamily(actor chat.User, title, parentFamilyID string) (chat.FamilyInfo, error) {
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 120 {
		return chat.FamilyInfo{}, chat.ErrInvalid
	}
	parentFamilyID = strings.TrimSpace(parentFamilyID)
	if parentFamilyID != "" {
		var member bool
		_ = p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM family_members WHERE family_id=$1 AND user_id=$2)`, parentFamilyID, actor.ID).Scan(&member)
		if !member {
			return chat.FamilyInfo{}, chat.ErrForbidden
		}
	}
	f := chat.FamilyInfo{ID: id(), Title: title, Role: chat.FamilyOwner}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.FamilyInfo{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO families(id,title,parent_family_id,created_by) VALUES($1,$2,NULLIF($3,''),$4)`, f.ID, f.Title, parentFamilyID, actor.ID); err != nil {
		return chat.FamilyInfo{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'owner')`, f.ID, actor.ID); err != nil {
		return chat.FamilyInfo{}, err
	}
	familyConversation := id()
	if _, err = tx.Exec(ctx, `INSERT INTO conversations(id,kind,title,family_id,created_by) VALUES($1,'family',$2,$3,$4)`, familyConversation, f.Title, f.ID, actor.ID); err != nil {
		return chat.FamilyInfo{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)`, familyConversation, actor.ID); err != nil {
		return chat.FamilyInfo{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return chat.FamilyInfo{}, err
	}
	return f, nil
}

func (p *Postgres) CreateGroupInFamily(actor chat.User, familyID, title string, ids []string) (chat.Conversation, error) {
	if !p.FamilyAdmin(actor.ID, familyID) {
		return chat.Conversation{}, chat.ErrForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 120 {
		return chat.Conversation{}, chat.ErrInvalid
	}
	c := chat.Conversation{ID: id(), Kind: chat.Group, Title: title, FamilyID: familyID}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return c, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO conversations(id,kind,title,family_id,created_by) VALUES($1,'group',$2,$3,$4)`, c.ID, c.Title, familyID, actor.ID); err != nil {
		return c, err
	}
	for _, uid := range unique(append(ids, actor.ID)) {
		if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT $1,fm.user_id FROM family_members fm WHERE fm.family_id=$2 AND fm.user_id=$3 ON CONFLICT DO NOTHING`, c.ID, familyID, uid); err != nil {
			return c, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return c, err
	}
	c.Members = p.members(c.ID)
	return c, nil
}
func (p *Postgres) FamilyUsers(familyID string) ([]chat.User, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT u.id,u.email,u.display_name,u.permissions,COALESCE(u.avatar_key,''),fm.relationship,COALESCE((SELECT array_agg(category ORDER BY category) FROM family_member_categories c WHERE c.family_id=fm.family_id AND c.user_id=u.id),ARRAY[]::text[]) FROM users u JOIN family_members fm ON fm.user_id=u.id WHERE fm.family_id=$1 ORDER BY u.display_name,u.id`, familyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.User{}
	for rows.Next() {
		var u chat.User
		var permissions []string
		var categories []string
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &permissions, &u.AvatarURL, &u.FamilyRelationship, &categories); err != nil {
			return nil, err
		}
		u.Permissions = permissionMap(permissions)
		u.FamilyCategories = toFamilyCategories(categories)
		if u.AvatarURL != "" {
			u.AvatarURL = avatarURL(u.ID)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func toFamilyCategories(categories []string) []chat.FamilyCategory {
	result := make([]chat.FamilyCategory, len(categories))
	for index, category := range categories {
		result[index] = chat.FamilyCategory(category)
	}
	return result
}
func (p *Postgres) DefaultFamilyID(userID string) (string, error) {
	var familyID string
	err := p.Pool.QueryRow(context.Background(), `SELECT family_id FROM family_members WHERE user_id=$1 ORDER BY joined_at,family_id LIMIT 1`, userID).Scan(&familyID)
	if err != nil {
		return "", err
	}
	return familyID, nil
}
func (p *Postgres) ContactsInFamily(actor chat.User, familyID string) ([]chat.User, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT u.id,u.display_name,COALESCE(u.avatar_key,''),COALESCE(fm.relationship,'Неопределено') FROM users u LEFT JOIN family_members fm ON fm.user_id=u.id AND fm.family_id=$2 ORDER BY (u.id=$1) DESC,u.display_name,u.id`, actor.ID, familyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.User{}
	for rows.Next() {
		var u chat.User
		if err := rows.Scan(&u.ID, &u.Name, &u.AvatarURL, &u.FamilyRelationship); err != nil {
			return nil, err
		}
		if u.AvatarURL != "" {
			u.AvatarURL = avatarURL(u.ID)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
