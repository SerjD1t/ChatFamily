// Package mobilepush sends native Android notifications through FCM HTTP v1.
package mobilepush

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type Client struct {
	http     *http.Client
	endpoint string
}

var projectName = regexp.MustCompile(`^[a-z][a-z0-9-]{4,61}[a-z0-9]$`)

// NewFromSettings reads only the server credential block from a mounted local settings file.
func NewFromSettings(path string) (*Client, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.New("cannot read FCM settings")
	}
	var settings struct {
		Firebase struct {
			ServiceAccount json.RawMessage `json:"serviceAccount"`
		} `json:"firebase"`
	}
	if json.Unmarshal(raw, &settings) != nil || len(settings.Firebase.ServiceAccount) == 0 {
		return nil, errors.New("invalid FCM settings")
	}
	return New(string(settings.Firebase.ServiceAccount))
}

func New(serviceAccount string) (*Client, error) {
	if serviceAccount == "" {
		return nil, nil
	}
	var fields struct {
		Type      string `json:"type"`
		ProjectID string `json:"project_id"`
		TokenURI  string `json:"token_uri"`
	}
	invalid := errors.New("invalid FCM service account configuration")
	if json.Unmarshal([]byte(serviceAccount), &fields) != nil || fields.Type != "service_account" || !projectName.MatchString(fields.ProjectID) || fields.TokenURI != "https://oauth2.googleapis.com/token" {
		return nil, invalid
	}
	cfg, err := google.JWTConfigFromJSON([]byte(serviceAccount), "https://www.googleapis.com/auth/firebase.messaging")
	if err != nil {
		return nil, invalid
	}
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Timeout: 15 * time.Second})
	transport := &oauth2.Transport{Source: oauth2.ReuseTokenSource(nil, cfg.TokenSource(ctx)), Base: http.DefaultTransport}
	return &Client{http: &http.Client{Timeout: 20 * time.Second, Transport: transport}, endpoint: "https://fcm.googleapis.com/v1/projects/" + fields.ProjectID + "/messages:send"}, nil
}

// Send returns only a status and an invalid-token flag; provider bodies/tokens are never logged.
func (c *Client) Send(ctx context.Context, token, uid, cid, kind string) (int, bool, error) {
	body := "Новое сообщение"
	if kind == "reaction" {
		body = "Новая реакция на сообщение"
	}
	payload, _ := json.Marshal(map[string]any{"message": map[string]any{
		"token": token, "notification": map[string]string{"title": "ChatFamily", "body": body},
		"data":    map[string]string{"conversationID": cid, "userID": uid, "kind": kind},
		"android": map[string]any{"priority": "HIGH", "ttl": "300s", "notification": map[string]string{"channel_id": "chat_messages", "tag": "chat-" + cid}},
	}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return 0, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return 0, false, err
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 65536))
	var result struct {
		Error struct {
			Details []struct {
				Type string `json:"@type"`
				Code string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &result)
	invalid := false
	for _, d := range result.Error.Details {
		if d.Type == "type.googleapis.com/google.firebase.fcm.v1.FcmError" && d.Code == "UNREGISTERED" {
			invalid = true
		}
	}
	return response.StatusCode, invalid, nil
}
