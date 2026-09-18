package store

import (
	"strings"
	"testing"
	"time"
)

func TestAutomationSchedule(t *testing.T) {
	for _, s := range []AutomationSettings{{ReportTime: "9:00", TimeZone: "UTC"}, {ReportTime: "24:00", TimeZone: "UTC"}, {ReportTime: "09:00", TimeZone: "Local"}, {ReportTime: "09:00", TimeZone: "unknown/zone"}} {
		if _, err := s.location(); err == nil {
			t.Fatal("invalid settings accepted", s)
		}
	}
	s := AutomationSettings{ReportTime: "09:00", TimeZone: "Europe/Moscow"}
	loc, err := s.location()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 18, 5, 0, 0, 0, time.UTC)
	if got := nextReport(now, s, loc); !got.Equal(time.Date(2026, 9, 18, 6, 0, 0, 0, time.UTC)) {
		t.Fatal(got)
	}
	if got := nextReport(now.Add(time.Hour), s, loc); !got.Equal(time.Date(2026, 9, 19, 6, 0, 0, 0, time.UTC)) {
		t.Fatal("save at due time must schedule future", got)
	}
	ny, _ := time.LoadLocation("America/New_York")
	spring := reportOnDay(time.Date(2026, 3, 8, 12, 0, 0, 0, ny), "02:30", ny)
	if spring.Hour() != 3 || spring.Minute() != 0 {
		t.Fatal("DST gap", spring)
	}
	autumn := reportOnDay(time.Date(2026, 11, 1, 12, 0, 0, 0, ny), "01:30", ny)
	if !autumn.Equal(time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)) {
		t.Fatal("DST repeat", autumn)
	}
}
func TestDailyReportFormatting(t *testing.T) {
	day := time.Date(2026, 9, 18, 9, 0, 0, 0, time.UTC)
	yesterday := day.AddDate(0, 0, -1)
	items := []reportItem{{Title: "Task\nname", Kind: "task", Date: &yesterday}, {Title: "Buy", Kind: "purchase", Family: "Synthetic family", Date: &day}}
	body := dailyReportBody(items, 2, day, "ru")
	for _, word := range []string{"Просрочено", "Сегодня", "Личные", "Synthetic family", "Task name"} {
		if !strings.Contains(body, word) {
			t.Fatal(body)
		}
	}
	if !strings.Contains(dailyReportBody(nil, 0, day, "en"), "No active") {
		t.Fatal("empty report")
	}
	many := make([]reportItem, 100)
	for i := range many {
		many[i] = reportItem{Title: strings.Repeat("я", 200), Kind: "task", Family: strings.Repeat("f", 100)}
	}
	body = dailyReportBody(many, 1000, day, "ru")
	if len([]rune(body)) > 4000 || !strings.Contains(body, "Ещё записей:") {
		t.Fatal("report limit")
	}
}
