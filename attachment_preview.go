package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	_ "image/jpeg"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Bound concurrent decoders across all users on the small application server.
var previewSlot = make(chan struct{}, 1)

func previewKind(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0])) {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp":
		return "image"
	case "video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo", "video/mpeg", "video/ogg":
		return "video"
	case "application/pdf":
		return "pdf"
	}
	return ""
}

func (a *app) attachmentPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if a.db == nil {
		http.Error(w, "Unavailable", 503)
		return
	}
	// Never serve the cache before verifying current conversation membership.
	key, attachment, err := a.db.AttachmentObject(id(r), r.PathValue("id"))
	if err != nil {
		domainError(w, err)
		return
	}
	kind := previewKind(attachment.ContentType)
	settings, err := a.db.StorageSettings(r.Context())
	if err != nil {
		http.Error(w, "Unavailable", 503)
		return
	}
	if kind == "image" && !settings.Images || kind == "video" && !settings.Videos || kind == "pdf" && !settings.PDFs {
		http.NotFound(w, r)
		return
	}
	if kind == "" {
		http.NotFound(w, r)
		return
	}
	source := filepath.Join(a.cfg.UploadDirectory, filepath.Base(key))
	info, err := os.Stat(source)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	cacheDir := filepath.Join(a.cfg.UploadDirectory, ".previews-v1")
	if err = os.MkdirAll(cacheDir, 0700); err != nil {
		http.Error(w, "Unavailable", 503)
		return
	}
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d", key, info.Size(), info.ModTime().UnixNano())))
	target := filepath.Join(cacheDir, fmt.Sprintf("%x.jpg", hash))
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	err = ensurePreview(ctx, source, target, kind)
	if err != nil {
		http.Error(w, "Preview unavailable", http.StatusUnprocessableEntity)
		return
	}
	file, err := os.Open(target)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "preview.jpg", time.Time{}, file)
}

func ensurePreview(ctx context.Context, source, target, kind string) error {
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	select {
	case previewSlot <- struct{}{}:
		defer func() { <-previewSlot }()
	case <-ctx.Done():
		return ctx.Err()
	}
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	// Avoid repeatedly decoding a damaged or unsupported attachment.
	if info, err := os.Stat(target + ".failed"); err == nil && time.Since(info.ModTime()) < 5*time.Minute {
		return fmt.Errorf("preview temporarily unavailable")
	}
	dir, err := os.MkdirTemp(filepath.Dir(target), "render-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	output := filepath.Join(dir, "page.jpg")
	err = renderPreview(ctx, source, output, kind)
	if err == nil {
		err = validatePreview(output)
	}
	if err != nil {
		if ctx.Err() == nil {
			_ = os.WriteFile(target+".failed", nil, 0600)
		}
		return err
	}
	if err = os.Rename(output, target); err != nil {
		return err
	}
	_ = os.Remove(target + ".failed")
	return nil
}

func previewCommand(ctx context.Context, program string, args ...string) *exec.Cmd {
	if runtime.GOOS == "linux" {
		// A decoder must not exhaust memory/disk or run indefinitely. Fail closed
		// if prlimit is unavailable. No shell and no user-controlled arguments.
		args = append([]string{"--as=402653184", "--cpu=8", "--fsize=2097152", "--nofile=64", "--", program}, args...)
		program = "prlimit"
	}
	cmd := exec.CommandContext(ctx, program, args...)
	cmd.Env = append(os.Environ(), "OMP_NUM_THREADS=1", "OPENBLAS_NUM_THREADS=1")
	return cmd
}

func renderPreview(ctx context.Context, source, output, kind string) error {
	if kind == "pdf" {
		f, err := os.Open(source)
		if err != nil {
			return err
		}
		defer f.Close()
		header := make([]byte, 5)
		if _, err = f.Read(header); err != nil || string(header) != "%PDF-" {
			return fmt.Errorf("not a PDF")
		}
		return previewCommand(ctx, "pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "480", "-jpeg", source, strings.TrimSuffix(output, ".jpg")).Run()
	}
	if kind != "image" && kind != "video" {
		return fmt.Errorf("unsupported preview")
	}
	inputArgs := []string{}
	if kind == "image" {
		file, err := os.Open(source)
		if err != nil {
			return err
		}
		header := make([]byte, 512)
		n, _ := file.Read(header)
		file.Close()
		format := map[string]string{"image/jpeg": "jpeg_pipe", "image/png": "png_pipe", "image/gif": "gif", "image/webp": "webp_pipe", "image/bmp": "bmp_pipe"}[http.DetectContentType(header[:n])]
		if format == "" {
			return fmt.Errorf("unsupported image signature")
		}
		inputArgs = append(inputArgs, "-f", format)
	}
	// Exclude playlists, network protocols and external resource formats.
	args := []string{"-nostdin", "-v", "error", "-y", "-threads", "1", "-max_alloc", "67108864",
		"-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,avi,mpeg,mpegts,ogg,jpeg_pipe,png_pipe,webp_pipe,gif,bmp_pipe"}
	args = append(args, inputArgs...)
	args = append(args,
		"-i", source, "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn", "-filter_threads", "1",
		"-vf", "scale=480:480:force_original_aspect_ratio=decrease", "-threads", "1", "-q:v", "4", output)
	return previewCommand(ctx, "ffmpeg", args...).Run()
}

func validatePreview(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if info.Size() > 2<<20 {
		return fmt.Errorf("preview too large")
	}
	config, format, err := image.DecodeConfig(f)
	if err != nil {
		return err
	}
	if format != "jpeg" || config.Width < 1 || config.Height < 1 || config.Width > 480 || config.Height > 480 {
		return fmt.Errorf("invalid preview")
	}
	return nil
}
