package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // Runtime images need not provide an OS zone database.

	"familychat/internal/chat"
	"github.com/jackc/pgx/v5"
)

type AutomationSettings struct {
	DailyReportEnabled bool   `json:"dailyReportEnabled"`
	ReportTime         string `json:"reportTime"`
	TimeZone           string `json:"timeZone"`
}

func (s AutomationSettings) location() (*time.Location, error) {
	if len(s.ReportTime) != 5 || s.ReportTime[2] != ':' || len(s.TimeZone) > 100 || s.TimeZone == "Local" {
		return nil, chat.ErrInvalid
	}
	parsed, err := time.Parse("15:04", s.ReportTime)
	if err != nil || parsed.Format("15:04") != s.ReportTime || s.TimeZone == "" {
		return nil, chat.ErrInvalid
	}
	loc, err := time.LoadLocation(s.TimeZone)
	if err != nil {
		return nil, chat.ErrInvalid
	}
	return loc, nil
}

// Walk actual minutes: a missing DST time uses the first later wall minute;
// a repeated wall time uses its first occurrence.
func reportOnDay(day time.Time, clock string, loc *time.Location) time.Time {
	day = day.In(loc)
	h, _ := strconv.Atoi(clock[:2])
	m, _ := strconv.Atoi(clock[3:])
	target := h*60 + m
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	end := start.AddDate(0, 0, 1)
	for candidate := start; candidate.Before(end); candidate = candidate.Add(time.Minute) {
		local := candidate.In(loc)
		if local.Hour()*60+local.Minute() >= target {
			return candidate
		}
	}
	return end
}
func nextReport(now time.Time, s AutomationSettings, loc *time.Location) time.Time {
	candidate := reportOnDay(now, s.ReportTime, loc)
	if !candidate.After(now) {
		candidate = reportOnDay(now.In(loc).AddDate(0, 0, 1), s.ReportTime, loc)
	}
	return candidate
}
func (p *Postgres) AutomationSettings(ctx context.Context, uid string) (AutomationSettings, error) {
	s := AutomationSettings{ReportTime: "09:00", TimeZone: "Europe/Moscow"}
	err := p.Pool.QueryRow(ctx, `SELECT daily_report_enabled,report_time,time_zone FROM user_automations WHERE user_id=$1`, uid).Scan(&s.DailyReportEnabled, &s.ReportTime, &s.TimeZone)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return s, err
}
func (p *Postgres) SaveAutomationSettings(ctx context.Context, uid string, s AutomationSettings, now time.Time) error {
	loc, err := s.location()
	if err != nil {
		return err
	}
	var next *time.Time
	if s.DailyReportEnabled {
		v := nextReport(now, s, loc)
		next = &v
	}
	// Re-saving unchanged preferences must not postpone an already due report.
	_, err = p.Pool.Exec(ctx, `INSERT INTO user_automations(user_id,daily_report_enabled,report_time,time_zone,next_run_at) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(user_id) DO UPDATE SET daily_report_enabled=EXCLUDED.daily_report_enabled,report_time=EXCLUDED.report_time,time_zone=EXCLUDED.time_zone,
 next_run_at=CASE WHEN user_automations.daily_report_enabled=EXCLUDED.daily_report_enabled AND user_automations.report_time=EXCLUDED.report_time AND user_automations.time_zone=EXCLUDED.time_zone THEN user_automations.next_run_at ELSE EXCLUDED.next_run_at END,updated_at=now()`, uid, s.DailyReportEnabled, s.ReportTime, s.TimeZone, next)
	return err
}

type reportItem struct {
	Title, Kind, Family string
	Date                *time.Time
}

func dailyReportBody(items []reportItem, total int, day time.Time, locale string) string {
	t := func(ru, en string) string {
		if locale == "en" {
			return en
		}
		return ru
	}
	body := t("Ежедневный отчёт о делах и покупках · ", "Daily tasks and purchases report · ") + day.Format("02.01.2006") + "\n"
	if total == 0 {
		return body + t("Текущих дел и покупок нет.", "No active tasks or purchases.")
	}
	body += fmt.Sprintf(t("Всего текущих: %d\n", "Active items: %d\n"), total)
	shown := 0
	today := day.Format("2006-01-02")
	for _, item := range items {
		kind := t("Дело", "Task")
		if item.Kind == "purchase" {
			kind = t("Покупка", "Purchase")
		}
		scope := t("Личные", "Personal")
		if item.Family != "" {
			scope = shortReportText(item.Family, 40)
		}
		due := t("Без срока", "No due date")
		if item.Date != nil {
			date := item.Date.Format("2006-01-02")
			due = item.Date.Format("02.01.2006")
			if date < today {
				due = t("Просрочено: ", "Overdue: ") + due
			} else if date == today {
				due = t("Сегодня", "Today")
			}
		}
		line := fmt.Sprintf("\n• %s: %s — %s [%s]", kind, shortReportText(item.Title, 160), due, scope)
		if len([]rune(body+line)) > 3700 {
			break
		}
		body += line
		shown++
	}
	if total > shown {
		body += fmt.Sprintf(t("\n\nЕщё записей: %d. Полный список — в «Делах и покупках».", "\n\nMore items: %d. See Tasks and purchases for the full list."), total-shown)
	}
	return body
}
func shortReportText(s string, limit int) string {
	r := []rune(strings.Join(strings.Fields(s), " "))
	if len(r) > limit {
		return string(r[:limit]) + "…"
	}
	return string(r)
}

