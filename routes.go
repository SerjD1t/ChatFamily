package main

import (
	"net/http"
	"strings"
)

func (a *app) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("POST /api/v1/auth/login", a.limited(a.login))
	mux.HandleFunc("POST /login", a.limited(a.loginForm))
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("GET /api/v1/events", a.auth(a.events))
	mux.HandleFunc("POST /api/v1/invitations/accept", a.limited(a.acceptInvitation))
	mux.HandleFunc("POST /api/v1/attachments", a.limited(a.auth(a.uploadAttachment)))
	mux.HandleFunc("GET /api/v1/attachments/{id}", a.auth(a.downloadAttachment))
	mux.HandleFunc("GET /api/v1/auth/me", a.auth(a.me))
	mux.HandleFunc("GET /api/v1/push/public-key", a.auth(a.pushPublicKey))
	mux.HandleFunc("POST /api/v1/push/subscriptions", a.auth(a.savePushSubscription))
	mux.HandleFunc("DELETE /api/v1/push/subscriptions", a.auth(a.deletePushSubscription))
	mux.HandleFunc("GET /api/v1/users", a.auth(a.users))
	mux.HandleFunc("GET /api/v1/contacts", a.auth(a.contacts))
	mux.HandleFunc("POST /api/v1/users", a.auth(a.createUser))
	mux.HandleFunc("PATCH /api/v1/users/{userID}/permissions", a.auth(a.updateUserPermissions))
	mux.HandleFunc("POST /api/v1/invitations", a.auth(a.createInvitation))
	mux.HandleFunc("POST /api/v1/users/{userID}/direct-conversation", a.auth(a.directConversation))
	mux.HandleFunc("GET /api/v1/conversations", a.auth(a.conversations))
	mux.HandleFunc("GET /api/v1/favorites", a.auth(a.favorites))
	mux.HandleFunc("PUT /api/v1/conversations/{id}/favorite", a.auth(a.setFavorite))
	mux.HandleFunc("POST /api/v1/conversations", a.auth(a.createGroup))
	mux.HandleFunc("POST /api/v1/conversations/{id}/members", a.auth(a.addMember))
	mux.HandleFunc("DELETE /api/v1/conversations/{id}", a.auth(a.deleteGroup))
	mux.HandleFunc("GET /api/v1/conversations/{id}/members", a.auth(a.members))
	mux.HandleFunc("DELETE /api/v1/conversations/{id}/members/{userID}", a.auth(a.removeMember))
	mux.HandleFunc("GET /api/v1/conversations/{id}/member-candidates", a.auth(a.memberCandidates))
	mux.HandleFunc("GET /api/v1/conversations/{id}/messages", a.auth(a.messages))
	mux.HandleFunc("POST /api/v1/conversations/{id}/messages", a.auth(a.createMessage))
	mux.HandleFunc("POST /api/v1/conversations/{id}/delivery", a.auth(a.markDelivered))
	mux.HandleFunc("PATCH /api/v1/messages/{id}", a.auth(a.editMessage))
	mux.HandleFunc("DELETE /api/v1/messages/{id}", a.auth(a.deleteMessage))
	mux.HandleFunc("POST /api/v1/messages/{id}/reactions", a.auth(a.toggleReaction))
	static := http.FileServer(http.Dir("web"))
	mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".js") || r.URL.Path == "/" {
			w.Header().Set("Cache-Control", "no-store")
		}
		static.ServeHTTP(w, r)
	}))
	return mux
}
