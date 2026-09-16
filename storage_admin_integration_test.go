package main

import (
	"context"
	"encoding/json"
	"familychat/internal/store"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStorageAdministrationIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	p, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	// This test must only run against a disposable test database.
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash,permissions) VALUES ('test_storage_admin','storage-admin@example.test','Storage test','',ARRAY['manage_application']),('test_storage_other','storage-other@example.test','Storage test','',ARRAY['manage_application'])`)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM users WHERE id IN ('test_storage_admin','test_storage_other')`)
	defer p.Pool.Exec(ctx, `DELETE FROM application_settings WHERE key IN ('storage_settings','storage_history')`)
	a := testApp()
	a.db = p
	a.chat = p
	a.cfg.UploadDirectory = t.TempDir()
	key := strings.Repeat("f", 32)
	putStorageFile(t, a.cfg.UploadDirectory, key, 60*24*time.Hour)
	call := func(actor, method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/"+path, strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, actor))
		w := httptest.NewRecorder()
		switch path {
		case "status":
			a.storageStatus(w, r)
		case "settings":
			a.storageSettings(w, r)
		case "plan":
			a.storagePrepare(w, r)
		case "execute":
			a.storageExecute(w, r)
		}
		return w
	}
	w := call("test_storage_admin", "PUT", "settings", `{"images":true,"videos":false,"pdfs":true,"cacheDays":30,"orphanDays":30,"trashDays":30}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	settings, err := p.StorageSettings(ctx)
	if err != nil || settings.Videos {
		t.Fatal("settings did not persist", err)
	}
	// Avatar references must protect even files old enough for cleanup.
	_, err = p.Pool.Exec(ctx, `UPDATE users SET avatar_key=$1 WHERE id='test_storage_admin'`, key)
	if err != nil {
		t.Fatal(err)
	}
	w = call("test_storage_admin", "GET", "status", "")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var status struct {
		Candidates map[string]storageSize `json:"candidates"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &status)
	if status.Candidates["orphans"].Count != 0 {
		t.Fatal("referenced avatar eligible")
	}
	_, err = p.Pool.Exec(ctx, `UPDATE users SET avatar_key=NULL WHERE id='test_storage_admin'`)
	if err != nil {
		t.Fatal(err)
	}
	w = call("test_storage_admin", "POST", "plan", `{"action":"orphans"}`)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var plan struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &plan)
	body := `{"token":"` + plan.Token + `","confirm":true}`
	if w = call("test_storage_other", "POST", "execute", body); w.Code != 409 {
		t.Fatal("another admin used plan", w.Code)
	}
	if w = call("test_storage_admin", "POST", "execute", body); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, err = os.Stat(filepath.Join(a.cfg.UploadDirectory, key)); !os.IsNotExist(err) {
		t.Fatal("not quarantined")
	}
	if w = call("test_storage_admin", "POST", "execute", body); w.Code != 409 {
		t.Fatal("plan replay accepted")
	}
	events, err := p.StorageHistory(ctx)
	if err != nil || len(events) != 2 || events[0].Status != "done" {
		t.Fatal("missing audit", err)
	}
	w = call("test_storage_admin", "POST", "plan", `{"action":"restore"}`)
	_ = json.Unmarshal(w.Body.Bytes(), &plan)
	if w = call("test_storage_admin", "POST", "execute", `{"token":"`+plan.Token+`","confirm":true}`); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if _, err = os.Stat(filepath.Join(a.cfg.UploadDirectory, key)); err != nil {
		t.Fatal(err)
	}
}
