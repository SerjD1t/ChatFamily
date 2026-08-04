package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"familychat/internal/chat"
	"familychat/internal/config"
)

func testApp() *app {
	admin := chat.User{ID: "admin", Email: "admin@example.test", Name: "Администратор", Permissions: map[chat.Permission]bool{
		chat.ManageUsers: true, chat.CreateGroups: true, chat.ManageGroupMembers: true,
		chat.SendMessages: true, chat.EditOwnMessages: true, chat.DeleteOwnMessages: true,
	}}
	return &app{cfg: config.Config{SessionSecret: "01234567890123456789012345678901", AdminEmail: admin.Email}, chat: chat.New(admin)}
}

func authenticatedRequest(t *testing.T, a *app, method, path, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	r.AddCookie(&http.Cookie{Name: "family_session", Value: a.sign("admin", now().AddDate(0, 0, 1))})
	return r
}

func now() time.Time { return time.Now() }

func TestCreateUserAndDirectConversationAPI(t *testing.T) {
	a := testApp()
	create := httptest.NewRecorder()
	a.auth(a.createUser).ServeHTTP(create, authenticatedRequest(t, a, http.MethodPost, "/api/v1/users", `{"id":"member","email":"member@example.test","name":"Участник"}`))
	if create.Code != http.StatusCreated {
		t.Fatalf("create user status = %d, want %d", create.Code, http.StatusCreated)
	}

	direct := httptest.NewRecorder()
	r := authenticatedRequest(t, a, http.MethodPost, "/api/v1/users/member/direct-conversation", "")
	r.SetPathValue("userID", "member")
	a.auth(a.directConversation).ServeHTTP(direct, r)
	if direct.Code != http.StatusOK {
		t.Fatalf("direct conversation status = %d, want %d", direct.Code, http.StatusOK)
	}
}

func TestOnlyGroupAcceptsNewMembers(t *testing.T) {
	a := testApp()
	if err := a.chat.AddUser(a.user("admin"), chat.User{ID: "member", Email: "member@example.test", Name: "Участник"}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	r := authenticatedRequest(t, a, http.MethodPost, "/api/v1/conversations/family/members", `{"userId":"member"}`)
	r.SetPathValue("id", "family")
	a.auth(a.addMember).ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
}
