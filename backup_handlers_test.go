package main

import (
	"encoding/json"
	"familychat/internal/chat"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupAdminAuthorization(t *testing.T) {
	t.Setenv("BACKUP_CONTROL_DIR", "")
	for _, method := range []string{"GET", "PUT", "POST"} {
		a := testApp()
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, httptest.NewRequest(method, "/api/v1/application/backups", nil))
		if w.Code != 401 {
			t.Fatal(method, w.Code)
		}
		w = httptest.NewRecorder()
		a.routes().ServeHTTP(w, authenticatedRequest(t, a, method, "/api/v1/application/backups", "{}"))
		if w.Code != 503 {
			t.Fatal(method, w.Code)
		}
		a.chat = chat.New(chat.User{ID: "admin", Permissions: map[chat.Permission]bool{}})
		w = httptest.NewRecorder()
		a.routes().ServeHTTP(w, authenticatedRequest(t, a, method, "/api/v1/application/backups", "{}"))
		if w.Code != 403 {
			t.Fatal(method, w.Code)
		}
	}
}

func TestBackupPolicyAndQueue(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BACKUP_CONTROL_DIR", dir)
	a := testApp()
	call := func(method, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, authenticatedRequest(t, a, method, "/api/v1/application/backups", body))
		return w
	}
	w := call("GET", "")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal(w.Code)
	}
	p := defaultBackupPolicy()
	p.Enabled = true
	p.DailyTime = "02:30"
	raw, _ := json.Marshal(p)
	if w = call("PUT", string(raw)); w.Code != 409 {
		t.Fatal("must initialize first", w.Code)
	}
	if err := saveBackupJSON(filepath.Join(dir, "status.json"), backupStatus{Ready: true, Heartbeat: time.Now().Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	if w = call("PUT", string(raw)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	p.DailyDays = p.RecentDays
	raw, _ = json.Marshal(p)
	if w = call("PUT", string(raw)); w.Code != 400 {
		t.Fatal("invalid bands", w.Code)
	}
	if w = call("POST", `{"action":"restore"}`); w.Code != 400 {
		t.Fatal("no destructive API", w.Code)
	}
	if w = call("POST", `{"action":"run"}`); w.Code != 202 {
		t.Fatal(w.Code)
	}
	if w = call("POST", `{"action":"run"}`); w.Code != 409 {
		t.Fatal("duplicate", w.Code)
	}
	var request map[string]any
	if err := readBackupJSON(filepath.Join(dir, "request.json"), &request); err != nil || request["action"] != "run" {
		t.Fatal(err)
	}
	if len(request) != 1 {
		t.Fatal("unexpected request fields")
	}
	if err := os.Remove(filepath.Join(dir, "request.json")); err != nil {
		t.Fatal(err)
	}
	if err := saveBackupJSON(filepath.Join(dir, "status.json"), backupStatus{Ready: true, Heartbeat: time.Now().Add(-time.Hour).Format(time.RFC3339Nano)}); err != nil {
		t.Fatal(err)
	}
	if w = call("POST", `{"action":"run"}`); w.Code != 409 {
		t.Fatal("stale worker", w.Code)
	}
}

func TestBackupDailyTimeValidation(t *testing.T) {
	for _, value := range []string{"", "02:30", "23:59"} {
		p := defaultBackupPolicy()
		p.DailyTime = value
		if !p.valid() {
			t.Fatal("valid time rejected", value)
		}
	}
	for _, value := range []string{"2:30", "24:00", "02:60", "02:30:00"} {
		p := defaultBackupPolicy()
		p.DailyTime = value
		if p.valid() {
			t.Fatal("invalid time accepted", value)
		}
	}
}
