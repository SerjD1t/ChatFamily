package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"familychat/internal/chat"
	"familychat/internal/store"
)

const mobileMaxTotal = 100 << 20
const mobileMaxFiles = 10

var shareRequestID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func (a *app) mobileShare(w http.ResponseWriter, r *http.Request) {
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(10 * time.Minute))
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Minute))
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL"})
		return
	}
	if !shareRequestID.MatchString(r.PathValue("requestID")) {
		write(w, 400, map[string]string{"error": "Некорректный идентификатор отправки"})
		return
	}
	if r.Header.Get("X-Expected-User") != id(r) {
		write(w, 409, map[string]string{"error": "Войдите в аккаунт, подтвердивший отправку"})
		return
	}
	actor := a.user(id(r))
	if !actor.Permissions[chat.SendMessages] {
		domainError(w, chat.ErrForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, mobileMaxTotal+(1<<20))
	defer r.Body.Close()
	reader, err := r.MultipartReader()
	if err != nil {
		write(w, 400, map[string]string{"error": "Ожидается multipart/form-data"})
		return
	}
	if err = os.MkdirAll(a.cfg.UploadDirectory, 0700); err != nil {
		write(w, 500, map[string]string{"error": "Хранилище недоступно"})
		return
	}
	var files []chat.Attachment
	var paths []string
	keep := false
	defer func() {
		if !keep {
			for _, p := range paths {
				_ = os.Remove(p)
			}
		}
	}()
	fields := map[string]string{}
	hashes := []string{}
	var total int64
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			write(w, 400, map[string]string{"error": "Повреждённая загрузка"})
			return
		}
		if part.FormName() != "files" {
			name := part.FormName()
			if name != "conversationId" && name != "body" {
				write(w, 400, map[string]string{"error": "Неизвестное поле"})
				return
			}
			if _, exists := fields[name]; exists {
				write(w, 400, map[string]string{"error": "Повтор поля"})
				return
			}
			data, e := io.ReadAll(io.LimitReader(part, 16001))
			if e != nil || len(data) > 16000 {
				write(w, 400, map[string]string{"error": "Слишком длинное поле"})
				return
			}
			fields[name] = string(data)
			continue
		}
		name := filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		if name == "." || name == "/" || name == "" || len(name) > 512 || strings.ContainsAny(name, "\r\n\x00") || len(files) >= mobileMaxFiles {
			write(w, 400, map[string]string{"error": "Некорректное имя или слишком много файлов"})
			return
		}
		file, e := os.CreateTemp(a.cfg.UploadDirectory, "share-")
		if e != nil {
			write(w, 500, map[string]string{"error": "Не удалось сохранить файл"})
			return
		}
		paths = append(paths, file.Name())
		digest := sha256.New()
		size, e := io.Copy(io.MultiWriter(file, digest), io.LimitReader(part, a.cfg.MaxUploadBytes+1))
		closeErr := file.Close()
		total += size
		if e != nil || closeErr != nil || size == 0 || size > a.cfg.MaxUploadBytes || total > mobileMaxTotal {
			write(w, 413, map[string]string{"error": "Файл пустой, повреждён или превышает лимит"})
			return
		}
		contentType, _, e := mime.ParseMediaType(part.Header.Get("Content-Type"))
		if e != nil {
			contentType = "application/octet-stream"
		}
		files = append(files, chat.Attachment{ID: filepath.Base(file.Name()), Filename: name, ContentType: contentType, Bytes: size})
		hashes = append(hashes, hex.EncodeToString(digest.Sum(nil)))
	}
	cid, body := fields["conversationId"], strings.TrimSpace(fields["body"])
	if cid == "" || len(cid) > 200 || len([]rune(body)) > 4000 || (len(files) == 0 && body == "") {
		write(w, 400, map[string]string{"error": "Выберите чат и содержимое"})
		return
	}
	// Exclude random storage IDs from the fingerprint of immutable request content.
	metadata := append([]chat.Attachment(nil), files...)
	for i := range metadata {
		metadata[i].ID = ""
	}
	canonical, _ := json.Marshal(struct {
		Conversation, Body string
		Files              []chat.Attachment
		Hashes             []string
	}{cid, body, metadata, hashes})
	fingerprint := sha256.Sum256(canonical)
	m, created, err := a.db.CreateSharedMessage(r.Context(), actor, r.PathValue("requestID"), hex.EncodeToString(fingerprint[:]), cid, body, files)
	if err != nil {
		if errors.Is(err, store.ErrShareConflict) {
			write(w, 409, map[string]string{"error": "Эта отправка уже использована для другого содержимого"})
			return
		}
		// A commit error may mean a lost acknowledgement. Never remove possibly committed files.
		keep = !errors.Is(err, chat.ErrForbidden) && !errors.Is(err, chat.ErrInvalid)
		if keep {
			write(w, http.StatusServiceUnavailable, map[string]string{"error": "Не удалось подтвердить отправку. Повторите с тем же идентификатором"})
		} else {
			domainError(w, err)
		}
		return
	}
	keep = created
	write(w, http.StatusOK, map[string]string{"messageId": m.ID, "conversationId": m.ConversationID})
	if created {
		a.hub.publish(realtimeEvent{Type: "message.created", ConversationID: m.ConversationID, MessageID: m.ID})
		go a.notifyMessage(m)
	}
}
