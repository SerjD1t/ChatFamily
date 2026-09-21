package main

import (
	"net/http/httptest"
	"testing"
)

func TestPresenceRequiresAuthentication(t *testing.T) {
	a := &app{}
	for _, path := range []string{"/api/v1/me/activity", "/api/v1/presence"} {
		req := httptest.NewRequest("POST", path, nil)
		w := httptest.NewRecorder()
		a.auth(a.presence)(w, req)
		if w.Code != 401 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
}
