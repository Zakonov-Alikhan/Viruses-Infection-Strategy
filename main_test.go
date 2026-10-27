package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGamesRouteServesApplicationAndFaviconIsAnSVG(t *testing.T) {
	handler := newHTTPHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/games", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), `href="/games"`) {
		t.Fatalf("/games did not serve the game application: status=%d body=%q", page.Code, page.Body.String())
	}

	icon := httptest.NewRecorder()
	handler.ServeHTTP(icon, httptest.NewRequest(http.MethodGet, "/ui/favicon.svg?v=cascade-brand1", nil))
	body, err := io.ReadAll(icon.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	if icon.Code != http.StatusOK || !strings.HasPrefix(icon.Header().Get("Content-Type"), "image/svg+xml") || !strings.Contains(string(body), "<svg") {
		t.Fatalf("favicon is not served as an SVG image: status=%d type=%q body=%q", icon.Code, icon.Header().Get("Content-Type"), body)
	}
}

func TestRuntimeConfigIncludesOnlyValidPublicSupportCardNumber(t *testing.T) {
	t.Setenv("VIRUSES_MULTIPLAYER_URL", "")
	t.Setenv("SUPPORT_CARD_NUMBER", "1234567890123456")
	response := httptest.NewRecorder()
	serveRuntimeConfig(response, httptest.NewRequest("GET", "/runtime-config.js", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `window.VIRUSES_SUPPORT_CARD_NUMBER = "1234567890123456";`) {
		t.Fatalf("valid public card number was not exposed in runtime config: %d %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `window.VIRUSES_MULTIPLAYER_URL = "";`) {
		t.Fatalf("WebSocket runtime config was not preserved: %s", response.Body.String())
	}
}

func TestRuntimeConfigOmitsInvalidSupportCardNumber(t *testing.T) {
	t.Setenv("VIRUSES_MULTIPLAYER_URL", "")
	t.Setenv("SUPPORT_CARD_NUMBER", "not-a-real-number")
	response := httptest.NewRecorder()
	serveRuntimeConfig(response, httptest.NewRequest("GET", "/runtime-config.js", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `window.VIRUSES_SUPPORT_CARD_NUMBER = "";`) {
		t.Fatalf("invalid card number was not omitted: %d %s", response.Code, response.Body.String())
	}
}
