package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAndroidDownloads(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{"latest.json": "{}", "chatfamily-5.apk": "synthetic APK", "secret.json": "not public"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /downloads/android/{file}", androidDownloads(dir))
	for _, name := range []string{"latest.json", "chatfamily-5.apk", "secret.json", "missing.apk"} {
		r := httptest.NewRequest("GET", "/downloads/android/"+name, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		want := 404
		if name == "latest.json" || name == "chatfamily-5.apk" {
			want = 200
		}
		if w.Code != want {
			t.Fatal(name, w.Code)
		}
		if name == "latest.json" && w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("stale manifest")
		}
	}
	r := httptest.NewRequest("GET", "/downloads/android/chatfamily-5.apk", nil)
	r.Header.Set("Range", "bytes=0-3")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent {
		t.Fatal("range download", w.Code)
	}
}
