package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

var previewSlots = make(chan struct{}, 4)
var previewLimiter = newRateLimiter(30, time.Minute)
var errPreview = errors.New("preview unavailable")

type linkMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Host        string `json:"host"`
}

func publicPreviewIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// Non-public, documentation, translation and transition ranges must not be
	// used to reach host/cloud metadata services through a public-looking URL.
	for _, s := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "3fff::/20", "2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(s).Contains(ip) {
			return false
		}
	}
	return true
}
func previewURL(raw string) (*url.URL, error) {
	if len(raw) > 2048 {
		return nil, errPreview
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errPreview
	}
	if p := u.Port(); p != "" && !(u.Scheme == "https" && p == "443") && !(u.Scheme == "http" && p == "80") {
		return nil, errPreview
	}
	u.Fragment = ""
	return u, nil
}
func previewDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errPreview
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, errPreview
	}
	for _, ip := range ips {
		if !publicPreviewIP(ip) {
			return nil, errPreview
		}
	}
	// Dial the validated address, never perform a second DNS lookup (rebinding).
	return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
}
func parseLinkMetadata(r io.Reader) linkMetadata {
	z := html.NewTokenizer(io.LimitReader(r, 256<<10))
	out := linkMetadata{}
	inTitle := false
	for {
		switch z.Next() {
		case html.ErrorToken:
			return out
		case html.StartTagToken, html.SelfClosingTagToken:
			t := z.Token()
			if t.Data == "title" {
				inTitle = true
			}
			if t.Data == "body" {
				return out
			}
			if t.Data == "meta" {
				var name, content string
				for _, a := range t.Attr {
					if a.Key == "name" || a.Key == "property" {
						name = strings.ToLower(a.Val)
					}
					if a.Key == "content" {
						content = compactPreview(a.Val, 240)
					}
				}
				switch name {
				case "og:title":
					out.Title = content
				case "description", "og:description":
					out.Description = content
				}
			}
		case html.EndTagToken:
			if z.Token().Data == "title" {
				inTitle = false
			}
		case html.TextToken:
			if inTitle && out.Title == "" {
				out.Title = compactPreview(string(z.Text()), 120)
			}
		}
	}
}
func compactPreview(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}
func fetchLinkMetadata(ctx context.Context, raw string) (linkMetadata, error) {
	u, err := previewURL(raw)
	if err != nil {
		return linkMetadata{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	transport := &http.Transport{DialContext: previewDial, TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: 3 * time.Second, MaxResponseHeaderBytes: 32 << 10, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) > 3 {
			return errPreview
		}
		if _, err := previewURL(r.URL.String()); err != nil {
			return err
		}
		if via[0].URL.Scheme == "https" && r.URL.Scheme != "https" {
			return errPreview
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return linkMetadata{}, errPreview
	}
	req.Header.Set("User-Agent", "ChatFamily-LinkPreview/1.0")
	req.Header.Set("Accept", "text/html")
	response, err := client.Do(req)
	if err != nil {
		return linkMetadata{}, errPreview
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
		return linkMetadata{}, errPreview
	}
	reader, err := charset.NewReader(io.LimitReader(response.Body, 256<<10), response.Header.Get("Content-Type"))
	if err != nil {
		return linkMetadata{}, errPreview
	}
	metadata := parseLinkMetadata(reader)
	metadata.Host = u.Hostname()
	return metadata, nil
}
func (a *app) linkPreview(w http.ResponseWriter, r *http.Request) {
	if !previewLimiter.allow(r) {
		write(w, 429, map[string]string{"error": "Предпросмотр временно ограничен"})
		return
	}
	var in struct {
		URL string `json:"url"`
	}
	if !decode(w, r, &in) {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	select {
	case previewSlots <- struct{}{}:
		defer func() { <-previewSlots }()
	default:
		write(w, 429, map[string]string{"error": "Предпросмотр занят"})
		return
	}
	out, err := fetchLinkMetadata(r.Context(), in.URL)
	if err != nil {
		write(w, 422, map[string]string{"error": "Предпросмотр недоступен"})
		return
	}
	write(w, 200, out)
}
