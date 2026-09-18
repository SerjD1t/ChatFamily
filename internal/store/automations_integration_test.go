package store

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDailyReportTransaction(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	p, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	const uid = "test_auto_user"
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash) VALUES ('test_auto_user','automation@example.test','Synthetic',''),('test_auto_other','automation-other@example.test','Other','');
 INSERT INTO families(id,title) VALUES('test_auto_family','Synthetic family'),('test_auto_outside','Outside');
 INSERT INTO family_members(family_id,user_id,role) VALUES('test_auto_family','test_auto_user','member');
 INSERT INTO shopping_items(id,family_id,owner_user_id,title,created_by,assignee_id) VALUES
 ('test_auto_private',NULL,'test_auto_user','Private','test_auto_user',NULL),
 ('test_auto_assigned','test_auto_family',NULL,'Assigned','test_auto_other','test_auto_user'),
 ('test_auto_unassigned','test_auto_family',NULL,'Not assigned','test_auto_other',NULL),
 ('test_auto_foreign','test_auto_outside',NULL,'Forbidden family','test_auto_other','test_auto_user'),
 ('test_auto_other_private',NULL,'test_auto_other','Forbidden private','test_auto_other',NULL)`)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM daily_report_runs WHERE user_id='test_auto_user';DELETE FROM messages WHERE author_id='test_auto_user';DELETE FROM conversations WHERE created_by='test_auto_user';DELETE FROM shopping_items WHERE id LIKE 'test_auto_%';DELETE FROM families WHERE id LIKE 'test_auto_%';DELETE FROM users WHERE id LIKE 'test_auto_%'`)
	now := time.Date(2026, 9, 18, 8, 0, 0, 0, time.UTC)
	prefs, err := p.AutomationSettings(ctx, uid)
	if err != nil || prefs.DailyReportEnabled {
		t.Fatal("default off", err)
	}
	prefs = AutomationSettings{DailyReportEnabled: true, ReportTime: "09:00", TimeZone: "UTC"}
	if err = p.SaveAutomationSettings(ctx, uid, prefs, now); err != nil {
		t.Fatal(err)
	}
	if _, processed, e := p.SendNextDailyReport(ctx, now); e != nil || processed {
		t.Fatal("early report", e)
	}
	due := now.Add(time.Hour)
	var wg sync.WaitGroup
	results := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _, e := p.SendNextDailyReport(ctx, due); results <- e }()
	}
	wg.Wait()
	close(results)
	for e := range results {
		if e != nil {
			t.Fatal(e)
		}
	}
	var count int
	var body string
	if err = p.Pool.QueryRow(ctx, `SELECT count(*),max(body) FROM messages WHERE author_id=$1`, uid).Scan(&count, &body); err != nil || count != 1 {
		t.Fatal("duplicate or missing report", count, err)
	}
	if !strings.Contains(body, "Private") || !strings.Contains(body, "Assigned") || strings.Contains(body, "Forbidden") || strings.Contains(body, "Not assigned") {
		t.Fatal("scope filter", body)
	}
	// Editing time on the same date cannot send a second daily report.
	prefs.ReportTime = "10:00"
	if err = p.SaveAutomationSettings(ctx, uid, prefs, due); err != nil {
		t.Fatal(err)
	}
	if msg, _, e := p.SendNextDailyReport(ctx, due.Add(time.Hour)); e != nil || msg.ID != "" {
		t.Fatal("duplicate after schedule change", e)
	}
	// Missed days are not replayed; only today's report is sent after recovery.
	if msg, _, e := p.SendNextDailyReport(ctx, due.AddDate(0, 0, 3).Add(time.Hour)); e != nil || msg.ID == "" {
		t.Fatal("recovery", e)
	}
	prefs.DailyReportEnabled = false
	if err = p.SaveAutomationSettings(ctx, uid, prefs, due.AddDate(0, 0, 3)); err != nil {
		t.Fatal(err)
	}
	if _, processed, e := p.SendNextDailyReport(ctx, due.AddDate(0, 0, 4)); e != nil || processed {
		t.Fatal("disabled report", e)
	}
}
