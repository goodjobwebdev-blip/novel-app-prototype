package storage

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db      *pgxpool.Pool
	dataDir string
}

func Open(ctx context.Context, databaseURL, dataDir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dataDir, "objects"), 0o700); err != nil {
		return nil, fmt.Errorf("create object directory: %w", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	store := &Store{db: pool, dataDir: dataDir}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	if err := migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() { s.db.Close() }

func (s *Store) Bootstrap(ctx context.Context, email, rawToken string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bootstrap: %w", err)
	}
	defer tx.Rollback(ctx)

	var userID string
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		userID, err = newUUID()
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO users (id, email) VALUES ($1, $2)`, userID, email); err != nil {
			return fmt.Errorf("create bootstrap user: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("find bootstrap user: %w", err)
	}

	tokenID, err := newUUID()
	if err != nil {
		return err
	}
	hash := sha256.Sum256([]byte(rawToken))
	if _, err := tx.Exec(ctx, `
		INSERT INTO api_tokens (id, user_id, token_hash, label)
		VALUES ($1, $2, $3, 'bootstrap')
		ON CONFLICT (user_id, label) DO UPDATE
		SET token_hash = EXCLUDED.token_hash, revoked_at = NULL, expires_at = NULL`, tokenID, userID, hash[:]); err != nil {
		return fmt.Errorf("create bootstrap token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bootstrap: %w", err)
	}
	return nil
}

func (s *Store) Authenticate(ctx context.Context, rawToken string) (User, error) {
	hash := sha256.Sum256([]byte(rawToken))
	var user User
	err := s.db.QueryRow(ctx, `
		SELECT users.id, users.email
		FROM api_tokens
		JOIN users ON users.id = api_tokens.user_id
		WHERE api_tokens.token_hash = $1
		  AND api_tokens.revoked_at IS NULL
		  AND (api_tokens.expires_at IS NULL OR api_tokens.expires_at > now())`, hash[:]).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("authenticate token: %w", err)
	}
	_, _ = s.db.Exec(ctx, `UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')`, hash[:])
	return user, nil
}

func (s *Store) CreateBook(ctx context.Context, ownerID, clientBookID, title string) (Book, error) {
	id, err := newUUID()
	if err != nil {
		return Book{}, err
	}
	clientBookID = strings.TrimSpace(clientBookID)
	title = strings.TrimSpace(title)
	var book Book
	err = s.db.QueryRow(ctx, `
		INSERT INTO books (id, owner_id, client_book_id, title)
		VALUES ($1, $2, $3, $4)
		RETURNING id, client_book_id, title, current_revision, current_etag,
		          current_content_hash, current_size, current_object_key, created_at, updated_at, deleted_at`,
		id, ownerID, clientBookID, title).Scan(bookFields(&book)...)
	if isUniqueViolation(err) {
		return Book{}, ErrConflict
	}
	if err != nil {
		return Book{}, fmt.Errorf("create book: %w", err)
	}
	return book, nil
}

func (s *Store) ListBooks(ctx context.Context, ownerID string) ([]Book, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, client_book_id, title, current_revision, current_etag,
		       current_content_hash, current_size, current_object_key, created_at, updated_at, deleted_at
		FROM books
		WHERE owner_id = $1 AND deleted_at IS NULL
		ORDER BY updated_at DESC`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list books: %w", err)
	}
	defer rows.Close()
	books := make([]Book, 0)
	for rows.Next() {
		var book Book
		if err := rows.Scan(bookFields(&book)...); err != nil {
			return nil, fmt.Errorf("scan book: %w", err)
		}
		books = append(books, book)
	}
	return books, rows.Err()
}

func (s *Store) GetBook(ctx context.Context, ownerID, bookID string) (Book, error) {
	var book Book
	err := s.db.QueryRow(ctx, `
		SELECT id, client_book_id, title, current_revision, current_etag,
		       current_content_hash, current_size, current_object_key, created_at, updated_at, deleted_at
		FROM books
		WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`, bookID, ownerID).Scan(bookFields(&book)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("get book: %w", err)
	}
	return book, nil
}

func (s *Store) DeleteBook(ctx context.Context, ownerID, bookID string) error {
	command, err := s.db.Exec(ctx, `UPDATE books SET deleted_at = now(), updated_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`, bookID, ownerID)
	if err != nil {
		return fmt.Errorf("delete book: %w", err)
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListVersions(ctx context.Context, ownerID, bookID string) ([]Version, error) {
	rows, err := s.db.Query(ctx, `
		SELECT versions.book_id, versions.revision, versions.etag, versions.object_key,
		       versions.content_hash, versions.size, versions.device_id, versions.created_at
		FROM book_versions versions
		JOIN books ON books.id = versions.book_id
		WHERE books.id = $1 AND books.owner_id = $2 AND books.deleted_at IS NULL
		ORDER BY versions.revision DESC`, bookID, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()
	versions := make([]Version, 0)
	for rows.Next() {
		var version Version
		if err := rows.Scan(&version.BookID, &version.Revision, &version.ETag, &version.ObjectKey, &version.ContentHash, &version.Size, &version.DeviceID, &version.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan version: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	if len(versions) == 0 {
		if _, err := s.GetBook(ctx, ownerID, bookID); err != nil {
			return nil, err
		}
	}
	return versions, nil
}

func (s *Store) OpenCurrentArchive(ctx context.Context, ownerID, bookID string) (Book, *os.File, error) {
	book, err := s.GetBook(ctx, ownerID, bookID)
	if err != nil {
		return Book{}, nil, err
	}
	if book.CurrentObjectKey == nil {
		return Book{}, nil, ErrNotFound
	}
	file, err := os.Open(s.objectPath(*book.CurrentObjectKey))
	if errors.Is(err, os.ErrNotExist) {
		return Book{}, nil, fmt.Errorf("archive object is missing: %w", err)
	}
	if err != nil {
		return Book{}, nil, fmt.Errorf("open archive: %w", err)
	}
	return book, file, nil
}

func (s *Store) PutCurrentArchive(ctx context.Context, ownerID, bookID, ifMatch, deviceID string, stage StagedArchive) (_ Book, err error) {
	if strings.TrimSpace(ifMatch) == "" {
		discardStage(stage)
		return Book{}, ErrPreconditionRequired
	}
	defer func() {
		if err != nil {
			discardStage(stage)
		}
	}()

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return Book{}, fmt.Errorf("begin archive update: %w", err)
	}
	defer tx.Rollback(ctx)

	var currentRevision int64
	var currentETag string
	err = tx.QueryRow(ctx, `
		SELECT current_revision, current_etag
		FROM books
		WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
		FOR UPDATE`, bookID, ownerID).Scan(&currentRevision, &currentETag)
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("lock book: %w", err)
	}
	if !etagMatches(ifMatch, currentETag, currentRevision > 0) {
		return Book{}, ErrPreconditionFailed
	}

	revision := currentRevision + 1
	etag := fmt.Sprintf("rev-%d-sha256-%s", revision, stage.ContentHash)
	objectID, err := newUUID()
	if err != nil {
		return Book{}, err
	}
	objectKey := filepath.Join(ownerID, bookID, objectID+".arcbook")
	objectPath := s.objectPath(objectKey)
	if err := os.MkdirAll(filepath.Dir(objectPath), 0o700); err != nil {
		return Book{}, fmt.Errorf("create object path: %w", err)
	}
	if err := os.Rename(stage.Path, objectPath); err != nil {
		return Book{}, fmt.Errorf("commit archive object: %w", err)
	}
	stage.Path = ""
	if err := os.Chmod(objectPath, 0o600); err != nil {
		_ = os.Remove(objectPath)
		return Book{}, fmt.Errorf("secure archive object: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(objectPath)
		}
	}()

	var nullableDeviceID any
	if value := strings.TrimSpace(deviceID); value != "" {
		nullableDeviceID = value
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO book_versions (book_id, revision, etag, object_key, content_hash, size, device_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, bookID, revision, etag, objectKey, stage.ContentHash, stage.Size, nullableDeviceID); err != nil {
		return Book{}, fmt.Errorf("record archive version: %w", err)
	}
	var book Book
	if err := tx.QueryRow(ctx, `
		UPDATE books
		SET current_revision = $3, current_etag = $4, current_object_key = $5,
		    current_content_hash = $6, current_size = $7, updated_at = now()
		WHERE id = $1 AND owner_id = $2
		RETURNING id, client_book_id, title, current_revision, current_etag,
		          current_content_hash, current_size, current_object_key, created_at, updated_at, deleted_at`,
		bookID, ownerID, revision, etag, objectKey, stage.ContentHash, stage.Size).Scan(bookFields(&book)...); err != nil {
		return Book{}, fmt.Errorf("update current archive: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Book{}, fmt.Errorf("commit archive update: %w", err)
	}
	committed = true
	return book, nil
}

func (s *Store) OpenVersionArchive(ctx context.Context, ownerID, bookID string, revision int64) (Version, *os.File, error) {
	var version Version
	err := s.db.QueryRow(ctx, `
		SELECT versions.book_id, versions.revision, versions.etag, versions.object_key,
		       versions.content_hash, versions.size, versions.device_id, versions.created_at
		FROM book_versions versions
		JOIN books ON books.id = versions.book_id
		WHERE books.id = $1 AND books.owner_id = $2 AND books.deleted_at IS NULL AND versions.revision = $3`,
		bookID, ownerID, revision).Scan(&version.BookID, &version.Revision, &version.ETag, &version.ObjectKey, &version.ContentHash, &version.Size, &version.DeviceID, &version.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, nil, ErrNotFound
	}
	if err != nil {
		return Version{}, nil, fmt.Errorf("get version: %w", err)
	}
	file, err := os.Open(s.objectPath(version.ObjectKey))
	if err != nil {
		return Version{}, nil, fmt.Errorf("open version: %w", err)
	}
	return version, file, nil
}

func (s *Store) objectPath(objectKey string) string {
	return filepath.Join(s.dataDir, "objects", filepath.Clean(objectKey))
}

func bookFields(book *Book) []any {
	return []any{&book.ID, &book.ClientBookID, &book.Title, &book.CurrentRevision, &book.CurrentETag,
		&book.CurrentContentHash, &book.CurrentSize, &book.CurrentObjectKey, &book.CreatedAt, &book.UpdatedAt, &book.DeletedAt}
}

func isUniqueViolation(err error) bool {
	var pgError *pgconn.PgError
	return errors.As(err, &pgError) && pgError.Code == "23505"
}

func CopyArchive(destination io.Writer, source *os.File) error {
	_, err := io.Copy(destination, source)
	return err
}
