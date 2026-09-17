package main

import (
	"familychat/internal/chat"
	"net/http/httptest"
	"testing"
)

func TestApplicationFamiliesAuthentication(t *testing.T) {
	for _, route := range []struct{ method, path string }{{"GET", "/api/v1/application/families"}, {"GET", "/api/v1/application/families/example/members"}, {"GET", "/api/v1/application/families/example/candidates"}, {"PATCH", "/api/v1/application/families/example"}, {"PUT", "/api/v1/application/families/example/members/user"}, {"PATCH", "/api/v1/application/families/example/members/user"}, {"DELETE", "/api/v1/application/families/example/members/user"}} {
		a := testApp()
		w := httptest.NewRecorder()
		a.routes().ServeHTTP(w, httptest.NewRequest(route.method, route.path, nil))
		if w.Code != 401 {
			t.Fatal(route, w.Code)
		}
		w = httptest.NewRecorder()
		a.routes().ServeHTTP(w, authenticatedRequest(t, a, route.method, route.path, "{}"))
		if w.Code != 503 {
			t.Fatal(route, w.Code)
		}
		if w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("missing no-store")
		}
		a.chat = chat.New(chat.User{ID: "admin", Permissions: map[chat.Permission]bool{}})
		w = httptest.NewRecorder()
		a.routes().ServeHTTP(w, authenticatedRequest(t, a, route.method, route.path, "{}"))
		if w.Code != 403 {
			t.Fatal("ordinary account", route, w.Code)
		}
	}
}
