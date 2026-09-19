package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
	"strings"
)

type InterfamilyInput struct {
	FamilyID   string   `json:"familyId"`
	Title      string   `json:"title"`
	Icon       string   `json:"icon"`
	Members    []string `json:"members"`
	Token      string   `json:"token"`
	RequestKey string   `json:"requestKey"`
	Version    int64    `json:"version"`
}

func (p *Postgres) enrichInterfamily(uid string, items []chat.Conversation) error {
	ids := []string{}
	for _, c := range items {
		if c.Kind == "interfamily" {
			ids = append(ids, c.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, e := p.Pool.Query(context.Background(), `SELECT conversation_id,array_agg(family_id ORDER BY family_id) FROM interfamily_representatives WHERE user_id=$1 AND conversation_id=ANY($2) GROUP BY conversation_id`, uid, ids)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var cid string
		var families []string
		if e = rows.Scan(&cid, &families); e != nil {
			return e
		}
		for i := range items {
			if items[i].ID == cid {
				items[i].FamilyIDs = families
			}
		}
	}
	return rows.Err()
}
func (p *Postgres) InterfamilyCandidates(actor chat.User, fid string) ([]chat.User, error) {
	if !p.FamilyAdmin(actor.ID, fid) {
		return nil, chat.ErrForbidden
	}
	rows, e := p.Pool.Query(context.Background(), `SELECT u.id,u.display_name FROM users u JOIN family_members fm ON fm.user_id=u.id WHERE fm.family_id=$1 AND u.disabled_at IS NULL ORDER BY u.display_name,u.id`, fid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []chat.User{}
	for rows.Next() {
		var u chat.User
		if e = rows.Scan(&u.ID, &u.Name); e != nil {
			return nil, e
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

type InterfamilyChat struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Icon        string   `json:"icon"`
	State       string   `json:"state"`
	OriginID    string   `json:"originId"`
	OriginTitle string   `json:"originTitle"`
	TargetID    string   `json:"targetId"`
	TargetTitle string   `json:"targetTitle"`
	Members     []string `json:"members"`
	Version     int64    `json:"version"`
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}
func newInterfamilyToken() (string, error) {
	b := make([]byte, 24)
	_, e := rand.Read(b)
	return hex.EncodeToString(b), e
}

// The family row is locked first, like family administration, so removing a
// representative or changing an administrator cannot race with approval.
func interfamilyAdmin(ctx context.Context, tx pgx.Tx, actor, fid string) error {
	var exists string
	if e := tx.QueryRow(ctx, `SELECT id FROM families WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, fid).Scan(&exists); e != nil {
		return chat.ErrForbidden
	}
	var allowed bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM family_members fm JOIN users u ON u.id=fm.user_id WHERE fm.family_id=$1 AND fm.user_id=$2 AND fm.role IN ('owner','admin') AND u.disabled_at IS NULL)`, fid, actor).Scan(&allowed); e != nil {
		return e
	}
	if !allowed {
		return chat.ErrForbidden
	}
	return nil
}
func setInterfamilyRepresentatives(ctx context.Context, tx pgx.Tx, cid, fid string, ids []string) error {
	ids = unique(ids)
	if len(ids) > 200 {
		return chat.ErrInvalid
	}
	for _, uid := range ids {
		var ok bool
		if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM family_members fm JOIN users u ON u.id=fm.user_id WHERE fm.family_id=$1 AND fm.user_id=$2 AND u.disabled_at IS NULL)`, fid, uid).Scan(&ok); e != nil {
			return e
		}
		if !ok {
			return chat.ErrForbidden
		}
	}
	if ids == nil {
		ids = []string{}
	}
	// Keep unchanged rows and their receipt cursors intact.
	if _, e := tx.Exec(ctx, `DELETE FROM interfamily_representatives WHERE conversation_id=$1 AND family_id=$2 AND NOT(user_id=ANY($3::text[]))`, cid, fid, ids); e != nil {
		return e
	}
	for _, uid := range ids {
		if _, e := tx.Exec(ctx, `INSERT INTO interfamily_representatives VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, cid, fid, uid); e != nil {
			return e
		}
	}
	return nil
}
func (p *Postgres) InterfamilyChats(actor chat.User, fid string) ([]InterfamilyChat, error) {
	if !p.FamilyAdmin(actor.ID, fid) {
		return nil, chat.ErrForbidden
	}
	rows, e := p.Pool.Query(context.Background(), `SELECT c.id,c.title,c.icon,b.state,b.origin_family_id,f.title,COALESCE(b.target_family_id,''),COALESCE(t.title,''),b.version,ARRAY(SELECT r.user_id FROM interfamily_representatives r WHERE r.conversation_id=c.id AND r.family_id=$1 ORDER BY r.user_id) FROM interfamily_chats b JOIN conversations c ON c.id=b.conversation_id JOIN families f ON f.id=b.origin_family_id LEFT JOIN families t ON t.id=b.target_family_id WHERE (b.origin_family_id=$1 OR b.target_family_id=$1) AND b.state<>'closed' ORDER BY c.created_at DESC`, fid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []InterfamilyChat{}
	for rows.Next() {
		var v InterfamilyChat
		if e = rows.Scan(&v.ID, &v.Title, &v.Icon, &v.State, &v.OriginID, &v.OriginTitle, &v.TargetID, &v.TargetTitle, &v.Version, &v.Members); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (p *Postgres) CreateInterfamily(actor chat.User, in InterfamilyInput) (map[string]string, error) {
	ctx := context.Background()
	tx, e := p.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if e = interfamilyAdmin(ctx, tx, actor.ID, in.FamilyID); e != nil {
		return nil, e
	}
	title := strings.TrimSpace(in.Title)
	if title == "" || len([]rune(title)) > 120 || !validGroupIcon(in.Icon) || len(in.RequestKey) < 16 || len(in.RequestKey) > 100 || len(in.Members) == 0 {
		return nil, chat.ErrInvalid
	}
	// A repeated create never duplicates a chat; recover the code using renew.
	key := actor.ID + ":" + in.FamilyID + ":" + in.RequestKey
	var existing string
	e = tx.QueryRow(ctx, `SELECT conversation_id FROM interfamily_chats WHERE request_key=$1`, key).Scan(&existing)
	if e == nil {
		return map[string]string{"id": existing}, nil
	}
	if e != pgx.ErrNoRows {
		return nil, e
	}
	token, e := newInterfamilyToken()
	if e != nil {
		return nil, e
	}
	cid := id()
	if _, e = tx.Exec(ctx, `INSERT INTO conversations(id,kind,title,icon,created_by) VALUES($1,'interfamily',$2,$3,$4)`, cid, title, in.Icon, actor.ID); e != nil {
		return nil, e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO interfamily_chats(conversation_id,origin_family_id,token_hash,request_key) VALUES($1,$2,$3,$4)`, cid, in.FamilyID, tokenHash(token), key); e != nil {
		return nil, e
	}
	if e = setInterfamilyRepresentatives(ctx, tx, cid, in.FamilyID, in.Members); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return map[string]string{"id": cid, "token": token}, nil
}
func (p *Postgres) ChangeInterfamily(actor chat.User, cid, action string, in InterfamilyInput) (map[string]string, error) {
	ctx := context.Background()
	tx, e := p.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if action == "join" {
		if len(in.Token) != 48 || len(in.Members) == 0 {
			return nil, chat.ErrInvalid
		}
		if e = tx.QueryRow(ctx, `SELECT conversation_id FROM interfamily_chats WHERE token_hash=$1 AND expires_at>now()`, tokenHash(in.Token)).Scan(&cid); e != nil {
			return nil, chat.ErrNotFound
		}
	}
	// Lock both families in deterministic order before the chat. This serializes
	// approval with family removal and prevents resurrecting revoked membership.
	locked, e := tx.Query(ctx, `SELECT id FROM families WHERE id=$2 OR id IN (SELECT origin_family_id FROM interfamily_chats WHERE conversation_id=$1 UNION SELECT target_family_id FROM interfamily_chats WHERE conversation_id=$1) ORDER BY id FOR UPDATE`, cid, in.FamilyID)
	if e != nil {
		return nil, e
	}
	for locked.Next() {
	}
	e = locked.Err()
	locked.Close()
	if e != nil {
		return nil, e
	}
	if e = interfamilyAdmin(ctx, tx, actor.ID, in.FamilyID); e != nil {
		return nil, e
	}
	var origin, target, state string
	var version int64
	if e = tx.QueryRow(ctx, `SELECT origin_family_id,COALESCE(target_family_id,''),state,version FROM interfamily_chats WHERE conversation_id=$1 FOR UPDATE`, cid).Scan(&origin, &target, &state, &version); e != nil {
		return nil, chat.ErrNotFound
	}
	result := map[string]string{"id": cid}
	if action == "join" {
		if origin == in.FamilyID {
			return nil, chat.ErrInvalid
		}
		var validToken bool
		if e = tx.QueryRow(ctx, `SELECT token_hash=$2 AND expires_at>now() FROM interfamily_chats WHERE conversation_id=$1`, cid, tokenHash(in.Token)).Scan(&validToken); e != nil || !validToken {
			return nil, chat.ErrNotFound
		}
		if state == "requested" && target == in.FamilyID {
			return result, nil
		}
		if state != "pending" || target != "" {
			return nil, chat.ErrForbidden
		}
		if _, e = tx.Exec(ctx, `UPDATE interfamily_chats SET target_family_id=$2,state='requested',version=version+1 WHERE conversation_id=$1`, cid, in.FamilyID); e != nil {
			return nil, e
		}
		if e = setInterfamilyRepresentatives(ctx, tx, cid, in.FamilyID, in.Members); e != nil {
			return nil, e
		}
	} else {
		if in.FamilyID != origin && in.FamilyID != target {
			return nil, chat.ErrForbidden
		}
		if state == "closed" {
			if action == "close" {
				return result, nil
			}
			return nil, chat.ErrForbidden
		}
		if in.Version != version {
			return nil, ErrShareConflict
		}
		switch action {
		case "approve":
			if in.FamilyID != origin || state != "requested" {
				return nil, chat.ErrForbidden
			}
			var eligible bool
			if e = tx.QueryRow(ctx, `SELECT count(DISTINCT r.family_id)=2 FROM interfamily_representatives r JOIN users u ON u.id=r.user_id JOIN families f ON f.id=r.family_id WHERE r.conversation_id=$1 AND u.disabled_at IS NULL AND f.archived_at IS NULL`, cid).Scan(&eligible); e != nil {
				return nil, e
			}
			if !eligible {
				return nil, chat.ErrInvalid
			}
			if _, e = tx.Exec(ctx, `UPDATE interfamily_chats SET state='active',token_hash=NULL WHERE conversation_id=$1`, cid); e != nil {
				return nil, e
			}
			_, e = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) SELECT conversation_id,user_id FROM interfamily_representatives WHERE conversation_id=$1 ON CONFLICT DO NOTHING`, cid)
		case "members":
			e = setInterfamilyRepresentatives(ctx, tx, cid, in.FamilyID, in.Members)
		case "settings":
			title := strings.TrimSpace(in.Title)
			if title == "" || len([]rune(title)) > 120 || !validGroupIcon(in.Icon) {
				return nil, chat.ErrInvalid
			}
			_, e = tx.Exec(ctx, `UPDATE conversations SET title=$2,icon=$3 WHERE id=$1`, cid, title, in.Icon)
		case "renew":
			if in.FamilyID != origin || state != "pending" {
				return nil, chat.ErrForbidden
			}
			var token string
			token, e = newInterfamilyToken()
			if e != nil {
				return nil, e
			}
			result["token"] = token
			_, e = tx.Exec(ctx, `UPDATE interfamily_chats SET token_hash=$2,expires_at=now()+interval '7 days' WHERE conversation_id=$1`, cid, tokenHash(token))
		case "close":
			if _, e = tx.Exec(ctx, `UPDATE interfamily_chats SET state='closed',token_hash=NULL WHERE conversation_id=$1`, cid); e != nil {
				return nil, e
			}
			if _, e = tx.Exec(ctx, `UPDATE conversations SET archived_at=now() WHERE id=$1`, cid); e != nil {
				return nil, e
			}
			_, e = tx.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id=$1`, cid)
		default:
			return nil, chat.ErrInvalid
		}
		if e != nil {
			return nil, e
		}
		if _, e = tx.Exec(ctx, `UPDATE interfamily_chats SET version=version+1 WHERE conversation_id=$1`, cid); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return result, nil
}
