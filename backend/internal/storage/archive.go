package storage

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	archiveHeaderSize = 12
	maxManifestBytes  = 64 << 20
)

var (
	archiveMagic       = [8]byte{'A', 'R', 'C', 'B', 'K', '0', '0', '1'}
	ErrArchiveTooLarge = errors.New("archive is too large")
	ErrInvalidArchive  = errors.New("invalid archive")
)

type StagedArchive struct {
	Path        string
	Size        int64
	ContentHash string
}

func StageArchive(root string, source io.Reader, maxBytes int64) (_ StagedArchive, err error) {
	tempDir := filepath.Join(root, "tmp")
	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return StagedArchive{}, fmt.Errorf("create upload directory: %w", err)
	}
	file, err := os.CreateTemp(tempDir, "upload-*.arcbook")
	if err != nil {
		return StagedArchive{}, fmt.Errorf("create upload: %w", err)
	}
	path := file.Name()
	closed := false
	defer func() {
		if !closed {
			if closeErr := file.Close(); err == nil && closeErr != nil {
				err = closeErr
			}
		}
		if err != nil {
			_ = os.Remove(path)
		}
	}()

	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(source, maxBytes+1))
	if err != nil {
		return StagedArchive{}, fmt.Errorf("store upload: %w", err)
	}
	if written > maxBytes {
		return StagedArchive{}, fmt.Errorf("%w: exceeds the %d byte limit", ErrArchiveTooLarge, maxBytes)
	}
	if written < archiveHeaderSize {
		return StagedArchive{}, fmt.Errorf("%w: archive is truncated", ErrInvalidArchive)
	}
	if err := file.Sync(); err != nil {
		return StagedArchive{}, fmt.Errorf("sync upload: %w", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return StagedArchive{}, fmt.Errorf("inspect upload: %w", err)
	}
	var header [archiveHeaderSize]byte
	if _, err := io.ReadFull(file, header[:]); err != nil {
		return StagedArchive{}, fmt.Errorf("%w: archive is truncated", ErrInvalidArchive)
	}
	if headerMagic := [8]byte(header[:8]); headerMagic != archiveMagic {
		return StagedArchive{}, fmt.Errorf("%w: file is not an ARCBK001 archive", ErrInvalidArchive)
	}
	manifestSize := int64(binary.BigEndian.Uint32(header[8:]))
	if manifestSize > maxManifestBytes {
		return StagedArchive{}, fmt.Errorf("%w: archive manifest exceeds the 64 MiB limit", ErrInvalidArchive)
	}
	if archiveHeaderSize+manifestSize > written {
		return StagedArchive{}, fmt.Errorf("%w: archive manifest is truncated", ErrInvalidArchive)
	}
	if err := file.Close(); err != nil {
		return StagedArchive{}, fmt.Errorf("close upload: %w", err)
	}
	closed = true
	return StagedArchive{Path: path, Size: written, ContentHash: hex.EncodeToString(hash.Sum(nil))}, nil
}

func discardStage(stage StagedArchive) {
	if stage.Path != "" {
		_ = os.Remove(stage.Path)
	}
}
