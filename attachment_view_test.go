package main

import (
	"familychat/internal/chat"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentRangesAndInlineTypes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "synthetic")
	if err := os.WriteFile(path, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, query, typ, rangeHeader string
		status                          int
		body                            string
	}{
		{"GET", "?inline=1", "video/mp4", "bytes=2-5", 206, "2345"},
		{"GET", "?inline=1", "image/png", "", 200, "0123456789"},
		{"HEAD", "?inline=1", "video/mp4", "", 200, ""},
		{"GET", "?inline=1", "image/svg+xml", "", 415, ""},
		{"GET", "?inline=1", "text/html", "", 415, ""},
		{"GET", "", "application/pdf", "", 200, "0123456789"},
		{"GET", "?inline=1", "video/mp4", "bytes=100-200", 416, ""},
	} {
		t.Run(tc.method+tc.typ+tc.rangeHeader, func(t *testing.T) {
			f, e := os.Open(path)
			if e != nil {
				t.Fatal(e)
			}
			defer f.Close()
			r := httptest.NewRequest(tc.method, "/api/v1/attachments/test"+tc.query, nil)
			r.Header.Set("Range", tc.rangeHeader)
			w := httptest.NewRecorder()
			serveAttachmentContent(w, r, f, chat.Attachment{Filename: "synthetic", ContentType: tc.typ})
			if w.Code != tc.status {
				t.Fatalf("status %d", w.Code)
			}
			if tc.status < 400 {
				if w.Body.String() != tc.body {
					t.Fatal("wrong body")
				}
				if w.Header().Get("Cache-Control") != "private, no-store" {
					t.Fatal("unsafe cache")
				}
				disposition := "inline"
				if tc.query == "" {
					disposition = "attachment"
				}
				if !strings.HasPrefix(w.Header().Get("Content-Disposition"), disposition) {
					t.Fatal("wrong disposition")
				}
				if tc.status == 206 && w.Header().Get("Content-Range") != "bytes 2-5/10" {
					t.Fatal("wrong range")
				}
			}
		})
	}
}
