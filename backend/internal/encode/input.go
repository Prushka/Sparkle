package encode

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

// FFmpeg only receives a private loopback URL. Every request reads the already
// root-confined file descriptor, never reopens a pathname or consults Plex.
func inputURL(ctx context.Context, file *os.File) (string, func(), error) {
	info, err := file.Stat()
	if err != nil {
		return "", nil, errEncode
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return "", nil, errEncode
	}
	token := make([]byte, 24)
	if _, err := rand.Read(token); err != nil {
		listener.Close()
		return "", nil, errEncode
	}
	path := "/" + hex.EncodeToString(token)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 15 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != path || (r.Method != "GET" && r.Method != "HEAD") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			http.ServeContent(w, r, "input", info.ModTime(), io.NewSectionReader(file, 0, info.Size()))
		})}
	go server.Serve(listener)
	stop := context.AfterFunc(ctx, func() { _ = server.Close() })
	return "http://" + listener.Addr().String() + path, func() { stop(); _ = server.Close() }, nil
}
