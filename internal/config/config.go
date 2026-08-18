package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config contains only deployment settings; secrets must be provided via environment variables.
type Config struct {
	Addr            string
	SessionSecret   string
	AdminEmail      string
	AdminPassword   string
	Retention       time.Duration
	MaxUploadBytes  int64
	UploadDirectory string
	DatabaseURL     string
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	PublicURL       string
	MailHost        string
	MailPort        string
	MailUsername    string
	MailPassword    string
	MailFrom        string
}

func Load() (Config, error) {
	days, err := strconv.Atoi(value("DELETED_RETENTION_DAYS", "30"))
	if err != nil || days < 1 {
		return Config{}, fmt.Errorf("DELETED_RETENTION_DAYS must be a positive integer")
	}
	max, err := strconv.ParseInt(value("MAX_UPLOAD_BYTES", "26214400"), 10, 64)
	if err != nil || max < 1 {
		return Config{}, fmt.Errorf("MAX_UPLOAD_BYTES must be a positive integer")
	}
	cfg := Config{Addr: value("APP_ADDR", ":8080"), SessionSecret: os.Getenv("SESSION_SECRET"), AdminEmail: os.Getenv("BOOTSTRAP_ADMIN_EMAIL"), AdminPassword: os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"), Retention: time.Duration(days) * 24 * time.Hour, MaxUploadBytes: max, UploadDirectory: value("UPLOAD_DIR", "./uploads"), DatabaseURL: os.Getenv("DATABASE_URL"), VAPIDPublicKey: os.Getenv("VAPID_PUBLIC_KEY"), VAPIDPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"), VAPIDSubject: value("VAPID_SUBJECT", "mailto:admin@localhost"), PublicURL: value("APP_PUBLIC_URL", "http://localhost:8080"), MailHost: os.Getenv("MAIL_HOST"), MailPort: value("MAIL_PORT", "587"), MailUsername: os.Getenv("MAIL_USERNAME"), MailPassword: os.Getenv("MAIL_PASSWORD"), MailFrom: os.Getenv("MAIL_FROM")}
	if len(cfg.SessionSecret) < 32 {
		return Config{}, fmt.Errorf("SESSION_SECRET must contain at least 32 characters")
	}
	if cfg.AdminEmail == "" || len(cfg.AdminPassword) < 12 {
		return Config{}, fmt.Errorf("BOOTSTRAP_ADMIN_EMAIL and a password of at least 12 characters are required")
	}
	return cfg, nil
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
