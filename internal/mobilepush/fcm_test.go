package mobilepush

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSend(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		status         int
		invalid        bool
	}{
		{"success", `{"name":"ok"}`, 200, false},
		{"expired", `{"error":{"details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`, 404, true},
		{"temporary", `{"error":{"status":"UNAVAILABLE"}}`, 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
					t.Error("invalid request")
				}
				var payload struct {
					Message struct {
						Token        string
						Data         map[string]string
						Notification map[string]string
						Android      struct {
							Notification struct {
								Count int `json:"notification_count"`
								Tag   string
							}
						}
					}
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				if payload.Message.Token != "test-token" || payload.Message.Data["conversationID"] != "conversation" || payload.Message.Data["userID"] != "user" {
					t.Error("invalid routing")
				}
				if payload.Message.Notification["body"] != "Новое сообщение" {
					t.Error("notification must use generic text")
				}
				if payload.Message.Android.Notification.Count != 7 || payload.Message.Android.Notification.Tag != "chat-unread" {
					t.Error("absolute unread count and one notification required")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.response))
			}))
			defer server.Close()
			client := &Client{http: server.Client(), endpoint: server.URL}
			status, invalid, err := client.Send(context.Background(), "test-token", "user", "conversation", "message", 7)
			if err != nil || status != tc.status || invalid != tc.invalid {
				t.Fatalf("unexpected result: status=%d invalid=%v err=%v", status, invalid, err)
			}
		})
	}
}

func TestOptionalConfiguration(t *testing.T) {
	client, err := New("")
	if client != nil || err != nil {
		t.Fatal("empty configuration should disable FCM")
	}
	if _, err := New(`{"type":"service_account","project_id":"example-project","token_uri":"https://untrusted.invalid"}`); err == nil {
		t.Fatal("untrusted token endpoint accepted")
	}
}
