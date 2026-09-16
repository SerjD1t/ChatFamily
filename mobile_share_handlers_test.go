package main

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"familychat/internal/chat"
	"familychat/internal/store"
)

func TestMultipartAttachmentUnicode(t *testing.T) {
	a := testApp()
	a.cfg.UploadDirectory = t.TempDir()
	a.cfg.MaxUploadBytes = 1024
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, _ := form.CreateFormFile("file", "Список покупок.txt")
	file.Write([]byte("bread"))
	form.Close()
	r := authenticatedRequest(t, a, "POST", "/api/v1/attachments", body.String())
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	a.auth(a.uploadAttachment)(w, r)
	if w.Code != 201 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var got chat.Attachment
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Filename != "Список покупок.txt" || got.Bytes != 5 {
		t.Fatalf("unexpected metadata: %+v", got)
	}
}

func TestMobileShareRejectsWrongAccountAndOversize(t *testing.T) {
	for _, tc := range []struct {
		name, expected, content string
		status                  int
	}{
		{"account mismatch", "another", "small", 409},
		{"oversize", "admin", "too long", 413},
		{"empty", "admin", "", 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := testApp()
			a.db = &store.Postgres{}
			a.cfg.UploadDirectory = t.TempDir()
			a.cfg.MaxUploadBytes = 4
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			form.WriteField("conversationId", "family")
			form.WriteField("body", "")
			file, _ := form.CreateFormFile("files", "file.txt")
			file.Write([]byte(tc.content))
			form.Close()
			r := authenticatedRequest(t, a, "POST", "/api/v1/mobile/shares/12345678-1234-1234-1234-123456789abc", body.String())
			r.SetPathValue("requestID", "12345678-1234-1234-1234-123456789abc")
			r.Header.Set("X-Expected-User", tc.expected)
			r.Header.Set("Content-Type", form.FormDataContentType())
			w := httptest.NewRecorder()
			// Exercise upload validation after authentication; this fixture has no database pool.
			a.mobileShare(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, "admin")))
			if w.Code != tc.status {
				t.Fatalf("status %d", w.Code)
			}
			files, _ := os.ReadDir(a.cfg.UploadDirectory)
			if len(files) != 0 {
				t.Fatal("rejected upload left files")
			}
		})
	}
}

func TestMobileCORSAllowlist(t *testing.T) {
	for _, origin := range []string{"https://chatfamily.site", "https://evil.example", "http://chatfamily.site"} {
		r := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/me", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		handled := mobileCORS(w, r)
		if handled != (origin == "https://chatfamily.site") {
			t.Fatalf("unexpected allowance for %s", origin)
		}
		if !handled && w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("untrusted CORS origin")
		}
	}
}
