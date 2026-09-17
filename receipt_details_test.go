package main

import (
	"net/http/httptest"
	"testing"
)

func TestReceiptDetailsRequireAuthentication(t *testing.T) {
	a := testApp()
	w := httptest.NewRecorder()
	a.routes().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/messages/example/receipts", nil))
	if w.Code != 401 {
		t.Fatalf("status %d", w.Code)
	}
	w = httptest.NewRecorder()
	a.routes().ServeHTTP(w, authenticatedRequest(t, a, "GET", "/api/v1/messages/example/receipts", ""))
	if w.Code != 503 {
		t.Fatalf("without database status %d", w.Code)
	}
	if w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("receipt metadata must not be cached")
	}
}
