package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestObjectPathUsesServerGeneratedSegments(t *testing.T) {
	root := t.TempDir()
	store := &Store{dataDir: root}
	got := store.objectPath(filepath.Join("user-id", "book-id", "object.arcbook"))
	wantPrefix := filepath.Join(root, "objects") + string(filepath.Separator)
	if !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("object path %q is outside %q", got, wantPrefix)
	}
}
