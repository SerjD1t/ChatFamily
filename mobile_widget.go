package main

import (
	"errors"
	"familychat/internal/chat"
	"familychat/internal/store"
	"net/http"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"
)

type widgetItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Date     string `json:"date"`
	Assignee string `json:"assignee"`
}

type widgetChat struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Unread    int64  `json:"unread"`
	Icon      string `json:"icon,omitempty"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

func widgetUnreadChats(chats []chat.Conversation) ([]widgetChat, int64) {
	result := []widgetChat{}
	var total int64
	for _, c := range chats {
		if c.UnreadCount <= 0 {
			continue
		}
		total += c.UnreadCount
		if len(result) < 5 {
			result = append(result, widgetChat{ID: c.ID, Title: c.Title, Unread: c.UnreadCount, Icon: c.Icon})
		}
	}
	return result, total
}

type widgetSummary struct {
	Today     string       `json:"today"`
	Due       int          `json:"due"`
	Overdue   int          `json:"overdue"`
	Purchases int          `json:"purchaseCount"`
	Tasks     []widgetItem `json:"tasks"`
	Shopping  []widgetItem `json:"shopping"`
}

func summarizeWidget(items []chat.ShoppingItem, user, family, today string, mine bool) widgetSummary {
	out := widgetSummary{Today: today, Tasks: []widgetItem{}, Shopping: []widgetItem{}}
	for _, n := range items {
		if n.OwnerUserID != nil || n.FamilyID != family || n.CompletedAt != nil || n.ArchivedAt != nil {
			continue
		}
		d := ""
		if n.PlannedDate != nil {
			d = n.PlannedDate.Format("2006-01-02")
		}
		item := widgetItem{ID: n.ID, Title: n.Title, Date: d, Assignee: n.AssigneeName}
		if n.Kind == "task" {
			if mine && (n.AssigneeID == nil || *n.AssigneeID != user) {
				continue
			}
			if d != "" && d <= today {
				out.Tasks = append(out.Tasks, item)
				if d < today {
					out.Overdue++
				} else {
					out.Due++
				}
			}
		} else if n.Kind == "purchase" {
			out.Purchases++
			out.Shopping = append(out.Shopping, item)
		}
	}
	less := func(a, b widgetItem) bool {
		ad, bd := a.Date, b.Date
		if ad == "" {
			ad = "9999"
		}
		if bd == "" {
			bd = "9999"
		}
		if ad != bd {
			return ad < bd
		}
		return a.ID < b.ID
	}
	sort.Slice(out.Tasks, func(i, j int) bool { return less(out.Tasks[i], out.Tasks[j]) })
	sort.Slice(out.Shopping, func(i, j int) bool { return less(out.Shopping[i], out.Shopping[j]) })
	if len(out.Tasks) > 4 {
		out.Tasks = out.Tasks[:4]
	}
	if len(out.Shopping) > 4 {
		out.Shopping = out.Shopping[:4]
	}
	return out
}
func (a *app) mobileWidget(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	actor := a.user(id(r))
	expected := r.Header.Get("X-Expected-User")
	if expected != "" && expected != actor.ID {
		domainError(w, chat.ErrForbidden)
		return
	}
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	families, err := a.db.Families(actor.ID)
	if err != nil {
		domainError(w, err)
		return
	}
	// Minimal directory: never return other families through application-admin rights.
	list := []map[string]string{}
	title := ""
	family := r.URL.Query().Get("familyId")
	for _, f := range families {
		list = append(list, map[string]string{"id": f.ID, "title": f.Title})
		if f.ID == family {
			title = f.Title
		}
	}
	if family == "" {
		write(w, 200, map[string]any{"userId": actor.ID, "families": list})
		return
	}
	if expected == "" || title == "" {
		domainError(w, chat.ErrForbidden)
		return
	}
	zone, err := time.LoadLocation(r.URL.Query().Get("timezone"))
	if err != nil {
		write(w, 400, map[string]string{"error": "Invalid timezone"})
		return
	}
	items, err := a.db.ListNeeds(actor, family, false)
	if err != nil {
		domainError(w, err)
		return
	}
	summary := summarizeWidget(items, actor.ID, family, time.Now().In(zone).Format("2006-01-02"), r.URL.Query().Get("mine") == "true")
	out := map[string]any{"userId": actor.ID, "familyId": family, "title": title, "summary": summary}
	if r.URL.Query().Get("savedPins") == "true" {
		ids, e := a.db.WidgetPinIDs(actor.ID, family)
		if e != nil {
			domainError(w, e)
			return
		}
		out["pinned"] = widgetPinned(items, family, ids)
		out["savedPins"] = true
	}
	// Only purchases from the already authorized family; never disclose personal items.
	if r.URL.Query().Get("configure") == "true" {
		choices := []widgetItem{}
		for _, n := range items {
			if n.Kind == "purchase" && n.CompletedAt == nil && n.ArchivedAt == nil && n.OwnerUserID == nil && n.FamilyID == family {
				choices = append(choices, widgetItem{ID: n.ID, Title: n.Title})
				if len(choices) == 200 {
					break
				}
			}
		}
		out["purchases"] = choices
	}
	if pins := r.URL.Query().Get("pins"); pins != "" && r.URL.Query().Get("savedPins") != "true" {
		ids := strings.Split(pins, ",")
		if len(ids) > 3 {
			domainError(w, chat.ErrInvalid)
			return
		}
		out["pinned"] = widgetPinned(items, family, ids)
	}
	if r.URL.Query().Get("chats") == "true" {
		conversations := a.db.Conversations(actor.ID)
		chats, total := widgetUnreadChats(conversations)
		for i, c := range chats {
			for _, conv := range conversations {
				if conv.ID == c.ID && conv.Kind == chat.Direct {
					if u, ok := a.db.User(conv.PeerUserID); ok {
						chats[i].AvatarURL = u.AvatarURL
					}
					break
				}
			}
		}
		out["chats"] = chats
		out["unreadCount"] = total
	}
	write(w, 200, out)
}

func (a *app) widgetPin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if a.db == nil {
		write(w, 503, map[string]string{"error": "PostgreSQL required"})
		return
	}
	actor := a.user(id(r))
	if expected := r.Header.Get("X-Expected-User"); expected != "" && expected != actor.ID {
		domainError(w, chat.ErrForbidden)
		return
	}
	var in struct {
		Pinned *bool `json:"pinned"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Pinned == nil {
		domainError(w, chat.ErrInvalid)
		return
	}
	if err := a.db.SetWidgetPin(actor, r.PathValue("familyID"), r.PathValue("itemID"), *in.Pinned); err != nil {
		if errors.Is(err, store.ErrWidgetPinLimit) {
			write(w, 409, map[string]string{"error": "Можно закрепить до трёх покупок / Up to three purchases can be pinned"})
		} else {
			domainError(w, err)
		}
		return
	}
	write(w, 200, map[string]bool{"pinned": *in.Pinned})
	a.hub.publish(realtimeEvent{Type: "shopping.changed", UserID: actor.ID})
}

type widgetPin struct {
	ID        string               `json:"id"`
	Title     string               `json:"title"`
	Version   int64                `json:"version"`
	Checklist []chat.ChecklistItem `json:"checklist"`
}

func widgetPinned(items []chat.ShoppingItem, family string, ids []string) []widgetPin {
	out := []widgetPin{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] || len(out) >= 3 {
			continue
		}
		seen[id] = true
		for _, n := range items {
			if n.ID == id && n.FamilyID == family && n.OwnerUserID == nil && n.Kind == "purchase" && n.CompletedAt == nil && n.ArchivedAt == nil {
				out = append(out, widgetPin{n.ID, n.Title, n.Version, n.Checklist})
				break
			}
		}
	}
	return out
}
