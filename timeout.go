package main

import (
	"context"
	"net/http"
	"strings"
	"time"
)

func requestDeadline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/events" {
			next.ServeHTTP(w, r)
			return
		}
		duration := 20 * time.Second
		if strings.HasPrefix(r.URL.Path, "/api/v1/mobile/shares/") {
			duration = 10 * time.Minute
		}
		ctx, cancel := context.WithTimeout(r.Context(), duration)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
