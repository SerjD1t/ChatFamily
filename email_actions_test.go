package main

import (
	"context"
	"familychat/internal/chat"
	"familychat/internal/config"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestEmailLinksKeepTokensOutOfQueries(t *testing.T) {
	a := &app{cfg: config.Config{PublicURL: "https://example.test/"}}
	raw, err := a.emailLink("reset", "synthetic-test-token")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(raw)
	if u.RawQuery != "" || !strings.Contains(u.Fragment, "token=") {
		t.Fatal("token must be in fragment")
	}
	a.cfg.PublicURL = "http://example.test/"
	if _, err = a.emailLink("reset", "test"); err == nil {
		t.Fatal("non-HTTPS reset URL")
	}
}
func TestMailAdministrationDeniedWithoutPermission(t *testing.T) {
	a := &app{chat: chat.New(chat.User{ID: "member", Permissions: map[chat.Permission]bool{}})}
	request := httptest.NewRequest("GET", "/api/v1/application/mail", nil)
	request = request.WithContext(context.WithValue(request.Context(), sessionKey{}, "member"))
	response := httptest.NewRecorder()
	a.mailSettings(response, request)
	if response.Code != 403 {
		t.Fatalf("status %d", response.Code)
	}
}
