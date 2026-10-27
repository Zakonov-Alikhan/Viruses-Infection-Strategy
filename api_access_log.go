package main

import (
	"log"
	"net/http"
	"strings"
	"time"
)

type apiAccessResponseWriter struct {
	http.ResponseWriter
	status int
}

func (writer *apiAccessResponseWriter) WriteHeader(status int) {
	if writer.status != 0 {
		return
	}
	writer.status = status
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *apiAccessResponseWriter) Write(body []byte) (int, error) {
	if writer.status == 0 {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.ResponseWriter.Write(body)
}

func (writer *apiAccessResponseWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}

func logAPIRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !strings.HasPrefix(request.URL.Path, "/api/") {
			next.ServeHTTP(response, request)
			return
		}

		startedAt := time.Now()
		method := safeAccessField(request.Method)
		path := safeAccessField(request.URL.Path)
		host := safeAccessField(request.Host)
		origin := safeAccessField(request.Header.Get("Origin"))
		log.Printf("[CW API access] received time=%s method=%q path=%q host=%q origin=%q", startedAt.Format(time.RFC3339Nano), method, path, host, origin)

		tracked := &apiAccessResponseWriter{ResponseWriter: response}
		next.ServeHTTP(tracked, request)
		status := tracked.status
		if status == 0 {
			status = http.StatusOK
		}
		log.Printf("[CW API access] completed time=%s method=%q path=%q host=%q origin=%q status=%d duration_ms=%d", startedAt.Format(time.RFC3339Nano), method, path, host, origin, status, time.Since(startedAt).Milliseconds())
	})
}

func safeAccessField(value string) string {
	value = strings.Map(func(char rune) rune {
		if char < 0x20 || char == 0x7f {
			return -1
		}
		return char
	}, value)
	if len(value) > 240 {
		value = value[:240]
	}
	return value
}
