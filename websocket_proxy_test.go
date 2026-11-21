package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestWebSocketProxyForwardsCookieOriginAndBidirectionalUpgrade(t *testing.T) {
	requests := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = rw.Flush()
		data := make([]byte, 4)
		if _, err := io.ReadFull(rw, data); err == nil {
			_, _ = conn.Write(data)
		}
	}))
	defer upstream.Close()
	proxy, err := newWebSocketProxy(strings.Replace(upstream.URL, "http:", "ws:", 1) + "/game-socket")
	if err != nil {
		t.Fatal(err)
	}
	site := httptest.NewServer(newHTTPHandler(http.NotFoundHandler(), proxy))
	defer site.Close()
	address, _ := url.Parse(site.URL)
	conn, err := net.Dial("tcp", address.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = fmt.Fprintf(conn, "GET /ws HTTP/1.1\r\nHost: %s\r\nOrigin: https://game.example\r\nCookie: cw_session=local-test-session\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", address.Host)
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 101 {
		t.Fatalf("upgrade: %d", response.StatusCode)
	}
	r := <-requests
	if r.URL.Path != "/game-socket" || r.Header.Get("Cookie") != "cw_session=local-test-session" || r.Header.Get("Origin") != "https://game.example" {
		t.Fatal("WebSocket path, account cookie, or browser Origin was lost")
	}
	_, _ = conn.Write([]byte("ping"))
	echo := make([]byte, 4)
	if _, err = io.ReadFull(reader, echo); err != nil || string(echo) != "ping" {
		t.Fatalf("duplex tunnel failed: %v", err)
	}
}

func TestWebSocketProxyRejectsInvalidTargetsAndClientUpstreamOverrides(t *testing.T) {
	for _, target := range []string{"", "https://node.test/ws", "ws://user:pass@node.test/ws", "wss://node.test/ws?token=x", "wss://node.test/ws#x"} {
		if _, err := newWebSocketProxy(target); err == nil {
			t.Fatalf("invalid target accepted: %q", target)
		}
	}
	proxy, err := newWebSocketProxy("ws://127.0.0.1:1/ws")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/ws?upstream=https://attacker.test", "/other"} {
		w := httptest.NewRecorder()
		proxy.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatalf("client override accepted: %d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, httptest.NewRequest("GET", "/ws", nil))
	if w.Code != 426 {
		t.Fatalf("expected upgrade requirement, got %d", w.Code)
	}
	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Connection", "Upgrade")
	w = httptest.NewRecorder()
	proxy.ServeHTTP(w, r)
	if w.Code != 502 {
		t.Fatalf("missing upstream did not return 502: %d", w.Code)
	}
}

func TestWebSocketUpstreamUsesExplicitAddressOrTheExistingNodeAPIService(t *testing.T) {
	t.Setenv("VIRUSES_MULTIPLAYER_URL", "")
	t.Setenv("VIRUSES_API_URL", "http://127.0.0.1:3001")
	if _, err := newWebSocketProxyFromEnv(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIRUSES_MULTIPLAYER_URL", "wss://socket.example/game")
	if _, err := newWebSocketProxyFromEnv(); err != nil {
		t.Fatal(err)
	}
}
