package storage

import (
	"errors"
	"time"
)

var (
	ErrNotFound             = errors.New("resource not found")
	ErrConflict             = errors.New("resource already exists")
	ErrPreconditionFailed   = errors.New("the remote book changed")
	ErrPreconditionRequired = errors.New("If-Match is required")
)

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type Book struct {
	ID                 string     `json:"id"`
	ClientBookID       string     `json:"clientBookId"`
	Title              string     `json:"title"`
	CurrentRevision    int64      `json:"currentRevision"`
	CurrentETag        string     `json:"currentEtag"`
	CurrentContentHash *string    `json:"currentContentHash,omitempty"`
	CurrentSize        int64      `json:"currentSize"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
	DeletedAt          *time.Time `json:"-"`
	CurrentObjectKey   *string    `json:"-"`
}

type Version struct {
	BookID      string    `json:"bookId"`
	Revision    int64     `json:"revision"`
	ETag        string    `json:"etag"`
	ContentHash string    `json:"contentHash"`
	Size        int64     `json:"size"`
	DeviceID    *string   `json:"deviceId,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	ObjectKey   string    `json:"-"`
}
