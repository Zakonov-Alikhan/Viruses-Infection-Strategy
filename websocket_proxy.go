package main

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Browsers send the site's HttpOnly account cookie on this same-origin
// connection. The fixed upstream still performs its own Origin/session checks.
func newWebSocketProxy(raw string) (http.Handler, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.Host == "" || target.User != nil || target.Opaque != "" ||
		(target.Scheme != "ws" && target.Scheme != "wss") || target.RawQuery != "" ||
		target.Fragment != "" || target.RawPath != "" {
		return nil, errors.New("VIRUSES_MULTIPLAYER_URL must be a ws(s) URL without credentials, query, or fragment")
	}
	if target.Scheme == "wss" {
		target.Scheme = "https"
	} else {
		target.Scheme = "http"
	}
	path := target.Path
	if path == "" {
		path = "/ws"
	}
	target.Path = ""
	proxy := newUpstreamProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.URL.Path = path
		r.URL.RawPath = ""
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ws" || r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			w.Header().Set("Upgrade", "websocket")
			http.Error(w, "WebSocket upgrade required", http.StatusUpgradeRequired)
			return
		}
		proxy.ServeHTTP(w, r)
	}), nil
}

func newWebSocketProxyFromEnv() (http.Handler, error) {
	raw := strings.TrimSpace(os.Getenv("VIRUSES_MULTIPLAYER_URL"))
	if raw == "" {
		// The existing Node service serves both HTTP API and /ws. An explicitly
		// configured WebSocket upstream always takes precedence.
		target, err := parseAPIOrigin(os.Getenv("VIRUSES_API_URL"))
		if err != nil {
			return nil, err
		}
		if target.Scheme == "https" {
			target.Scheme = "wss"
		} else {
			target.Scheme = "ws"
		}
		target.Path = "/ws"
		raw = target.String()
	}
	return newWebSocketProxy(raw)
}
