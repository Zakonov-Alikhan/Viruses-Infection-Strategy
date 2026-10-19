package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func main() {
	mux := http.NewServeMux()
	// каждый раз, когда идёт обращение начинается с "/ui", "ui" убирается, и по оставшемуся пути ищется соответствующий файл.
	mux.Handle("/ui/", http.StripPrefix("/ui/", http.FileServer(http.Dir("ui"))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "ui/index.html") // Относительный путь
	})
	mux.HandleFunc("/ui/style.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		http.ServeFile(w, r, "ui/style.css") // Относительный путь
	})
	mux.HandleFunc("/runtime-config.js", serveRuntimeConfig)

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "3000"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		log.Fatalf("Invalid PORT %q: expected a number from 1 to 65535", port)
	}
	address := net.JoinHostPort("0.0.0.0", port)
	log.Printf("Web server listening on %s", address)
	if err := http.ListenAndServe(address, mux); err != nil {
		log.Fatal(err)
	}
}

func serveRuntimeConfig(w http.ResponseWriter, r *http.Request) {
	webSocketURL := strings.TrimSpace(os.Getenv("VIRUSES_MULTIPLAYER_URL"))
	if webSocketURL != "" {
		parsed, err := url.Parse(webSocketURL)
		if err != nil || (parsed.Scheme != "ws" && parsed.Scheme != "wss") || parsed.Host == "" ||
			parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			http.Error(w, "VIRUSES_MULTIPLAYER_URL must be a ws:// or wss:// URL", http.StatusInternalServerError)
			return
		}
	}
	encodedURL, err := json.Marshal(webSocketURL)
	if err != nil {
		http.Error(w, "Could not create runtime configuration", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("window.VIRUSES_MULTIPLAYER_URL = " + string(encodedURL) + ";\n"))
}
