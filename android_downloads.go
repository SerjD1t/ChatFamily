package main

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

var androidArtifactName = regexp.MustCompile(`^chatfamily-[0-9]+\.apk$`)

// Release files are public artifacts, never user uploads or local settings.
func androidDownloads(directory string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("file")
		if name != "latest.json" && !androidArtifactName.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(directory, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if name == "latest.json" {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
		} else {
			// A mobile APK download can legitimately exceed the server's 30s default.
			// Keep a finite bound consistent with the native download deadline.
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Minute))
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
			w.Header().Set("Content-Type", "application/vnd.android.package-archive")
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		}
		http.ServeFile(w, r, path)
	}
}
