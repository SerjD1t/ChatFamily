package main

import (
	"crypto/rand"
	"encoding/hex"
	"familychat/internal/chat"
	"familychat/internal/store"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var originalKey = regexp.MustCompile(`^(avatar-)?[a-f0-9]{32}$`)
var previewKey = regexp.MustCompile(`^[a-f0-9]{64}\.jpg(\.failed)?$`)

type storageFile struct {
	Name     string
	Size     int64
	Modified time.Time
}
type storagePlan struct {
	Actor, Action string
	Expires       time.Time
	Files         []storageFile
}
type storageSize struct {
	Count int   `json:"count"`
	Bytes int64 `json:"bytes"`
}
type storageScan struct {
	Originals, Cache, Trash storageSize
	Ignored                 int
	Files                   map[string][]storageFile
}

// Only this application's recognized regular files are eligible. Never follow
// symlinks, traverse arbitrary directories or infer references from file age.
func scanStorage(root string, refs map[string]bool, s store.StorageSettings, at time.Time) (storageScan, error) {
	result := storageScan{Files: map[string][]storageFile{}}
	for _, sub := range []string{"", ".previews-v1", ".storage-trash"} {
		dir := filepath.Join(root, sub)
		info, err := os.Lstat(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return result, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return result, fmt.Errorf("unsafe storage directory")
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return result, err
		}
		if len(entries) > 100000 {
			return result, fmt.Errorf("storage scan limit exceeded")
		}
		for _, entry := range entries {
			if sub == "" && (entry.Name() == ".previews-v1" || entry.Name() == ".storage-trash") {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				return result, err
			}
			if !info.Mode().IsRegular() {
				result.Ignored++
				continue
			}
			file := storageFile{entry.Name(), info.Size(), info.ModTime()}
			old := func(days int) bool { return info.ModTime().Before(at.Add(-time.Duration(days) * 24 * time.Hour)) }
			switch sub {
			case "":
				result.Originals.Count++
				result.Originals.Bytes += info.Size()
				if originalKey.MatchString(entry.Name()) && !refs[entry.Name()] && old(s.OrphanDays) {
					result.Files["orphans"] = append(result.Files["orphans"], file)
				}
			case ".previews-v1":
				result.Cache.Count++
				result.Cache.Bytes += info.Size()
				if previewKey.MatchString(entry.Name()) {
					result.Files["cache"] = append(result.Files["cache"], file)
					if old(s.CacheDays) {
						result.Files["cacheOld"] = append(result.Files["cacheOld"], file)
					}
				} else {
					result.Ignored++
				}
			case ".storage-trash":
				result.Trash.Count++
				result.Trash.Bytes += info.Size()
				parts := strings.SplitN(entry.Name(), "_", 2)
				if len(parts) != 2 || !originalKey.MatchString(parts[1]) {
					result.Ignored++
					continue
				}
				moved, err := time.Parse("20060102T150405.000000000", parts[0])
				if err != nil {
					result.Ignored++
					continue
				}
				if _, err = os.Lstat(filepath.Join(root, parts[1])); os.IsNotExist(err) {
					result.Files["restore"] = append(result.Files["restore"], file)
				}
				if !refs[parts[1]] && moved.Before(at.Add(-time.Duration(s.TrashDays)*24*time.Hour)) {
					result.Files["purge"] = append(result.Files["purge"], file)
				}
			}
		}
	}
	return result, nil
}
func fileTotals(files []storageFile) storageSize {
	out := storageSize{Count: len(files)}
	for _, f := range files {
		out.Bytes += f.Size
	}
	return out
}
func storageAction(action string) bool {
	return action == "cache" || action == "cacheOld" || action == "orphans" || action == "restore" || action == "purge"
}
func (a *app) storageAllowed(w http.ResponseWriter, r *http.Request) bool {
	if !a.user(id(r)).Permissions[chat.ManageApplication] {
		write(w, 403, map[string]string{"error": "Недостаточно прав / Access denied"})
		return false
	}
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL / PostgreSQL required"})
		return false
	}
	return true
}
func (a *app) storageRead(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.storageMu.RLock()
		defer a.storageMu.RUnlock()
		next(w, r)
	}
}
func (a *app) storageStatus(w http.ResponseWriter, r *http.Request) {
	if !a.storageAllowed(w, r) {
		return
	}
	a.storageMu.RLock()
	defer a.storageMu.RUnlock()
	settings, err := a.db.StorageSettings(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	refs, err := a.db.StorageReferences(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	scan, err := scanStorage(a.cfg.UploadDirectory, refs, settings, time.Now())
	if err != nil {
		storageError(w)
		return
	}
	history, err := a.db.StorageHistory(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	tools := map[string]bool{}
	for _, tool := range []string{"ffmpeg", "pdftoppm", "prlimit"} {
		_, err := exec.LookPath(tool)
		tools[tool] = err == nil
	}
	candidates := map[string]storageSize{}
	for _, action := range []string{"cache", "cacheOld", "orphans", "restore", "purge"} {
		candidates[action] = fileTotals(scan.Files[action])
	}
	write(w, 200, map[string]any{"settings": settings, "originals": scan.Originals, "cache": scan.Cache, "trash": scan.Trash, "ignored": scan.Ignored, "candidates": candidates, "history": history, "tools": tools, "maxUploadBytes": a.cfg.MaxUploadBytes})
}
func storageError(w http.ResponseWriter) {
	write(w, 500, map[string]string{"error": "Операция хранилища не завершена. Обновите статистику. / Storage operation failed; refresh statistics."})
}
func (a *app) storageSettings(w http.ResponseWriter, r *http.Request) {
	if !a.storageAllowed(w, r) {
		return
	}
	var settings store.StorageSettings
	if !decode(w, r, &settings) {
		return
	}
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	if err := a.db.SetStorageSettings(r.Context(), a.user(id(r)), settings); err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, settings)
}
func (a *app) storagePrepare(w http.ResponseWriter, r *http.Request) {
	if !a.storageAllowed(w, r) {
		return
	}
	var input struct {
		Action string `json:"action"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !storageAction(input.Action) {
		write(w, 400, map[string]string{"error": "Invalid action"})
		return
	}
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	settings, err := a.db.StorageSettings(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	refs, err := a.db.StorageReferences(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	scan, err := scanStorage(a.cfg.UploadDirectory, refs, settings, time.Now())
	if err != nil {
		storageError(w)
		return
	}
	if a.storagePlans == nil {
		a.storagePlans = map[string]storagePlan{}
	}
	for key, p := range a.storagePlans {
		if time.Now().After(p.Expires) || p.Actor == id(r) {
			delete(a.storagePlans, key)
		}
	}
	if len(a.storagePlans) >= 32 || len(scan.Files[input.Action]) > 10000 {
		write(w, 409, map[string]string{"error": "Слишком много файлов или операций / Too many files or operations"})
		return
	}
	token := make([]byte, 24)
	if _, err = rand.Read(token); err != nil {
		storageError(w)
		return
	}
	key := hex.EncodeToString(token)
	a.storagePlans[key] = storagePlan{id(r), input.Action, time.Now().Add(5 * time.Minute), scan.Files[input.Action]}
	write(w, 200, map[string]any{"token": key, "action": input.Action, "total": fileTotals(scan.Files[input.Action])})
}
func (a *app) storageExecute(w http.ResponseWriter, r *http.Request) {
	if !a.storageAllowed(w, r) {
		return
	}
	var input struct {
		Token   string `json:"token"`
		Confirm bool   `json:"confirm"`
	}
	if !decode(w, r, &input) {
		return
	}
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	plan, ok := a.storagePlans[input.Token]
	if !ok || !input.Confirm || plan.Actor != id(r) || time.Now().After(plan.Expires) {
		write(w, 409, map[string]string{"error": "Повторите анализ / Run analysis again"})
		return
	}
	delete(a.storagePlans, input.Token) // One-shot, including partial failures.
	settings, err := a.db.StorageSettings(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	refs, err := a.db.StorageReferences(r.Context())
	if err != nil {
		storageError(w)
		return
	}
	scan, err := scanStorage(a.cfg.UploadDirectory, refs, settings, time.Now())
	if err != nil {
		storageError(w)
		return
	}
	eligible := map[string]storageFile{}
	for _, f := range scan.Files[plan.Action] {
		eligible[f.Name] = f
	}
	for _, f := range plan.Files {
		cur, ok := eligible[f.Name]
		if !ok || cur.Size != f.Size || !cur.Modified.Equal(f.Modified) {
			write(w, 409, map[string]string{"error": "Список изменился. Повторите анализ / Files changed; run analysis again"})
			return
		}
	}
	// Persist an intent before any filesystem change; a crash leaves a visible
	// 'started' event rather than silently losing the operation history.
	event := store.StorageEvent{At: time.Now().UTC().Format(time.RFC3339), Action: plan.Action, Status: "started"}
	if a.db.AddStorageEvent(r.Context(), event) != nil {
		storageError(w)
		return
	}
	result, err := applyStoragePlan(a.cfg.UploadDirectory, plan)
	event.Count = result.Count
	event.Bytes = result.Bytes
	event.Status = "done"
	if err != nil {
		event.Status = "partial"
	}
	logErr := a.db.AddStorageEvent(r.Context(), event)
	if err != nil || logErr != nil {
		storageError(w)
		return
	}
	write(w, 200, result)
}
func applyStoragePlan(root string, plan storagePlan) (storageSize, error) {
	result := storageSize{}
	trash := filepath.Join(root, ".storage-trash")
	if plan.Action == "orphans" {
		if err := os.MkdirAll(trash, 0700); err != nil {
			return result, err
		}
	}
	for _, f := range plan.Files {
		if filepath.Base(f.Name) != f.Name || strings.ContainsAny(f.Name, "/\\") {
			return result, fmt.Errorf("invalid path")
		}
		source := filepath.Join(root, f.Name)
		if plan.Action == "cache" || plan.Action == "cacheOld" {
			source = filepath.Join(root, ".previews-v1", f.Name)
		}
		if plan.Action == "restore" || plan.Action == "purge" {
			source = filepath.Join(trash, f.Name)
		}
		base, err := filepath.Abs(root)
		if err != nil {
			return result, err
		}
		absolute, err := filepath.Abs(source)
		if err != nil {
			return result, err
		}
		rel, err := filepath.Rel(base, absolute)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return result, fmt.Errorf("unsafe path")
		}
		for _, dir := range []string{root, filepath.Dir(source)} {
			info, err := os.Lstat(dir)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return result, fmt.Errorf("unsafe directory")
			}
		}
		info, err := os.Lstat(source)
		if err != nil {
			return result, err
		}
		if !info.Mode().IsRegular() || info.Size() != f.Size || !info.ModTime().Equal(f.Modified) {
			return result, fmt.Errorf("file changed")
		}
		switch plan.Action {
		case "cache", "cacheOld", "purge":
			err = os.Remove(source)
		case "orphans":
			err = os.Rename(source, filepath.Join(trash, time.Now().UTC().Format("20060102T150405.000000000")+"_"+f.Name))
		case "restore":
			parts := strings.SplitN(f.Name, "_", 2)
			if len(parts) != 2 || !originalKey.MatchString(parts[1]) {
				return result, fmt.Errorf("invalid trash entry")
			}
			target := filepath.Join(root, parts[1])
			if _, check := os.Lstat(target); !os.IsNotExist(check) {
				return result, fmt.Errorf("target exists")
			}
			err = os.Rename(source, target)
		default:
			return result, fmt.Errorf("invalid action")
		}
		if err != nil {
			return result, err
		}
		result.Count++
		result.Bytes += f.Size
	}
	return result, nil
}
