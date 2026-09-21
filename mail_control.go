package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"familychat/internal/chat"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

type mailPolicy struct {
	Enabled            bool `json:"enabled"`
	VerifyRegistration bool `json:"verifyRegistration"`
}

func mailControl(ctx context.Context, path string, input any) (json.RawMessage, error) {
	socket := os.Getenv("MAIL_CONTROL_SOCKET")
	if socket == "" {
		return nil, errors.New("Почтовый сервис ещё не установлен / Mail service is not installed")
	}
	method := http.MethodGet
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
		method = http.MethodPost
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 18 * time.Second}
	req, err := http.NewRequestWithContext(ctx, method, "http://mail"+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("Почтовый сервис недоступен / Mail service unavailable")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65536))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != 200 {
		return nil, errors.New("Проверьте SMTP; сначала сохраните отключённые настройки и отправьте тест / Check SMTP; save disabled settings and send a test first")
	}
	return data, nil
}
func (a *app) mailPolicy(ctx context.Context) (mailPolicy, error) {
	if os.Getenv("MAIL_CONTROL_SOCKET") == "" {
		return mailPolicy{}, nil
	}
	data, err := mailControl(ctx, "/settings", nil)
	if err != nil {
		return mailPolicy{}, err
	}
	var out mailPolicy
	err = json.Unmarshal(data, &out)
	return out, err
}
func (a *app) sendMail(ctx context.Context, to, subject, body string) error {
	_, err := mailControl(ctx, "/send", map[string]string{"to": to, "subject": subject, "body": body})
	return err
}
func (a *app) mailSettings(w http.ResponseWriter, r *http.Request) {
	if !a.user(id(r)).Permissions[chat.ManageApplication] {
		domainError(w, chat.ErrForbidden)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	path := "/settings"
	var in any
	if r.Method == http.MethodPost {
		path = "/test"
		in = map[string]string{"to": a.user(id(r)).Email}
	} else if r.Method == http.MethodPut {
		var value map[string]any
		if !decode(w, r, &value) {
			return
		}
		if value["enabled"] == true {
			if _, err := a.emailLink("register", "check"); err != nil {
				write(w, 400, map[string]string{"error": "Настройте APP_PUBLIC_URL с HTTPS / Configure APP_PUBLIC_URL with HTTPS"})
				return
			}
		}
		in = value
	}
	out, err := mailControl(r.Context(), path, in)
	if err != nil {
		write(w, 503, map[string]string{"error": err.Error()})
		return
	}
	write(w, 200, out)
}
