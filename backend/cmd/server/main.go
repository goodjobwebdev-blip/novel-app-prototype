package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"novel-sync/internal/api"
	"novel-sync/internal/config"
	"novel-sync/internal/storage"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, err := storage.Open(ctx, cfg.DatabaseURL, cfg.DataDir)
	if err != nil {
		slog.Error("open storage", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	if err := store.Bootstrap(ctx, cfg.BootstrapUserEmail, cfg.BootstrapToken); err != nil {
		slog.Error("bootstrap account", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              fmt.Sprintf(":%s", cfg.Port),
		Handler:           api.NewRouter(cfg, store),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	go func() {
		slog.Info("server starting", "address", server.Addr, "max_archive_bytes", cfg.MaxArchiveBytes)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server stopped unexpectedly", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
	}
}
