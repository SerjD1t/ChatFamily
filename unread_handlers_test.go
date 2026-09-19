package main

import (
	"net/http/httptest"
	"testing"
)

func TestUnreadRequiresAuthenticationAndDatabase(t *testing.T) {
	a := testApp()
	w := httptest.NewRecorder()
	a.routes().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/me/unread", nil))
	if w.Code != 401 {
		t.Fatalf("unauthenticated: %d", w.Code)
	}
	w = httptest.NewRecorder()
	a.routes().ServeHTTP(w, authenticatedRequest(t, a, "GET", "/api/v1/me/unread", ""))
	if w.Code != 503 || w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("unavailable count must not be zero or cached")
	}
}
