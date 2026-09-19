package main

import (
	"familychat/internal/chat"
	"mime"
	"net/http"
	"os"
)

// Called only after AttachmentObject has authorized the current user.
func serveAttachmentContent(w http.ResponseWriter, r *http.Request, file *os.File, attachment chat.Attachment) {
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	disposition := "attachment"
	if r.URL.Query().Get("inline") == "1" {
		kind := previewKind(attachment.ContentType)
		if kind != "image" && kind != "video" {
			http.Error(w, "Unsupported media", http.StatusUnsupportedMediaType)
			return
		}
		disposition = "inline"
	}
	w.Header().Set("Content-Type", attachment.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": attachment.Filename}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, attachment.Filename, info.ModTime(), file)
}
