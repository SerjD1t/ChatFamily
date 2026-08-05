package main

import (
	"context"
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"familychat/internal/chat"
	"familychat/internal/config"
	"familychat/internal/store"
	"github.com/SherClockHolmes/webpush-go"
)

type app struct {
	cfg     config.Config
	chat    chat.Backend
	db      *store.Postgres
	hub     *hub
	limiter *rateLimiter
}

type sessionKey struct{}

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("некорректная конфигурация", "error", err)
		os.Exit(1)
	}
	admin := chat.User{ID: "admin", Email: cfg.AdminEmail, Name: "Администратор", Permissions: map[chat.Permission]bool{
		chat.ManageUsers: true, chat.CreateGroups: true, chat.ManageGroupMembers: true,
		chat.ManageGroupSettings: true, chat.SendMessages: true, chat.EditOwnMessages: true, chat.DeleteOwnMessages: true,
	}}
	var postgres *store.Postgres
	if cfg.DatabaseURL != "" {
		postgres, err = store.Open(context.Background(), cfg.DatabaseURL)
		if err != nil {
			slog.Error("не удалось подключиться к PostgreSQL", "error", err)
			os.Exit(1)
		}
		defer postgres.Close()
		if err := postgres.Migrate(context.Background()); err != nil {
			slog.Error("не удалось применить миграции PostgreSQL", "error", err)
			os.Exit(1)
		}
		if err := postgres.Bootstrap(context.Background(), admin); err != nil {
			slog.Error("не удалось подготовить начальные данные PostgreSQL", "error", err)
			os.Exit(1)
		}
	}
	backend := chat.Backend(chat.New(admin))
	if cfg.DatabaseURL != "" {
		backend = postgres
	}
	a := &app{cfg: cfg, chat: backend, db: postgres, hub: newHub(), limiter: newRateLimiter(12, time.Minute)}
	mux := a.routes()

	server := &http.Server{Addr: cfg.Addr, Handler: headers(requestDeadline(mux)), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	slog.Info("семейный чат запущен", "address", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("сервер остановлен", "error", err)
	}
}
func (a *app) events(w http.ResponseWriter, r *http.Request) { a.hub.serve(w, r) }

func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
func (a *app) health(w http.ResponseWriter, _ *http.Request) {
	write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	userID, ok := a.authenticate(in.Email, in.Password)
	if !ok {
		write(w, http.StatusUnauthorized, map[string]string{"error": "Неверный адрес или пароль"})
		return
	}
	a.setSession(w, r, userID)
	write(w, http.StatusOK, a.user(userID))
}
func (a *app) loginForm(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/?login=error", http.StatusSeeOther)
		return
	}
	userID, ok := a.authenticate(r.FormValue("email"), r.FormValue("password"))
	if !ok {
		http.Redirect(w, r, "/?login=error", http.StatusSeeOther)
		return
	}
	a.setSession(w, r, userID)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
