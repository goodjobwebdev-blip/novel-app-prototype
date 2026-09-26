package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"novel-sync/internal/storage"
)

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var response errorResponse
	response.Error.Code = code
	response.Error.Message = message
	writeJSON(w, status, response)
}

func writeStorageError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "The requested resource was not found.")
	case errors.Is(err, storage.ErrConflict):
		writeError(w, http.StatusConflict, "already_exists", "This local book is already connected to a remote book.")
	case errors.Is(err, storage.ErrPreconditionRequired):
		writeError(w, http.StatusPreconditionRequired, "precondition_required", "If-Match is required for archive uploads.")
	case errors.Is(err, storage.ErrPreconditionFailed):
		writeError(w, http.StatusPreconditionFailed, "sync_conflict", "The remote book changed. Download it before uploading again.")
	case errors.Is(err, storage.ErrArchiveTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "archive_too_large", err.Error())
	case errors.Is(err, storage.ErrInvalidArchive):
		writeError(w, http.StatusBadRequest, "invalid_archive", err.Error())
	default:
		slog.Error("request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "The request could not be completed.")
	}
}
