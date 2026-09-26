package migrations

import "embed"

// Files contains the ordered SQL migrations applied by the backend.
//
//go:embed *.sql
var Files embed.FS
