package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

var ErrNeedConflict = errors.New("запись уже изменена; откройте её заново")

type NeedInput struct {
	Title       *string `json:"title"`
	Kind        *string `json:"kind"`
	Description *string `json:"description"`
	PlannedDate *string `json:"plannedDate"`
	AssigneeID  *string `json:"assigneeId"`
	Completed   *bool   `json:"completed"`
	Archived    *bool   `json:"archived"`
	Version     *int64  `json:"version"`
}

type NeedActivity struct {
	ID        int64              `json:"id"`
	Actor     string             `json:"actor"`
	Action    string             `json:"action"`
	Body      string             `json:"body"`
	Before    *chat.ShoppingItem `json:"before,omitempty"`
	After     *chat.ShoppingItem `json:"after,omitempty"`
	CreatedAt time.Time          `json:"createdAt"`
}

type NeedMember struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

const needColumns = `s.id,COALESCE(s.family_id,''),s.title,s.planned_date,s.completed_at,s.created_by,s.created_at,s.kind,s.description,s.assignee_id,s.archived_at,s.version,
 COALESCE((SELECT display_name FROM users WHERE id=s.assignee_id),''),
 (SELECT count(*) FROM family_need_activity WHERE item_id=s.id AND action='comment'),s.owner_user_id`

func scanNeed(row pgx.Row) (chat.ShoppingItem, error) {
	var n chat.ShoppingItem
	err := row.Scan(&n.ID, &n.FamilyID, &n.Title, &n.PlannedDate, &n.CompletedAt, &n.CreatedBy, &n.CreatedAt, &n.Kind, &n.Description, &n.AssigneeID, &n.ArchivedAt, &n.Version, &n.AssigneeName, &n.CommentCount, &n.OwnerUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = chat.ErrNotFound
	}
	return n, err
}

