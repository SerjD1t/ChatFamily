package main

import (
	"context"
	"familychat/internal/chat"
	"familychat/internal/store"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var mailJobs = make(chan struct{}, 4)

func (a *app) emailLink(purpose, token string) (string, error) {
	u, err := url.Parse(a.cfg.PublicURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return "", chat.ErrInvalid
	}
	u.Path = "/"
	u.RawQuery = ""
	u.Fragment = url.Values{"emailAction": {purpose}, "token": {token}}.Encode()
	return u.String(), nil
}
func (a *app) queueEmailAction(email, purpose, first, last, invite string) {
	select {
	case mailJobs <- struct{}{}:
	default:
		return
	}
	go func() {
		defer func() { <-mailJobs }()
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		token, err := a.db.IssueEmailAction(ctx, email, purpose, first, last, invite)
		if err != nil || token == "" {
			return
		}
		link, err := a.emailLink(purpose, token)
		if err != nil {
			a.db.CancelEmailAction(ctx, token)
			return
		}
		subject := "ChatFamily: подтверждение регистрации"
		body := "Для подтверждения адреса и завершения регистрации откройте ссылку и задайте пароль. Ссылка действует 24 часа.\n\nTo verify your email and complete registration, open the link and set a password. The link expires in 24 hours."
		if purpose == "reset" {
			subject = "ChatFamily: восстановление пароля"
			body = "Чтобы задать новый пароль, откройте ссылку. Она действует 30 минут. Если вы не запрашивали сброс, ничего не делайте.\n\nOpen the link to set a new password. It expires in 30 minutes. If you did not request this reset, ignore this email."
		}
		// A transport timeout can happen after SMTP accepted the message. Keep the
		// expiring token valid; otherwise an actually delivered link may be broken.
		_ = a.sendMail(ctx, strings.TrimSpace(email), subject, body+"\n\n"+link)
	}()
}
func (a *app) emailPolicy(w http.ResponseWriter, r *http.Request) {
	policy, err := a.mailPolicy(r.Context())
	if err != nil {
		write(w, 503, map[string]string{"error": "Почтовый сервис недоступен"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	write(w, 200, policy)
}
func (a *app) requestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !decode(w, r, &in) {
		return
	}
	policy, err := a.mailPolicy(r.Context())
	if err != nil || !policy.Enabled || a.db == nil {
		write(w, 503, map[string]string{"error": "Восстановление по почте пока недоступно / Email recovery unavailable"})
		return
	}
	if _, err = store.NormalizeEmail(in.Email); err == nil {
		a.queueEmailAction(in.Email, "reset", "", "", "")
	}
	// Same response and asynchronous work for registered/unknown/disabled emails.
	write(w, 202, map[string]bool{"accepted": true})
}
func (a *app) completeEmailAction(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	var in struct {
		Purpose  string `json:"purpose"`
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	email, err := a.db.ConsumeEmailAction(r.Context(), in.Purpose, in.Token, in.Password, a.passwordMinLength())
	if err != nil {
		write(w, 400, map[string]string{"error": "Ссылка недействительна или истекла. Проверьте требования к паролю / Invalid or expired link; check password requirements"})
		return
	}
	if in.Purpose == "reset" {
		// Success does not depend on the security notice being delivered. The notice
		// never includes the password, action token or other session credentials.
		select {
		case mailJobs <- struct{}{}:
			go func() {
				defer func() { <-mailJobs }()
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				_ = a.sendMail(ctx, email, "ChatFamily: пароль изменён / Password changed", "Пароль вашего аккаунта изменён. Предыдущие сессии завершены. Если это были не вы, повторно восстановите пароль и обратитесь к администратору.\n\nYour password has changed and previous sessions have been revoked. If this was not you, reset your password and contact the administrator.")
			}()
		default:
		}
	}
	// Never automatically authenticate with a recovery/registration link.
	a.logout(w, r)
}
