package store

import (
	"context"
	"familychat/internal/chat"
	"strings"
)

var GroupIcons = []string{"", "💬", "🏠", "👪", "❤️", "⭐", "🎉", "🎓", "⚽", "🎮", "🛒", "✈️", "💼", "🌿", "🐾", "🎵"}

func validGroupIcon(icon string) bool {
	for _, v := range GroupIcons {
		if v == icon {
			return true
		}
	}
	return false
}

// FamilyIDs is a presentation classification, never an access grant.
func (p *Postgres) enrichConversations(uid string, items []chat.Conversation) error {
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT c.id,c.icon,CASE WHEN c.kind<>'group' THEN '' WHEN c.group_owner_id=$1 THEN 'owner' WHEN cm.group_admin THEN 'admin' ELSE 'member' END, c.kind='group' AND (c.group_owner_id=$1 OR cm.group_admin OR cm.can_invite),ARRAY(SELECT fm.family_id FROM family_members fm WHERE fm.user_id=$1 AND c.kind='group' AND NOT EXISTS(SELECT 1 FROM conversation_members other WHERE other.conversation_id=c.id AND NOT EXISTS(SELECT 1 FROM family_members same WHERE same.family_id=fm.family_id AND same.user_id=other.user_id))),c.kind='group' AND NOT EXISTS(SELECT 1 FROM users u JOIN conversation_members om ON om.user_id=u.id AND om.conversation_id=c.id WHERE u.id=c.group_owner_id AND u.disabled_at IS NULL) FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$1 WHERE c.id=ANY($2)`, uid, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, icon, role string
		var invite, missing bool
		var families []string
		if err = rows.Scan(&id, &icon, &role, &invite, &families, &missing); err != nil {
			return err
		}
		for i := range items {
			if items[i].ID == id {
				items[i].Icon = icon
				items[i].GroupRole = role
				items[i].CanInvite = invite
				items[i].FamilyIDs = families
				items[i].OwnerUnavailable = missing
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	return p.enrichInterfamily(uid, items)
}

func (p *Postgres) createIndependentGroup(actor chat.User, title string, ids []string) (chat.Conversation, error) {
	title = strings.TrimSpace(title)
	if title == "" || len([]rune(title)) > 120 {
		return chat.Conversation{}, chat.ErrInvalid
	}
	ctx := context.Background()
	tx, e := p.Pool.Begin(ctx)
	if e != nil {
		return chat.Conversation{}, e
	}
	defer tx.Rollback(ctx)
	c := chat.Conversation{ID: id(), Kind: chat.Group, Title: title, GroupRole: "owner", CanInvite: true}
	for _, uid := range unique(append(ids, actor.ID)) {
		var active bool
		if e = tx.QueryRow(ctx, `SELECT disabled_at IS NULL FROM users WHERE id=$1 FOR SHARE`, uid).Scan(&active); e != nil || !active {
			return c, chat.ErrForbidden
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO conversations(id,kind,title,created_by,group_owner_id) VALUES($1,'group',$2,$3,$3)`, c.ID, title, actor.ID); e != nil {
		return c, e
	}
	for _, uid := range unique(append(ids, actor.ID)) {
		if _, e = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2)`, c.ID, uid); e != nil {
			return c, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return c, e
	}
	c.Members = p.members(c.ID)
	return c, nil
}

type GroupChange struct {
	UserID    string  `json:"userId"`
	Role      string  `json:"role"`
	CanInvite bool    `json:"canInvite"`
	Title     *string `json:"title"`
	Icon      *string `json:"icon"`
}

// Every membership/role mutation locks the same conversation row. Family roles
// and global administration do not bypass group membership or ownership.
func (p *Postgres) ChangeGroup(actor chat.User, cid, action string, in GroupChange) error {
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var owner string
	var active bool
	if err = tx.QueryRow(ctx, `SELECT disabled_at IS NULL FROM users WHERE id=$1 FOR SHARE`, actor.ID).Scan(&active); err != nil || !active {
		return chat.ErrForbidden
	}
	if err = tx.QueryRow(ctx, `SELECT COALESCE(group_owner_id,'') FROM conversations WHERE id=$1 AND kind='group' AND archived_at IS NULL FOR UPDATE`, cid).Scan(&owner); err != nil {
		return chat.ErrNotFound
	}
	var admin, invite bool
	if action == "recover" {
		var allowed, available bool
		if err = tx.QueryRow(ctx, `SELECT permissions @> ARRAY['manage_application']::text[] FROM users WHERE id=$1`, actor.ID).Scan(&allowed); err != nil || !allowed {
			return chat.ErrForbidden
		}
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users u JOIN conversation_members cm ON cm.user_id=u.id WHERE u.id=$1 AND u.disabled_at IS NULL AND cm.conversation_id=$2)`, owner, cid).Scan(&available); err != nil {
			return err
		}
		if available {
			return chat.ErrForbidden
		}
	} else {
		if err = tx.QueryRow(ctx, `SELECT group_admin,can_invite FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, cid, actor.ID).Scan(&admin, &invite); err != nil {
			return chat.ErrForbidden
		}
	}
	isOwner := owner == actor.ID
	manager := isOwner || admin
	switch action {
	case "add":
		if !manager && !invite {
			return chat.ErrForbidden
		}
		var ok bool
		if err = tx.QueryRow(ctx, `SELECT disabled_at IS NULL FROM users WHERE id=$1 FOR SHARE`, in.UserID).Scan(&ok); err != nil || !ok {
			return chat.ErrNotFound
		}
		_, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, cid, in.UserID)
	case "remove", "leave":
		if action == "leave" {
			in.UserID = actor.ID
		} else if !manager {
			return chat.ErrForbidden
		}
		if in.UserID == owner {
			return chat.ErrForbidden
		}
		var targetAdmin bool
		if err = tx.QueryRow(ctx, `SELECT group_admin FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, cid, in.UserID).Scan(&targetAdmin); err != nil {
			return chat.ErrNotFound
		}
		if action != "leave" && !isOwner && targetAdmin {
			return chat.ErrForbidden
		}
		_, err = tx.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, cid, in.UserID)
	case "permissions":
		if !manager || in.UserID == owner || (in.Role != "admin" && in.Role != "member") {
			return chat.ErrForbidden
		}
		var wasAdmin bool
		if err = tx.QueryRow(ctx, `SELECT group_admin FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, cid, in.UserID).Scan(&wasAdmin); err != nil {
			return chat.ErrNotFound
		}
		if !isOwner && (wasAdmin || in.Role == "admin") {
			return chat.ErrForbidden
		}
		_, err = tx.Exec(ctx, `UPDATE conversation_members SET group_admin=$3,can_invite=$4 WHERE conversation_id=$1 AND user_id=$2`, cid, in.UserID, in.Role == "admin", in.CanInvite)
	case "transfer", "recover":
		if action == "transfer" && !isOwner {
			return chat.ErrForbidden
		}
		var ok bool
		if err = tx.QueryRow(ctx, `SELECT u.disabled_at IS NULL FROM users u JOIN conversation_members cm ON cm.user_id=u.id WHERE cm.conversation_id=$1 AND u.id=$2 FOR SHARE OF u`, cid, in.UserID).Scan(&ok); err != nil || !ok {
			return chat.ErrInvalid
		}
		if _, err = tx.Exec(ctx, `UPDATE conversations SET group_owner_id=$2 WHERE id=$1`, cid, in.UserID); err == nil && owner != "" {
			_, err = tx.Exec(ctx, `UPDATE conversation_members SET group_admin=true WHERE conversation_id=$1 AND user_id=$2`, cid, owner)
		}
	case "settings":
		if !manager {
			return chat.ErrForbidden
		}
		if in.Title != nil {
			title := strings.TrimSpace(*in.Title)
			if title == "" || len([]rune(title)) > 120 {
				return chat.ErrInvalid
			}
			if _, err = tx.Exec(ctx, `UPDATE conversations SET title=$2 WHERE id=$1`, cid, title); err != nil {
				return err
			}
		}
		if in.Icon != nil {
			if !validGroupIcon(*in.Icon) {
				return chat.ErrInvalid
			}
			_, err = tx.Exec(ctx, `UPDATE conversations SET icon=$2 WHERE id=$1`, cid, *in.Icon)
		}
	case "archive":
		if !isOwner {
			return chat.ErrForbidden
		}
		_, err = tx.Exec(ctx, `UPDATE conversations SET archived_at=now() WHERE id=$1`, cid)
	default:
		return chat.ErrInvalid
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Postgres) GroupMembers(actor chat.User, cid string) ([]chat.User, error) {
	if !p.member(cid, actor.ID) {
		return nil, chat.ErrForbidden
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT u.id,u.display_name,u.disabled_at IS NOT NULL,CASE WHEN c.group_owner_id=u.id THEN 'owner' WHEN cm.group_admin THEN 'admin' ELSE 'member' END,(c.group_owner_id=u.id OR cm.group_admin OR cm.can_invite) FROM conversation_members cm JOIN conversations c ON c.id=cm.conversation_id JOIN users u ON u.id=cm.user_id WHERE c.id=$1 AND c.kind='group' ORDER BY u.display_name,u.id`, cid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.User{}
	for rows.Next() {
		var u chat.User
		if err = rows.Scan(&u.ID, &u.Name, &u.Disabled, &u.GroupRole, &u.CanInvite); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (p *Postgres) groupCandidates(actor chat.User, cid string) ([]chat.User, error) {
	var allowed bool
	err := p.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=$1 AND c.kind='group' AND c.archived_at IS NULL AND cm.user_id=$2 AND (c.group_owner_id=$2 OR cm.group_admin OR cm.can_invite))`, cid, actor.ID).Scan(&allowed)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, chat.ErrForbidden
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT id,display_name FROM users WHERE disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=$1 AND cm.user_id=users.id) ORDER BY display_name,id`, cid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chat.User{}
	for rows.Next() {
		var u chat.User
		if err = rows.Scan(&u.ID, &u.Name); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// Explicit recovery list contains no message bodies or attachments.
func (p *Postgres) OwnerlessGroups(actor chat.User) ([]map[string]any, error) {
	if !actor.Permissions[chat.ManageApplication] {
		return nil, chat.ErrForbidden
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT c.id,c.title,cm.user_id,u.display_name FROM conversations c LEFT JOIN conversation_members cm ON cm.conversation_id=c.id LEFT JOIN users u ON u.id=cm.user_id AND u.disabled_at IS NULL WHERE c.kind='group' AND c.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM users o JOIN conversation_members om ON om.user_id=o.id AND om.conversation_id=c.id WHERE o.id=c.group_owner_id AND o.disabled_at IS NULL) ORDER BY c.id,u.display_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	byID := map[string]int{}
	for rows.Next() {
		var id, title string
		var uid, name *string
		if err = rows.Scan(&id, &title, &uid, &name); err != nil {
			return nil, err
		}
		i, ok := byID[id]
		if !ok {
			i = len(out)
			byID[id] = i
			out = append(out, map[string]any{"id": id, "title": title, "members": []map[string]string{}})
		}
		if uid != nil && name != nil {
			out[i]["members"] = append(out[i]["members"].([]map[string]string), map[string]string{"id": *uid, "name": *name})
		}
	}
	return out, rows.Err()
}

func (p *Postgres) isGroup(cid string) bool {
	var kind string
	_ = p.Pool.QueryRow(context.Background(), `SELECT kind FROM conversations WHERE id=$1`, cid).Scan(&kind)
	return kind == "group"
}

func (p *Postgres) SetConversationIcon(actor chat.User, cid, icon string) error {
	if !validGroupIcon(icon) {
		return chat.ErrInvalid
	}
	if p.isGroup(cid) {
		return p.ChangeGroup(actor, cid, "settings", GroupChange{Icon: &icon})
	}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var fid string
	if err = tx.QueryRow(ctx, `SELECT family_id FROM conversations WHERE id=$1 AND kind='family' AND archived_at IS NULL FOR UPDATE`, cid).Scan(&fid); err != nil {
		return chat.ErrForbidden
	}
	var role string
	if err = tx.QueryRow(ctx, `SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2 FOR SHARE`, fid, actor.ID).Scan(&role); err != nil || (role != "owner" && role != "admin") {
		return chat.ErrForbidden
	}
	_, err = tx.Exec(ctx, `UPDATE conversations SET icon=$2 WHERE id=$1`, cid, icon)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