// An empty familyID selects the authenticated actor's personal scope.
// Ownership never comes from request fields; every item query checks the scope.
func (p *Postgres) ListNeeds(actor chat.User, familyID string, archived bool) ([]chat.ShoppingItem, error) {
	if actor.ID == "" || (familyID != "" && !p.FamilyMember(actor.ID, familyID)) {
		return nil, chat.ErrForbidden
	}
	rows, err := p.Pool.Query(context.Background(), `SELECT `+needColumns+` FROM shopping_items s WHERE ((s.family_id=$1 AND $1!='') OR ($1='' AND s.owner_user_id=$3)) AND (s.archived_at IS NOT NULL)=$2 ORDER BY s.completed_at NULLS FIRST,s.planned_date NULLS LAST,s.created_at DESC,s.id`, familyID, archived, actor.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []chat.ShoppingItem{}
	for rows.Next() {
		n, e := scanNeed(rows)
		if e != nil {
			return nil, e
		}
		result = append(result, n)
	}
	return result, rows.Err()
}

func (p *Postgres) NeedDetails(actor chat.User, familyID, itemID string) (any, error) {
	if actor.ID == "" || (familyID != "" && !p.FamilyMember(actor.ID, familyID)) {
		return nil, chat.ErrForbidden
	}
	ctx := context.Background()
	n, err := scanNeed(p.Pool.QueryRow(ctx, `SELECT `+needColumns+` FROM shopping_items s WHERE ((s.family_id=$1 AND $1!='') OR ($1='' AND s.owner_user_id=$3)) AND s.id=$2`, familyID, itemID, actor.ID))
	if err != nil {
		return nil, err
	}
	rows, err := p.Pool.Query(ctx, `SELECT a.id,u.display_name,a.action,a.body,a.before_state,a.after_state,a.created_at FROM family_need_activity a JOIN users u ON u.id=a.actor_id WHERE a.item_id=$1 ORDER BY a.id DESC`, itemID)
	if err != nil {
		return nil, err
	}
	activity := []NeedActivity{}
	for rows.Next() {
		var a NeedActivity
		var before, after []byte
		if err = rows.Scan(&a.ID, &a.Actor, &a.Action, &a.Body, &before, &after, &a.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		if before != nil {
			if err = json.Unmarshal(before, &a.Before); err != nil {
				rows.Close()
				return nil, err
			}
		}
		if after != nil {
			if err = json.Unmarshal(after, &a.After); err != nil {
				rows.Close()
				return nil, err
			}
		}
		activity = append(activity, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	members := []NeedMember{}
	rows, err = p.Pool.Query(ctx, `SELECT u.id,u.display_name FROM family_members fm JOIN users u ON u.id=fm.user_id WHERE fm.family_id=$1 AND u.disabled_at IS NULL ORDER BY u.display_name`, familyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m NeedMember
		if err = rows.Scan(&m.ID, &m.Name); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return struct {
		Item     chat.ShoppingItem `json:"item"`
		Activity []NeedActivity    `json:"activity"`
		Members  []NeedMember      `json:"members"`
		CanEdit  bool              `json:"canEdit"`
	}{n, activity, members, n.CreatedBy == actor.ID || p.FamilyAdmin(actor.ID, familyID)}, rows.Err()
}

// All writers, including the legacy shopping routes, use the same transaction.
func (p *Postgres) SaveNeed(actor chat.User, familyID, itemID string, in NeedInput) (chat.ShoppingItem, error) {
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.ShoppingItem{}, err
	}
	defer tx.Rollback(ctx)
	if actor.ID == "" {
		return chat.ShoppingItem{}, chat.ErrForbidden
	}
	var role string
	if familyID != "" {
		err = tx.QueryRow(ctx, `SELECT role FROM family_members WHERE user_id=$1 AND family_id=$2 FOR SHARE`, actor.ID, familyID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			return chat.ShoppingItem{}, chat.ErrForbidden
		}
		if err != nil {
			return chat.ShoppingItem{}, err
		}
	}
	creating := itemID == ""
	n := chat.ShoppingItem{ID: id(), FamilyID: familyID, Kind: "purchase", CreatedBy: actor.ID, CreatedAt: time.Now().UTC().Truncate(time.Microsecond), Version: 1}
	if familyID == "" {
		n.OwnerUserID = &actor.ID
	}
	var before *chat.ShoppingItem
	if !creating {
		n, err = scanNeed(tx.QueryRow(ctx, `SELECT `+needColumns+` FROM shopping_items s WHERE s.id=$1 AND ((s.family_id=$2 AND $2!='') OR ($2='' AND s.owner_user_id=$3)) FOR UPDATE OF s`, itemID, familyID, actor.ID))
		if err != nil {
			return n, err
		}
		if in.Version != nil && *in.Version != n.Version {
			return n, ErrNeedConflict
		}
		copy := n
		before = &copy
		editing := in.Title != nil || in.Kind != nil || in.Description != nil || in.PlannedDate != nil || in.AssigneeID != nil || in.Archived != nil
		if editing && n.CreatedBy != actor.ID && role != "admin" && role != "owner" {
			return n, chat.ErrForbidden
		}
		if n.ArchivedAt != nil && (in.Archived == nil || *in.Archived || in.Completed != nil) {
			return n, chat.ErrInvalid
		}
	}
	if in.Title != nil {
		n.Title = strings.TrimSpace(*in.Title)
	}
	if in.Kind != nil {
		n.Kind = *in.Kind
	}
	if in.Description != nil {
		n.Description = strings.TrimSpace(*in.Description)
	}
	if n.Title == "" || len([]rune(n.Title)) > 160 || len([]rune(n.Description)) > 4000 || (n.Kind != "purchase" && n.Kind != "task") {
		return n, chat.ErrInvalid
	}
	if in.PlannedDate != nil {
		n.PlannedDate = nil
		if *in.PlannedDate != "" {
			date, e := time.Parse("2006-01-02", *in.PlannedDate)
			if e != nil {
				return n, chat.ErrInvalid
			}
			n.PlannedDate = &date
		}
	}
	if familyID == "" && in.AssigneeID != nil && *in.AssigneeID != "" {
		return n, chat.ErrInvalid
	}
	if in.AssigneeID != nil {
		n.AssigneeID = nil
		n.AssigneeName = ""
		if *in.AssigneeID != "" {
			var name string
			e := tx.QueryRow(ctx, `SELECT u.display_name FROM family_members fm JOIN users u ON u.id=fm.user_id WHERE fm.family_id=$1 AND fm.user_id=$2 AND u.disabled_at IS NULL FOR SHARE OF fm,u`, familyID, *in.AssigneeID).Scan(&name)
			if errors.Is(e, pgx.ErrNoRows) {
				return n, chat.ErrInvalid
			}
			if e != nil {
				return n, e
			}
			n.AssigneeID = in.AssigneeID
			n.AssigneeName = name
		}
	}
	if in.Completed != nil {
		if *in.Completed && n.CompletedAt == nil {
			now := time.Now().UTC().Truncate(time.Microsecond)
			n.CompletedAt = &now
		}
		if !*in.Completed {
			n.CompletedAt = nil
		}
	}
	if in.Archived != nil {
		if *in.Archived && n.ArchivedAt == nil {
			now := time.Now().UTC().Truncate(time.Microsecond)
			n.ArchivedAt = &now
		}
		if !*in.Archived {
			n.ArchivedAt = nil
		}
	}
	oldJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(n)
	if !creating && string(oldJSON) == string(afterJSON) {
		return n, tx.Commit(ctx)
	}
	if creating {
		_, err = tx.Exec(ctx, `INSERT INTO shopping_items(id,family_id,title,planned_date,completed_at,created_by,created_at,kind,description,assignee_id,archived_at,owner_user_id) VALUES($1,NULLIF($2,''),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, n.ID, n.FamilyID, n.Title, n.PlannedDate, n.CompletedAt, n.CreatedBy, n.CreatedAt, n.Kind, n.Description, n.AssigneeID, n.ArchivedAt, n.OwnerUserID)
	} else {
		n.Version++
		_, err = tx.Exec(ctx, `UPDATE shopping_items SET title=$1,planned_date=$2,completed_at=$3,kind=$4,description=$5,assignee_id=$6,archived_at=$7,version=$8,updated_at=now() WHERE id=$9`, n.Title, n.PlannedDate, n.CompletedAt, n.Kind, n.Description, n.AssigneeID, n.ArchivedAt, n.Version, n.ID)
	}
	if err != nil {
		return n, err
	}
	action := "edited"
	if creating {
		action = "created"
	} else if in.Archived != nil {
		if *in.Archived {
			action = "archived"
		} else {
			action = "unarchived"
		}
	} else if in.Completed != nil {
		if *in.Completed {
			action = "completed"
		} else {
			action = "reopened"
		}
	}
	afterJSON, _ = json.Marshal(n)
	_, err = tx.Exec(ctx, `INSERT INTO family_need_activity(item_id,actor_id,action,before_state,after_state) VALUES($1,$2,$3,$4,$5)`, n.ID, actor.ID, action, oldJSON, afterJSON)
	if err != nil {
		return n, err
	}
	return n, tx.Commit(ctx)
}

func (p *Postgres) CommentNeed(actor chat.User, familyID, itemID, body string) error {
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > 4000 {
		return chat.ErrInvalid
	}
	ctx := context.Background()
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if actor.ID == "" {
		return chat.ErrForbidden
	}
	var member string
	if familyID != "" {
		if err = tx.QueryRow(ctx, `SELECT user_id FROM family_members WHERE family_id=$1 AND user_id=$2 FOR SHARE`, familyID, actor.ID).Scan(&member); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return chat.ErrForbidden
			}
			return err
		}
	}
	var archived *time.Time
	if err = tx.QueryRow(ctx, `SELECT archived_at FROM shopping_items WHERE ((family_id=$1 AND $1!='') OR ($1='' AND owner_user_id=$3)) AND id=$2 FOR UPDATE`, familyID, itemID, actor.ID).Scan(&archived); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return chat.ErrNotFound
		}
		return err
	}
	if archived != nil {
		return chat.ErrInvalid
	}
	_, err = tx.Exec(ctx, `INSERT INTO family_need_activity(item_id,actor_id,action,body) VALUES($1,$2,'comment',$3)`, itemID, actor.ID, body)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
