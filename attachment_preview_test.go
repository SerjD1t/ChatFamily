package main

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPreviewTypes(t *testing.T) {
	for mime, want := range map[string]string{"image/jpeg": "image", "video/mp4": "video", "application/pdf": "pdf", "IMAGE/PNG; charset=x": "image", "image/svg+xml": "", "text/html": "", "application/zip": ""} {
		if got := previewKind(mime); got != want {
			t.Errorf("%s: %q", mime, got)
		}
	}
}
func TestPreviewValidationAndCache(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "preview.jpg")
	f, _ := os.Create(path)
	_ = jpeg.Encode(f, image.NewRGBA(image.Rect(0, 0, 240, 160)), nil)
	f.Close()
	if err := validatePreview(path); err != nil {
		t.Fatal(err)
	}
	if err := ensurePreview(context.Background(), "nonexistent", path, "image"); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(path, []byte("not jpeg"), 0600)
	if validatePreview(path) == nil {
		t.Fatal("accepted invalid output")
	}
	missing := filepath.Join(dir, "missing.jpg")
	_ = os.WriteFile(missing+".failed", nil, 0600)
	if ensurePreview(context.Background(), "missing", missing, "video") == nil {
		t.Fatal("negative cache ignored")
	}
	previewSlot <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := ensurePreview(ctx, "missing", filepath.Join(dir, "cancel.jpg"), "video")
	<-previewSlot
	if err == nil {
		t.Fatal("queue ignored cancellation")
	}
}
func TestPreviewConverters(t *testing.T) {
	if os.Getenv("TEST_PREVIEW_TOOLS") != "1" {
		t.Skip("set TEST_PREVIEW_TOOLS=1 with ffmpeg and pdftoppm on PATH")
	}
	for _, tool := range []string{"ffmpeg", "pdftoppm"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Fatal(err)
		}
	}
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	img := image.NewRGBA(image.Rect(0, 0, 800, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 800; x++ {
			img.Set(x, y, color.RGBA{100, 150, 200, 255})
		}
	}
	source := filepath.Join(dir, "photo.jpg")
	f, _ := os.Create(source)
	_ = jpeg.Encode(f, img, nil)
	f.Close()
	output := filepath.Join(dir, "image-preview.jpg")
	if err := ensurePreview(ctx, source, output, "image"); err != nil {
		t.Fatal("image:", err)
	}
	video := filepath.Join(dir, "video.mp4")
	if err := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", source, "-t", "0.2", "-pix_fmt", "yuv420p", video).Run(); err != nil {
		t.Fatal("fixture:", err)
	}
	if err := ensurePreview(ctx, video, filepath.Join(dir, "video-preview.jpg"), "video"); err != nil {
		t.Fatal("video:", err)
	}
	// Synthetic PDF only, no real attachments or personal data in tests.
	var pdf strings.Builder
	pdf.WriteString("%PDF-1.4\n")
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>", "<< /Length 25 >>\nstream\n0 0 1 rg 0 0 100 100 re f\nendstream"}
	offsets := []int{0}
	for i, obj := range objects {
		offsets = append(offsets, pdf.Len())
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xref := pdf.Len()
	pdf.WriteString("xref\n0 5\n0000000000 65535 f \n")
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xref)
	sourcePDF := filepath.Join(dir, "file.pdf")
	_ = os.WriteFile(sourcePDF, []byte(pdf.String()), 0600)
	if err := ensurePreview(ctx, sourcePDF, filepath.Join(dir, "pdf-preview.jpg"), "pdf"); err != nil {
		t.Fatal("pdf:", err)
	}
	// Fake MIME/header must not render an arbitrary text file.
	if err := renderPreview(ctx, source, filepath.Join(dir, "fake.jpg"), "pdf"); err == nil {
		t.Fatal("fake PDF accepted")
	}
}
