package main

import (
	"familychat/internal/chat"
	"familychat/internal/store"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func putStorageFile(t *testing.T, root, name string, age time.Duration) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	at := time.Now().Add(-age)
	if err := os.Chtimes(path, at, at); err != nil {
		t.Fatal(err)
	}
}
func TestStorageQuarantineRestoreAndProtection(t *testing.T) {
	root := t.TempDir()
	settings := store.DefaultStorageSettings()
	old := 60 * 24 * time.Hour
	referenced := strings.Repeat("a", 32)
	orphan := strings.Repeat("b", 32)
	fresh := strings.Repeat("c", 32)
	avatar := "avatar-" + strings.Repeat("d", 32)
	for _, name := range []string{referenced, orphan, avatar} {
		putStorageFile(t, root, name, old)
	}
	putStorageFile(t, root, fresh, time.Hour)
	putStorageFile(t, root, "unknown.txt", old)
	refs := map[string]bool{referenced: true, avatar: true}
	scan, err := scanStorage(root, refs, settings, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Files["orphans"]) != 1 || scan.Files["orphans"][0].Name != orphan {
		t.Fatal("referenced/fresh/unknown file eligible")
	}
	result, err := applyStoragePlan(root, storagePlan{Action: "orphans", Files: scan.Files["orphans"]})
	if err != nil || result.Count != 1 {
		t.Fatal(result, err)
	}
	if _, err = os.Stat(filepath.Join(root, orphan)); !os.IsNotExist(err) {
		t.Fatal("not quarantined")
	}
	scan, err = scanStorage(root, refs, settings, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Files["restore"]) != 1 || len(scan.Files["purge"]) != 0 {
		t.Fatal("quarantine age based on original mtime")
	}
	result, err = applyStoragePlan(root, storagePlan{Action: "restore", Files: scan.Files["restore"]})
	if err != nil || result.Count != 1 {
		t.Fatal(result, err)
	}
	for _, name := range []string{referenced, orphan, fresh, avatar, "unknown.txt"} {
		if _, err = os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatal(name, err)
		}
	}
}
func TestStorageCachePurgeAndChangedFiles(t *testing.T) {
	root := t.TempDir()
	settings := store.DefaultStorageSettings()
	old := 60 * 24 * time.Hour
	cache := strings.Repeat("e", 64) + ".jpg"
	putStorageFile(t, root, filepath.Join(".previews-v1", cache), old)
	key := strings.Repeat("a", 32)
	trash := time.Now().UTC().Add(-old).Format("20060102T150405.000000000") + "_" + key
	putStorageFile(t, root, filepath.Join(".storage-trash", trash), time.Hour)
	scan, err := scanStorage(root, map[string]bool{key: true}, settings, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Files["purge"]) != 0 || len(scan.Files["cacheOld"]) != 1 {
		t.Fatal("reference protection or old cache selection")
	}
	scan, err = scanStorage(root, map[string]bool{}, settings, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Files["purge"]) != 1 {
		t.Fatal("expired trash not eligible")
	}
	if _, err = applyStoragePlan(root, storagePlan{Action: "purge", Files: scan.Files["purge"]}); err != nil {
		t.Fatal(err)
	}
	// Change a candidate after analysis: do not delete it.
	_ = os.WriteFile(filepath.Join(root, ".previews-v1", cache), []byte("changed content"), 0600)
	if _, err = applyStoragePlan(root, storagePlan{Action: "cacheOld", Files: scan.Files["cacheOld"]}); err == nil {
		t.Fatal("stale candidate deleted")
	}
	if _, err = applyStoragePlan(root, storagePlan{Action: "cache", Files: []storageFile{{Name: "../outside"}}}); err == nil {
		t.Fatal("path traversal accepted")
	}
}
func TestStorageRejectsSymlinkDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, ".previews-v1")); err != nil {
		t.Skip("symlink unavailable")
	}
	if _, err := scanStorage(root, map[string]bool{}, store.DefaultStorageSettings(), time.Now()); err == nil {
		t.Fatal("followed symlink")
	}
}
func TestStorageEndpointsRequireApplicationAdmin(t *testing.T) {
	a := testApp()
	a.chat = chat.New(chat.User{ID: "admin", Permissions: map[chat.Permission]bool{chat.ManageGroupMembers: true}})
	a.cfg.UploadDirectory = t.TempDir()
	for _, test := range []struct{ method, path, body string }{{"GET", "/api/v1/application/storage", ""}, {"PUT", "/api/v1/application/storage/settings", "{}"}, {"POST", "/api/v1/application/storage/plan", `{"action":"cache"}`}, {"POST", "/api/v1/application/storage/execute", `{"confirm":true}`}} {
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, authenticatedRequest(t, a, test.method, test.path, test.body))
		if w.Code != 403 {
			t.Fatalf("%s: %d", test.path, w.Code)
		}
		r := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
		w = httptest.NewRecorder()
		a.routes().ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("unauthenticated %s: %d", test.path, w.Code)
		}
	}
}
func TestStorageSettingsRanges(t *testing.T) {
	s := store.DefaultStorageSettings()
	if !s.Valid() {
		t.Fatal("default invalid")
	}
	s.OrphanDays = 0
	if s.Valid() {
		t.Fatal("unsafe orphan age")
	}
	s = store.DefaultStorageSettings()
	s.TrashDays = 1
	if s.Valid() {
		t.Fatal("unsafe trash age")
	}
}
