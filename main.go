package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()
	// каждый раз когда идёт обращение нач-ся на "ui" ui убирается по оставшемуся пути ищется соответствующий файл.
	mux.Handle("/ui/", http.StripPrefix("/ui/", http.FileServer(http.Dir("ui"))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "/ui/index.html")
	})
	mux.HandleFunc("/ui/style.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		http.ServeFile(w, r, "/ui/style.css")
	})
	port := ":3000"
	fmt.Printf("Сервер запущен на порту %s\n", port)
	log.Println("Server is listening...http://127.0.0.1:3000")
	http.ListenAndServe(port, nil)
}
