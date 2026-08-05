package main

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type rateWindow struct {
	started time.Time
	count   int
}
type rateLimiter struct {
	mu      sync.Mutex
	windows map[string]rateWindow
	limit   int
	window  time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{windows: make(map[string]rateWindow), limit: limit, window: window}
}
func (l *rateLimiter) allow(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.windows[host]
	if w.started.IsZero() || now.Sub(w.started) >= l.window {
		l.windows[host] = rateWindow{started: now, count: 1}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	l.windows[host] = w
	return true
}
func (a *app) limited(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.limiter.allow(r) {
			write(w, http.StatusTooManyRequests, map[string]string{"error": "Слишком много запросов. Повторите позже."})
			return
		}
		next(w, r)
	}
}
