package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"familychat/internal/chat"
	"familychat/internal/store"
)

func (a *app) forwardMessage(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		write(w, 503, map[string]string{"error": "Требуется PostgreSQL / PostgreSQL required"})
		return
	}
	var in struct {
		ConversationID string `json:"conversationId"`
		RequestID      string `json:"requestId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !shareRequestID.MatchString(in.RequestID) || in.ConversationID == "" || len(in.ConversationID) > 200 {
		domainError(w, chat.ErrInvalid)
		return
	}
	var paths []string
	m, created, err := a.db.ForwardMessage(r.Context(), a.user(id(r)), r.PathValue("id"), in.ConversationID, in.RequestID, func(key string, file chat.Attachment) (chat.Attachment, error) {
		if key == "" || key == "." || filepath.Base(key) != key {
			return file, chat.ErrInvalid
		}
		info, e := os.Lstat(filepath.Join(a.cfg.UploadDirectory, key))
		if e != nil || !info.Mode().IsRegular() || info.Size() != file.Bytes {
			return file, chat.ErrInvalid
		}
		source, e := os.Open(filepath.Join(a.cfg.UploadDirectory, key))
		if e != nil {
			return file, chat.ErrInvalid
		}
		defer source.Close()
		var random [16]byte
		if _, e = rand.Read(random[:]); e != nil {
			return file, e
		}
		target, e := os.OpenFile(filepath.Join(a.cfg.UploadDirectory, hex.EncodeToString(random[:])), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return file, e
		}
		paths = append(paths, target.Name())
		size, e := io.Copy(target, io.LimitReader(source, file.Bytes+1))
		closeErr := target.Close()
		if e != nil {
			return file, e
		}
		if closeErr != nil {
			return file, closeErr
		}
		if size != file.Bytes {
			return file, chat.ErrInvalid
		}
		file.ID = filepath.Base(target.Name())
		return file, nil
	})
	// Unknown commit outcome: retain files, and let retries recover the receipt.
	if !created && !errors.Is(err, store.ErrForwardCommitUnknown) {
		for _, path := range paths {
			_ = os.Remove(path)
		}
	}
	if err != nil {
		if errors.Is(err, store.ErrShareConflict) {
			write(w, 409, map[string]string{"error": "Отправка уже использована / Request already used"})
		} else {
			domainError(w, err)
		}
		return
	}
	write(w, 200, map[string]string{"messageId": m.ID, "conversationId": m.ConversationID})
	if created {
		a.hub.publish(realtimeEvent{Type: "message.created", ConversationID: m.ConversationID, MessageID: m.ID})
		go a.notifyMessage(m)
	}
}
