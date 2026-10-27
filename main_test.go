package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

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
