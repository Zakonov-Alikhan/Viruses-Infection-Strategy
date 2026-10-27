package main

import (
	"errors"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

const defaultAPIUnavailableBody = `{"error":"accounts-unavailable"}`

func parseAPIOrigin(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("VIRUSES_API_URL is required")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Host == "" || target.User != nil || target.Opaque != "" ||
		(target.Scheme != "http" && target.Scheme != "https") ||
		(target.Path != "" && target.Path != "/") || target.RawPath != "" ||
		target.RawQuery != "" || target.Fragment != "" {
		return nil, errors.New("VIRUSES_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment")
	}
	target.Path = ""
	return target, nil
}

func newAPIProxy(target *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		origin := request.Header.Get("Origin")
		if origin == "" && (request.Method == http.MethodGet || request.Method == http.MethodHead) {
			origin = sameOriginForRead(request)
		}
		director(request)
		// ReverseProxy in the project's Go 1.19 runtime uses Director. Pin the
		// upstream Host and preserve the browser Origin for Node's existing checks.
		request.Host = target.Host
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		log.Printf("[CW API proxy] forwarding method=%q path=%q", safeAccessField(request.Method), safeAccessField(request.URL.Path))
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		method := ""
		path := ""
		if response.Request != nil {
			method = safeAccessField(response.Request.Method)
			path = safeAccessField(response.Request.URL.Path)
		}
		log.Printf("[CW API proxy] upstream-response method=%q path=%q status=%d", method, path, response.StatusCode)
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, request *http.Request, _ error) {
		log.Printf("[CW API proxy] upstream-unavailable method=%q path=%q", safeAccessField(request.Method), safeAccessField(request.URL.Path))
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(defaultAPIUnavailableBody))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

func sameOriginForRead(request *http.Request) string {
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	} else if forwarded := strings.TrimSpace(strings.Split(request.Header.Get("X-Forwarded-Proto"), ",")[0]); forwarded == "http" || forwarded == "https" {
		scheme = forwarded
	}
	host := strings.TrimSpace(request.Host)
	if host == "" {
		return ""
	}
	parsed, err := url.Parse(scheme + "://" + host)
	if err != nil || parsed.Host != host || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func newAPIProxyFromEnv() (http.Handler, error) {
	target, err := parseAPIOrigin(os.Getenv("VIRUSES_API_URL"))
	if err != nil {
		return nil, err
	}
	return newAPIProxy(target), nil
}