func (a *app) authenticate(email, password string) (string, bool) {
	if a.db != nil {
		if user, ok := a.db.Authenticate(email, password); ok {
			return user.ID, true
		}
	}
	validEmail := subtle.ConstantTimeCompare([]byte(strings.ToLower(strings.TrimSpace(email))), []byte(strings.ToLower(a.cfg.AdminEmail))) == 1
	validPassword := subtle.ConstantTimeCompare([]byte(password), []byte(a.cfg.AdminPassword)) == 1
	return "admin", validEmail && validPassword
}
func (a *app) setSession(w http.ResponseWriter, r *http.Request, userID string) {
	http.SetCookie(w, &http.Cookie{Name: "family_session", Value: a.sign(userID, time.Now().Add(14*24*time.Hour)), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", MaxAge: 14 * 24 * 60 * 60})
}
func (a *app) logout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "family_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) createInvitation(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Приглашения требуют PostgreSQL"})
		return
	}
	var in struct {
		Email       string            `json:"email"`
		Permissions []chat.Permission `json:"permissions"`
		ExpiresAt   *time.Time        `json:"expiresAt"`
	}
	if !decode(w, r, &in) {
		return
	}
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	if in.ExpiresAt != nil {
		expiresAt = *in.ExpiresAt
	}
	token, err := a.db.CreateInvitation(a.user(id(r)), in.Email, in.Permissions, expiresAt)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusCreated, map[string]any{"token": token, "expiresAt": expiresAt.UTC()})
}
func (a *app) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Приглашения требуют PostgreSQL"})
		return
	}
	var in struct {
		Token    string `json:"token"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	user, err := a.db.AcceptInvitation(in.Token, in.Name, in.Password)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusCreated, user)
}
func (a *app) uploadAttachment(w http.ResponseWriter, r *http.Request) {
	filename := filepath.Base(strings.TrimSpace(r.Header.Get("X-Filename")))
	if filename == "." || filename == "" || filename == string(filepath.Separator) {
		write(w, 400, map[string]string{"error": "Не указано имя файла"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxUploadBytes)
	defer r.Body.Close()
	data, err := io.ReadAll(r.Body)
	if err != nil {
		write(w, 400, map[string]string{"error": "Файл слишком большой или повреждён"})
		return
	}
	if len(data) == 0 {
		write(w, 400, map[string]string{"error": "Пустой файл"})
		return
	}
	if err := os.MkdirAll(a.cfg.UploadDirectory, 0700); err != nil {
		write(w, 500, map[string]string{"error": "Не удалось подготовить хранилище"})
		return
	}
	b := make([]byte, 16)
	if _, err = cryptorand.Read(b); err != nil {
		write(w, 500, map[string]string{"error": "Не удалось сохранить файл"})
		return
	}
	attachmentID := hex.EncodeToString(b)
	path := filepath.Join(a.cfg.UploadDirectory, attachmentID)
	if err = os.WriteFile(path, data, 0600); err != nil {
		write(w, 500, map[string]string{"error": "Не удалось сохранить файл"})
		return
	}
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	write(w, http.StatusCreated, chat.Attachment{ID: attachmentID, Filename: filename, ContentType: contentType, Bytes: int64(len(data))})
}
func (a *app) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Вложения требуют PostgreSQL"})
		return
	}
	key, attachment, err := a.db.AttachmentObject(id(r), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	path := filepath.Join(a.cfg.UploadDirectory, filepath.Base(key))
	data, err := os.ReadFile(path)
	if err != nil {
		write(w, http.StatusNotFound, map[string]string{"error": "Файл не найден"})
		return
	}
	w.Header().Set("Content-Type", attachment.ContentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(attachment.Filename, "\"", "")+"\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
func (a *app) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("family_session")
		if err != nil {
			write(w, 401, map[string]string{"error": "Требуется вход"})
			return
		}
		id, ok := a.verify(cookie.Value)
		if !ok {
			write(w, 401, map[string]string{"error": "Сессия истекла"})
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, id)))
	}
}
func (a *app) user(id string) chat.User                  { u, _ := a.chat.User(id); return u }
func id(r *http.Request) string                          { return r.Context().Value(sessionKey{}).(string) }
func (a *app) me(w http.ResponseWriter, r *http.Request) { write(w, 200, a.user(id(r))) }
func (a *app) pushPublicKey(w http.ResponseWriter, r *http.Request) {
	if a.cfg.VAPIDPublicKey == "" {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Уведомления не настроены"})
		return
	}
	write(w, http.StatusOK, map[string]string{"publicKey": a.cfg.VAPIDPublicKey})
}
func (a *app) savePushSubscription(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Уведомления требуют PostgreSQL"})
		return
	}
	var subscription webpush.Subscription
	if !decode(w, r, &subscription) {
		return
	}
	if err := a.db.SavePushSubscription(a.user(id(r)), subscription); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) deletePushSubscription(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Уведомления требуют PostgreSQL"})
		return
	}
	var in struct {
		Endpoint string `json:"endpoint"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.DeletePushSubscription(a.user(id(r)), in.Endpoint); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) users(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Управление пользователями требует PostgreSQL"})
		return
	}
	users, err := a.db.Users(a.user(id(r)))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, users)
}
func (a *app) contacts(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Список участников требует PostgreSQL"})
		return
	}
	contacts, err := a.db.Contacts(a.user(id(r)))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, contacts)
}
func (a *app) updateUserPermissions(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Управление пользователями требует PostgreSQL"})
		return
	}
	var in struct {
		Permissions []chat.Permission `json:"permissions"`
	}
	if !decode(w, r, &in) {
		return
	}
	user, err := a.db.UpdateUserPermissions(a.user(id(r)), r.PathValue("userID"), in.Permissions)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, user)
}
func (a *app) conversations(w http.ResponseWriter, r *http.Request) {
	write(w, 200, a.chat.Conversations(id(r)))
}
func (a *app) favorites(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Избранное требует PostgreSQL"})
		return
	}
	ids, err := a.db.FavoriteIDs(a.user(id(r)))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, ids)
}
func (a *app) setFavorite(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, http.StatusServiceUnavailable, map[string]string{"error": "Избранное требует PostgreSQL"})
		return
	}
	var in struct {
		Favorite bool `json:"favorite"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.SetFavorite(a.user(id(r)), r.PathValue("id"), in.Favorite); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) createGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title     string   `json:"title"`
		MemberIDs []string `json:"memberIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	c, err := a.chat.CreateGroup(a.user(id(r)), in.Title, in.MemberIDs)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 201, c)
}
func (a *app) messages(w http.ResponseWriter, r *http.Request) {
	out, err := a.chat.Messages(a.user(id(r)), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, out)
}
func (a *app) createMessage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body        string            `json:"body"`
		Attachments []chat.Attachment `json:"attachments"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, err := a.chat.CreateMessage(a.user(id(r)), r.PathValue("id"), in.Body, in.Attachments)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 201, m)
	a.hub.publish()
	go a.notifyMessage(m)
}
func (a *app) editMessage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body string `json:"body"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, err := a.chat.EditMessage(a.user(id(r)), r.PathValue("id"), in.Body)
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, m)
	a.hub.publish()
}
func (a *app) deleteMessage(w http.ResponseWriter, r *http.Request) {
	m, err := a.chat.DeleteMessage(a.user(id(r)), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, m)
	a.hub.publish()
}
func (a *app) toggleReaction(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Реакции требуют PostgreSQL"})
		return
	}
	var in struct {
		Emoji string `json:"emoji"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.db.ToggleReaction(a.user(id(r)), r.PathValue("id"), in.Emoji); err != nil {
		domainError(w, err)
		return
	}
	if conversationID, err := a.db.ReactionConversation(a.user(id(r)), r.PathValue("id")); err == nil {
		go a.notifyReaction(conversationID, a.user(id(r)).Name, in.Emoji)
	}
	w.WriteHeader(http.StatusNoContent)
	a.hub.publish()
}
func domainError(w http.ResponseWriter, err error) {
	if errors.Is(err, chat.ErrForbidden) {
		write(w, 403, map[string]string{"error": "Недостаточно прав"})
		return
	}
	if errors.Is(err, chat.ErrNotFound) {
		write(w, 404, map[string]string{"error": "Не найдено"})
		return
	}
	write(w, 400, map[string]string{"error": "Некорректные данные"})
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	defer r.Body.Close()
	if json.NewDecoder(r.Body).Decode(target) != nil {
		write(w, 400, map[string]string{"error": "Некорректный JSON"})
		return false
	}
	return true
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a *app) sign(user string, until time.Time) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(user + "|" + until.UTC().Format(time.RFC3339)))
	mac := hmac.New(sha256.New, []byte(a.cfg.SessionSecret))
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (a *app) verify(token string) (string, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(a.cfg.SessionSecret))
	mac.Write([]byte(parts[0]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, mac.Sum(nil)) {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	p := strings.Split(string(raw), "|")
	if len(p) != 2 {
		return "", false
	}
	until, err := time.Parse(time.RFC3339, p[1])
	return p[0], err == nil && time.Now().Before(until)
}

func (a *app) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID          string            `json:"id"`
		Email       string            `json:"email"`
		Name        string            `json:"name"`
		Permissions []chat.Permission `json:"permissions"`
	}
	if !decode(w, r, &in) {
		return
	}
	permissions := make(map[chat.Permission]bool, len(in.Permissions))
	for _, permission := range in.Permissions {
		permissions[permission] = true
	}
	if in.ID == "" {
		in.ID = strings.ToLower(strings.TrimSpace(in.Email))
	}
	err := a.chat.AddUser(a.user(id(r)), chat.User{ID: in.ID, Email: in.Email, Name: in.Name, Permissions: permissions})
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusCreated, map[string]string{"id": in.ID})
}

func (a *app) directConversation(w http.ResponseWriter, r *http.Request) {
	conversation, err := a.chat.DirectConversation(a.user(id(r)), r.PathValue("userID"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, http.StatusOK, conversation)
}

func (a *app) addMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID string `json:"userId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := a.chat.AddMember(a.user(id(r)), r.PathValue("id"), in.UserID); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) members(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Управление участниками требует PostgreSQL"})
		return
	}
	members, err := a.db.Members(a.user(id(r)), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, members)
}
func (a *app) removeMember(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Управление участниками требует PostgreSQL"})
		return
	}
	err := a.db.RemoveMember(a.user(id(r)), r.PathValue("id"), r.PathValue("userID"))
	if err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (a *app) deleteGroup(w http.ResponseWriter, r *http.Request) {
	if err := a.chat.DeleteGroup(a.user(id(r)), r.PathValue("id")); err != nil {
		domainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	a.hub.publish()
}

func (a *app) memberCandidates(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Управление участниками требует PostgreSQL"})
		return
	}
	users, err := a.db.MemberCandidates(a.user(id(r)), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	write(w, 200, users)
}
