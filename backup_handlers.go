package main

import (
	"encoding/json"
	"familychat/internal/chat"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
	_ "time/tzdata"
)

// Only this non-secret directory is mounted into app. The host worker alone
// receives cloud credentials, the repository password and Docker access.
var backupControlMu sync.Mutex

type backupPolicy struct {
	Enabled       bool   `json:"enabled"`
	IntervalHours int    `json:"intervalHours"`
	Timezone      string `json:"timezone"`
	RecentDays    int    `json:"recentDays"`
	DailyDays     int    `json:"dailyDays"`
	WeeklyDays    int    `json:"weeklyDays"`
	MonthlyDays   int    `json:"monthlyDays"`
	LimitGiB      int    `json:"limitGiB"`
}

func defaultBackupPolicy() backupPolicy {
	return backupPolicy{false, 6, "Europe/Moscow", 2, 30, 90, 365, 450}
}
func (p backupPolicy) valid() bool {
	_, err := time.LoadLocation(p.Timezone)
	return err == nil && len(p.Timezone) <= 80 && p.Timezone != "" &&
		(p.IntervalHours == 1 || p.IntervalHours == 3 || p.IntervalHours == 6 || p.IntervalHours == 12 || p.IntervalHours == 24) &&
		p.RecentDays >= 1 && p.RecentDays < p.DailyDays && p.DailyDays < p.WeeklyDays && p.WeeklyDays < p.MonthlyDays && p.MonthlyDays <= 3650 && p.LimitGiB >= 1 && p.LimitGiB <= 500
}

type backupSnapshot struct {
	ID   string `json:"id"`
	Time string `json:"time"`
}
type backupEvent struct {
	At         string `json:"at"`
	FinishedAt string `json:"finishedAt"`
	Action     string `json:"action"`
	OK         bool   `json:"ok"`
}
type backupStatus struct {
	Ready               bool             `json:"ready"`
	Running             bool             `json:"running"`
	Phase               string           `json:"phase"`
	Error               string           `json:"error"`
	Heartbeat           string           `json:"heartbeat"`
	LastSuccess         string           `json:"lastSuccess"`
	NextRun             *string          `json:"nextRun"`
	VerifiedAt          string           `json:"verifiedAt"`
	FullCheckAt         string           `json:"fullCheckAt"`
	LastRestoreCheck    string           `json:"lastRestoreCheck"`
	ConnectionOK        bool             `json:"connectionOK"`
	ConnectionCheckedAt string           `json:"connectionCheckedAt"`
	AlertError          bool             `json:"alertError"`
	Bytes               int64            `json:"bytes"`
	Snapshots           []backupSnapshot `json:"snapshots"`
	History             []backupEvent    `json:"history"`
}

func readBackupJSON(path string, target any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 4<<20 {
		return fmt.Errorf("invalid control file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func saveBackupJSON(path string, value any) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".backup-policy-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = json.NewEncoder(file).Encode(value); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

func (a *app) applicationBackups(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if !a.user(id(r)).Permissions[chat.ManageApplication] {
		domainError(w, chat.ErrForbidden)
		return
	}
	dir := os.Getenv("BACKUP_CONTROL_DIR")
	if dir == "" || !filepath.IsAbs(dir) {
		write(w, 503, map[string]string{"error": "Служба резервного копирования не подключена / Backup service not connected"})
		return
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		write(w, 503, map[string]string{"error": "Каталог службы недоступен / Backup service unavailable"})
		return
	}
	backupControlMu.Lock()
	defer backupControlMu.Unlock()
	p := defaultBackupPolicy()
	if err = readBackupJSON(filepath.Join(dir, "policy.json"), &p); err != nil && !os.IsNotExist(err) || !p.valid() {
		write(w, 503, map[string]string{"error": "Некорректные настройки службы / Invalid backup settings"})
		return
	}
	var status backupStatus
	if err = readBackupJSON(filepath.Join(dir, "status.json"), &status); err != nil && !os.IsNotExist(err) {
		write(w, 503, map[string]string{"error": "Состояние службы недоступно / Backup status unavailable"})
		return
	}
	_, requestErr := os.Lstat(filepath.Join(dir, "request.json"))
	pending := requestErr == nil
	beat, _ := time.Parse(time.RFC3339Nano, status.Heartbeat)
	stale := beat.IsZero() || time.Since(beat) > 3*time.Minute
	// A running job updates phase only at boundaries; timer must not label a
	// long upload as dead until the systemd job time limit has passed.
	if status.Running {
		stale = beat.IsZero() || time.Since(beat) > 2*time.Hour
	}
	switch r.Method {
	case http.MethodGet:
		write(w, 200, map[string]any{"settings": p, "status": status, "pending": pending, "workerStale": stale})
	case http.MethodPut:
		var next backupPolicy
		if !decode(w, r, &next) {
			return
		}
		if !next.valid() {
			domainError(w, chat.ErrInvalid)
			return
		}
		if next.Enabled && (!status.Ready || stale) {
			write(w, 409, map[string]string{"error": "Сначала настройте и инициализируйте службу / Initialize the backup service first"})
			return
		}
		if err = saveBackupJSON(filepath.Join(dir, "policy.json"), next); err != nil {
			write(w, 503, map[string]string{"error": "Не удалось сохранить / Could not save"})
			return
		}
		write(w, 200, next)
	case http.MethodPost:
		var request struct {
			Action string `json:"action"`
		}
		if !decode(w, r, &request) {
			return
		}
		if request.Action != "run" && request.Action != "check" {
			domainError(w, chat.ErrInvalid)
			return
		}
		if pending || status.Running {
			write(w, 409, map[string]string{"error": "Операция уже выполняется или ожидает запуска / Operation already queued or running"})
			return
		}
		if stale || request.Action == "run" && !status.Ready {
			write(w, 409, map[string]string{"error": "Служба не готова / Backup service not ready"})
			return
		}
		file, err := os.OpenFile(filepath.Join(dir, "request.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			write(w, 409, map[string]string{"error": "Не удалось поставить в очередь / Could not enqueue"})
			return
		}
		err = json.NewEncoder(file).Encode(request)
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			os.Remove(filepath.Join(dir, "request.json"))
			write(w, 503, map[string]string{"error": "Ошибка очереди / Queue error"})
			return
		}
		write(w, 202, map[string]bool{"queued": true})
	}
}
