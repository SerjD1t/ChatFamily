package main

import "net/http"

// The packaged Capacitor UI uses this fixed HTTPS origin. Never allow arbitrary origins.
func mobileCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Add("Vary", "Origin")
	if r.Header.Get("Origin") != "https://chatfamily.site" {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", "https://chatfamily.site")
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Filename")
		w.Header().Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}