// Settings lock, daily uniqueness and message insertion share one transaction.
// A crash cannot commit a message without its daily marker (or vice versa).
func (p *Postgres) SendNextDailyReport(ctx context.Context, now time.Time) (chat.Message, bool, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return chat.Message{}, false, err
	}
	defer tx.Rollback(ctx)
	var uid, locale string
	var s AutomationSettings
	err = tx.QueryRow(ctx, `SELECT a.user_id,a.report_time,a.time_zone,COALESCE(p.locale,'ru') FROM user_automations a JOIN users u ON u.id=a.user_id LEFT JOIN user_preferences p ON p.user_id=u.id
 WHERE a.daily_report_enabled AND a.next_run_at<=$1 AND u.disabled_at IS NULL ORDER BY a.next_run_at,a.user_id LIMIT 1 FOR UPDATE OF a SKIP LOCKED FOR SHARE OF u`, now).Scan(&uid, &s.ReportTime, &s.TimeZone, &locale)
	if errors.Is(err, pgx.ErrNoRows) {
		return chat.Message{}, false, nil
	}
	if err != nil {
		return chat.Message{}, false, err
	}
	loc, err := s.location()
	if err != nil {
		return chat.Message{}, false, err
	}
	today := now.In(loc)
	scheduled := reportOnDay(today, s.ReportTime, loc)
	next := nextReport(now, s, loc)
	if _, err = tx.Exec(ctx, `UPDATE user_automations SET next_run_at=$2 WHERE user_id=$1`, uid, next); err != nil {
		return chat.Message{}, false, err
	}
	if now.Before(scheduled) {
		return chat.Message{}, true, tx.Commit(ctx)
	} // No backlog spam after a long outage.
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_report_runs WHERE user_id=$1 AND report_date=$2::text::date)`, uid, today.Format("2006-01-02")).Scan(&exists); err != nil {
		return chat.Message{}, false, err
	}
	if exists {
		return chat.Message{}, true, tx.Commit(ctx)
	}
	rows, err := tx.Query(ctx, `SELECT s.title,s.kind,s.planned_date,COALESCE(f.title,''),count(*) OVER() FROM shopping_items s LEFT JOIN families f ON f.id=s.family_id
 WHERE s.completed_at IS NULL AND s.archived_at IS NULL AND (s.owner_user_id=$1 OR (s.assignee_id=$1 AND EXISTS(SELECT 1 FROM family_members fm WHERE fm.family_id=s.family_id AND fm.user_id=$1)))
 ORDER BY s.planned_date NULLS LAST,s.created_at,s.id LIMIT 100`, uid)
	if err != nil {
		return chat.Message{}, false, err
	}
	items := []reportItem{}
	total := 0
	for rows.Next() {
		var item reportItem
		if err = rows.Scan(&item.Title, &item.Kind, &item.Date, &item.Family, &total); err != nil {
			rows.Close()
			return chat.Message{}, false, err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return chat.Message{}, false, err
	}
	cid := id()
	if err = tx.QueryRow(ctx, `INSERT INTO conversations(id,kind,direct_key,created_by) VALUES($1,'direct',$2,$3) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id`, cid, uid+":"+uid, uid).Scan(&cid); err != nil {
		return chat.Message{}, false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, cid, uid); err != nil {
		return chat.Message{}, false, err
	}
	msg := chat.Message{ID: id(), ConversationID: cid, AuthorID: uid, Body: dailyReportBody(items, total, today, locale), CreatedAt: now}
	if _, err = tx.Exec(ctx, `INSERT INTO messages(id,conversation_id,author_id,body,created_at) VALUES($1,$2,$3,$4,$5)`, msg.ID, cid, uid, msg.Body, now); err != nil {
		return chat.Message{}, false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO daily_report_runs(user_id,report_date,message_id) VALUES($1,$2::text::date,$3)`, uid, today.Format("2006-01-02"), msg.ID); err != nil {
		return chat.Message{}, false, err
	}
	return msg, true, tx.Commit(ctx)
}
