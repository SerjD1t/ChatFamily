package main

import (
	"context"
	"net/netip"
	"strings"
	"testing"
)

func TestPreviewRejectsPrivateAndTransitionAddresses(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.2", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.100.100.200", "192.0.2.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "fec0::1"} {
		if publicPreviewIP(netip.MustParseAddr(address)) {
			t.Errorf("allowed restricted address %s", address)
		}
	}
	for _, address := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !publicPreviewIP(netip.MustParseAddr(address)) {
			t.Errorf("blocked public %s", address)
		}
	}
	for _, raw := range []string{"file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.test/", "http://example.test:22/", "ftp://example.test/"} {
		if _, err := previewURL(raw); err == nil {
			t.Errorf("allowed %s", raw)
		}
	}
	if _, err := fetchLinkMetadata(context.Background(), "http://127.0.0.1/"); err == nil {
		t.Fatal("loopback fetch allowed")
	}
}
func TestMetadataUsesOnlyBoundedText(t *testing.T) {
	result := parseLinkMetadata(strings.NewReader(`<head><title>Page &amp; example</title><meta property="og:title" content="Better &lt;title&gt;"><meta name="description" content="Short description"><script>ignored()</script></head><body>Private body</body>`))
	if result.Title != "Better <title>" || result.Description != "Short description" {
		t.Fatalf("unexpected metadata: %#v", result)
	}
	if len([]rune(compactPreview(strings.Repeat("a", 1000), 120))) != 121 {
		t.Fatal("missing size limit")
	}
}
