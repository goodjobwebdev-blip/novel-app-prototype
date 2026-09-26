package api

import (
	"net/http"

	"novel-sync/internal/config"
	"novel-sync/internal/storage"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func NewRouter(cfg config.Config, store *storage.Store) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(requestLog)
	router.Use(middleware.Recoverer)
	router.Use(securityHeaders)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "If-Match", "X-Device-ID", "X-Sync-Token"},
		ExposedHeaders:   []string{"ETag", "Location"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	router.Get("/api/v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	books := &bookHandlers{store: store, dataDir: cfg.DataDir, maxArchiveBytes: cfg.MaxArchiveBytes}
	router.Group(func(protected chi.Router) {
		protected.Use(authentication(store))
		protected.Get("/api/v1/me", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, currentUser(r))
		})
		protected.Get("/api/v1/books", books.list)
		protected.Post("/api/v1/books", books.create)
		protected.Get("/api/v1/books/{bookID}", books.get)
		protected.Delete("/api/v1/books/{bookID}", books.remove)
		protected.Get("/api/v1/books/{bookID}/versions", books.versions)
		protected.Get("/api/v1/books/{bookID}/versions/{revision}", books.downloadVersion)
		protected.Head("/api/v1/books/{bookID}/versions/{revision}", books.downloadVersion)
		protected.Get("/api/v1/books/{bookID}/state", books.downloadCurrent)
		protected.Head("/api/v1/books/{bookID}/state", books.downloadCurrent)
		protected.Put("/api/v1/books/{bookID}/state", books.uploadCurrent)
	})
	return router
}
