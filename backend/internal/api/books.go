package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"novel-sync/internal/storage"

	"github.com/go-chi/chi/v5"
)

type bookStore interface {
	authenticator
	CreateBook(rctx context.Context, ownerID, clientBookID, title string) (storage.Book, error)
	ListBooks(rctx context.Context, ownerID string) ([]storage.Book, error)
	GetBook(rctx context.Context, ownerID, bookID string) (storage.Book, error)
	DeleteBook(rctx context.Context, ownerID, bookID string) error
	ListVersions(rctx context.Context, ownerID, bookID string) ([]storage.Version, error)
	OpenCurrentArchive(rctx context.Context, ownerID, bookID string) (storage.Book, *os.File, error)
	PutCurrentArchive(rctx context.Context, ownerID, bookID, ifMatch, deviceID string, stage storage.StagedArchive) (storage.Book, error)
	OpenVersionArchive(rctx context.Context, ownerID, bookID string, revision int64) (storage.Version, *os.File, error)
}

type bookHandlers struct {
	store           *storage.Store
	dataDir         string
	maxArchiveBytes int64
}

type createBookRequest struct {
	ClientBookID string `json:"clientBookId"`
	Title        string `json:"title"`
}

func (h *bookHandlers) create(w http.ResponseWriter, r *http.Request) {
	var request createBookRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Provide a valid clientBookId and title.")
		return
	}
	request.ClientBookID = strings.TrimSpace(request.ClientBookID)
	request.Title = strings.TrimSpace(request.Title)
	if request.ClientBookID == "" || len(request.ClientBookID) > 200 || request.Title == "" || len(request.Title) > 500 {
		writeError(w, http.StatusBadRequest, "invalid_request", "clientBookId and title are required and exceed no field limits.")
		return
	}
	book, err := h.store.CreateBook(r.Context(), currentUser(r).ID, request.ClientBookID, request.Title)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	w.Header().Set("Location", "/api/v1/books/"+book.ID)
	w.Header().Set("ETag", storage.QuoteETag(book.CurrentETag))
	writeJSON(w, http.StatusCreated, book)
}

func (h *bookHandlers) list(w http.ResponseWriter, r *http.Request) {
	books, err := h.store.ListBooks(r.Context(), currentUser(r).ID)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": books})
}

func (h *bookHandlers) get(w http.ResponseWriter, r *http.Request) {
	book, err := h.store.GetBook(r.Context(), currentUser(r).ID, chi.URLParam(r, "bookID"))
	if err != nil {
		writeStorageError(w, err)
		return
	}
	w.Header().Set("ETag", storage.QuoteETag(book.CurrentETag))
	writeJSON(w, http.StatusOK, book)
}

func (h *bookHandlers) remove(w http.ResponseWriter, r *http.Request) {
	if err := h.store.DeleteBook(r.Context(), currentUser(r).ID, chi.URLParam(r, "bookID")); err != nil {
		writeStorageError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *bookHandlers) versions(w http.ResponseWriter, r *http.Request) {
	versions, err := h.store.ListVersions(r.Context(), currentUser(r).ID, chi.URLParam(r, "bookID"))
	if err != nil {
		writeStorageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

func (h *bookHandlers) downloadCurrent(w http.ResponseWriter, r *http.Request) {
	book, file, err := h.store.OpenCurrentArchive(r.Context(), currentUser(r).ID, chi.URLParam(r, "bookID"))
	if err != nil {
		writeStorageError(w, err)
		return
	}
	defer file.Close()
	h.serveArchive(w, r, file, book.CurrentSize, book.CurrentETag, fmt.Sprintf("book-%s-r%d.arcbook", book.ID, book.CurrentRevision))
}

func (h *bookHandlers) uploadCurrent(w http.ResponseWriter, r *http.Request) {
	if contentType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); contentType != "application/vnd.arc-book" && contentType != "application/octet-stream" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Use application/vnd.arc-book for archive uploads.")
		return
	}
	stage, err := storage.StageArchive(h.dataDir, r.Body, h.maxArchiveBytes)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	book, err := h.store.PutCurrentArchive(r.Context(), currentUser(r).ID, chi.URLParam(r, "bookID"), r.Header.Get("If-Match"), r.Header.Get("X-Device-ID"), stage)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	w.Header().Set("ETag", storage.QuoteETag(book.CurrentETag))
	writeJSON(w, http.StatusOK, book)
}

func (h *bookHandlers) downloadVersion(w http.ResponseWriter, r *http.Request) {
	revision, err := strconv.ParseInt(chi.URLParam(r, "revision"), 10, 64)
	if err != nil || revision < 1 {
		writeError(w, http.StatusBadRequest, "invalid_revision", "Revision must be a positive integer.")
		return
	}
	version, file, err := h.store.OpenVersionArchive(r.Context(), currentUser(r).ID, chi.URLParam(r, "bookID"), revision)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	defer file.Close()
	h.serveArchive(w, r, file, version.Size, version.ETag, fmt.Sprintf("book-%s-r%d.arcbook", version.BookID, version.Revision))
}

func (h *bookHandlers) serveArchive(w http.ResponseWriter, r *http.Request, file *os.File, size int64, etag, filename string) {
	info, err := file.Stat()
	if err != nil || info.Size() != size {
		writeStorageError(w, errors.New("stored archive size does not match its metadata"))
		return
	}
	w.Header().Set("Content-Type", "application/vnd.arc-book")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("ETag", storage.QuoteETag(etag))
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	http.ServeContent(w, r, filename, time.Time{}, file)
}
