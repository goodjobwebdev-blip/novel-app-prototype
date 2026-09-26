package storage

import (
	"bytes"
	"encoding/binary"
	"os"
	"testing"
)

func archiveBytes(manifest []byte, payload []byte) []byte {
	result := append([]byte{}, archiveMagic[:]...)
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(manifest)))
	result = append(result, size[:]...)
	result = append(result, manifest...)
	return append(result, payload...)
}

func TestStageArchive(t *testing.T) {
	root := t.TempDir()
	input := archiveBytes([]byte(`{"format":"arc-book","version":1}`), []byte("payload"))
	stage, err := StageArchive(root, bytes.NewReader(input), 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer discardStage(stage)
	if stage.Size != int64(len(input)) || len(stage.ContentHash) != 64 {
		t.Fatalf("unexpected stage: %+v", stage)
	}
	if _, err := os.Stat(stage.Path); err != nil {
		t.Fatalf("staged file missing: %v", err)
	}
}

func TestStageArchiveRejectsInvalidInput(t *testing.T) {
	for _, test := range []struct {
		name  string
		input []byte
		limit int64
	}{
		{name: "wrong magic", input: []byte("not an archive"), limit: 1024},
		{name: "truncated manifest", input: archiveBytes([]byte("{}"), nil)[:13], limit: 1024},
		{name: "too large", input: archiveBytes([]byte("{}"), []byte("payload")), limit: 12},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := StageArchive(t.TempDir(), bytes.NewReader(test.input), test.limit); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
