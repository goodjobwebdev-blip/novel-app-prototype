package main

import (
	"context"
	"log/slog"
	"os"

	"novel-sync/internal/config"
	"novel-sync/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	store, err := storage.Open(context.Background(), cfg.DatabaseURL, cfg.DataDir)
	if err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}
	store.Close()
	slog.Info("migrations are current")
}
