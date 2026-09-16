package main

import (
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	webpush "github.com/SherClockHolmes/webpush-go"
	"io"
	"net/http"
	"strings"
	"testing"
)

type pushTestTransport func(*http.Request) (*http.Response, error)

func (f pushTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPushSubscriberJWT(t *testing.T) {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	_, x, y, err := elliptic.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	subscription := webpush.Subscription{Endpoint: "https://push.example.test/one"}
	subscription.Keys.P256dh = base64.RawURLEncoding.EncodeToString(elliptic.Marshal(elliptic.P256(), x, y))
	subscription.Keys.Auth = base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	for _, subject := range []string{"sender@example.test", "mailto:sender@example.test", " MAILTO:sender@example.test ", "mailto:mailto:sender@example.test"} {
		t.Run(subject, func(t *testing.T) {
			a := &app{}
			a.cfg.VAPIDSubject = subject
			a.cfg.VAPIDPublicKey = public
			a.cfg.VAPIDPrivateKey = private
			options := a.pushOptions()
			called := false
			options.HTTPClient = &http.Client{Transport: pushTestTransport(func(r *http.Request) (*http.Response, error) {
				called = true
				auth := r.Header.Get("Authorization")
				token := strings.Split(strings.TrimPrefix(auth, "vapid t="), ",")[0]
				parts := strings.Split(token, ".")
				if len(parts) != 3 {
					t.Fatal("invalid JWT structure")
				}
				raw, err := base64.RawURLEncoding.DecodeString(parts[1])
				if err != nil {
					t.Fatal(err)
				}
				var claims map[string]any
				if err := json.Unmarshal(raw, &claims); err != nil {
					t.Fatal(err)
				}
				if claims["sub"] != "mailto:sender@example.test" {
					t.Fatalf("unexpected subject: %v", claims["sub"])
				}
				if claims["aud"] != "https://push.example.test" {
					t.Fatal("unexpected audience")
				}
				return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
			})}
			response, err := webpush.SendNotification([]byte("test"), &subscription, options)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if !called {
				t.Fatal("request not inspected")
			}
		})
	}
}
