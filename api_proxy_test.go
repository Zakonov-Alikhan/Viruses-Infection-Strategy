package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestNewAPIProxyFromEnvRequiresConfiguredOrigin(t *testing.T) {
	oldValue, hadValue := os.LookupEnv("VIRUSES_API_URL")
	t.Cleanup(func() {
		if hadValue {
			_ = os.Setenv("VIRUSES_API_URL", oldValue)
		} else {
			_ = os.Unsetenv("VIRUSES_API_URL")
		}
	})
	_ = os.Unsetenv("VIRUSES_API_URL")
	if _, err := newAPIProxyFromEnv(); err == nil {
		t.Fatal("expected missing VIRUSES_API_URL to fail")
	}
	_ = os.Setenv("VIRUSES_API_URL", "http://127.0.0.1:3001")
	if _, err := newAPIProxyFromEnv(); err != nil {
		t.Fatalf("configured local API origin rejected: %v", err)
	}
}

func TestParseAPIOriginRequiresHTTPOrigin(t *testing.T) {
	for _, raw := range []string{
		"", "ftp://api.example.test", "https://user:pass@api.example.test",
		"https://api.example.test/api", "https://api.example.test/?token=x",
		"https://api.example.test/#fragment", "//api.example.test",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := parseAPIOrigin(raw); err == nil {
				t.Fatalf("parseAPIOrigin(%q) unexpectedly succeeded", raw)
			}
		})
	}
	for _, raw := range []string{"http://127.0.0.1:3001", "https://node.example.test/"} {
		if _, err := parseAPIOrigin(raw); err != nil {
			t.Errorf("parseAPIOrigin(%q): %v", raw, err)
		}
	}
}

func TestAPIProxyForwardsAccountRequestsAndResponses(t *testing.T) {
	type capturedRequest struct {
		method, path, query, host, body           string
		origin, contentType, requestCheck, cookie string
	}
	requests := make(chan capturedRequest, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- capturedRequest{
			method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, host: r.Host, body: string(body),
			origin: r.Header.Get("Origin"), contentType: r.Header.Get("Content-Type"),
			requestCheck: r.Header.Get("X-CW-Request"), cookie: r.Header.Get("Cookie"),
		}
		if strings.HasSuffix(r.URL.Path, "/register") {
			w.Header().Add("Set-Cookie", "cw_session=test-session; Path=/; HttpOnly; SameSite=Lax")
			w.WriteHeader(http.StatusCreated)
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := newAPIProxy(target)

	for _, route := range []struct {
		path, method string
		status       int
	}{
		{path: "/api/auth/register?flow=signup", method: http.MethodPost, status: http.StatusCreated},
		{path: "/api/auth/login?flow=signin", method: http.MethodPost, status: http.StatusOK},
	} {
		body := `{"username":"test-user","password":"redacted-in-test"}`
		req := httptest.NewRequest(route.method, route.path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://game.example.test")
		req.Header.Set("X-CW-Request", "1")
		req.Header.Set("Cookie", "existing_session=browser-cookie")
		// A user-controlled Host and query parameter must never select the upstream.
		req.Host = "attacker.example.test"
		response := httptest.NewRecorder()
		proxy.ServeHTTP(response, req)

		if response.Code != route.status {
			t.Fatalf("%s %s: got status %d, want %d", route.method, route.path, response.Code, route.status)
		}
		if got := response.Body.String(); got != `{"ok":true}` {
			t.Fatalf("unexpected upstream body: %q", got)
		}
		got := <-requests
		if got.method != route.method || got.path != strings.Split(route.path, "?")[0] || got.query != strings.SplitN(route.path, "?", 2)[1] {
			t.Errorf("request route not preserved: %+v", got)
		}
		if got.host != target.Host {
			t.Errorf("upstream host = %q, want fixed target %q", got.host, target.Host)
		}
		if got.body != body || got.origin != "https://game.example.test" || got.contentType != "application/json" || got.requestCheck != "1" || got.cookie != "existing_session=browser-cookie" {
			t.Errorf("request content or required headers not preserved: %+v", got)
		}
		if route.status == http.StatusCreated {
			if cookies := response.Result().Header.Values("Set-Cookie"); len(cookies) != 1 || !strings.Contains(cookies[0], "HttpOnly") {
				t.Errorf("Set-Cookie response header not preserved: %v", cookies)
			}
		}
	}
}

func TestAPIProxyPreservesUpstreamHTTPError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"error":"username-taken"}`)
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	response := httptest.NewRecorder()
	newAPIProxy(target).ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{}`)))
	if response.Code != http.StatusConflict || response.Body.String() != `{"error":"username-taken"}` {
		t.Fatalf("upstream error response was not preserved: status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestAPIProxyReturnsSafe502WhenUpstreamUnavailable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	target, _ := url.Parse("http://" + address)
	response := httptest.NewRecorder()
	newAPIProxy(target).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.Code)
	}
	if response.Body.String() != defaultAPIUnavailableBody || strings.Contains(response.Body.String(), address) {
		t.Fatalf("proxy error leaked upstream details: %q", response.Body.String())
	}
}

func TestAPIProxyDoesNotUseUserSuppliedUpstream(t *testing.T) {
	var hits int
	configuredHost := ""
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/me" && r.URL.Query().Get("url") == "http://attacker.invalid" && r.Host == configuredHost {
			hits++
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	configuredHost = target.Host
	response := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/me?url=http%3A%2F%2Fattacker.invalid", nil)
	req.Host = "attacker.invalid"
	newAPIProxy(target).ServeHTTP(response, req)
	if response.Code != http.StatusNoContent || hits != 1 {
		t.Fatalf("fixed upstream was not used: status=%d hits=%d", response.Code, hits)
	}
}

func TestAPIProxyDerivesOriginOnlyForOriginlessReadRequests(t *testing.T) {
	origins := make(chan string, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origins <- r.Header.Get("Origin")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	proxy := newAPIProxy(target)

	get := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	get.Host = "game.local:3000"
	proxy.ServeHTTP(httptest.NewRecorder(), get)
	if got := <-origins; got != "http://game.local:3000" {
		t.Fatalf("read request Origin = %q, want same-origin value", got)
	}

	post := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{}`))
	post.Host = "game.local:3000"
	proxy.ServeHTTP(httptest.NewRecorder(), post)
	if got := <-origins; got != "" {
		t.Fatalf("originless mutating request was assigned Origin %q", got)
	}
}
