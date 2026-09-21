package main

import (
	"familychat/internal/chat"
	"net/http"
	"sort"
	"time"
	_ "time/tzdata"
)

type widgetItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Date     string `json:"date"`
	Assignee string `json:"assignee"`
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
	write(w, 200, map[string]any{"userId": actor.ID, "familyId": family, "title": title, "summary": summary})
}
