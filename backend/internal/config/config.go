package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultMaxArchiveBytes int64 = 512 << 20

type Config struct {
	Port               string
	DatabaseURL        string
	DataDir            string
	AllowedOrigins     []string
	BootstrapUserEmail string
	BootstrapToken     string
	MaxArchiveBytes    int64
	ReadHeaderTimeout  time.Duration
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Port:               value("PORT", "8080"),
		DatabaseURL:        strings.TrimSpace(os.Getenv("DATABASE_URL")),
		DataDir:            value("DATA_DIR", "./data"),
		AllowedOrigins:     splitCSV(value("ALLOWED_ORIGINS", "http://localhost:5173")),
		BootstrapUserEmail: strings.TrimSpace(os.Getenv("BOOTSTRAP_USER_EMAIL")),
		BootstrapToken:     strings.TrimSpace(os.Getenv("BOOTSTRAP_TOKEN")),
		MaxArchiveBytes:    defaultMaxArchiveBytes,
		ReadHeaderTimeout:  10 * time.Second,
		ReadTimeout:        5 * time.Minute,
		WriteTimeout:       5 * time.Minute,
		IdleTimeout:        2 * time.Minute,
	}

	if raw := strings.TrimSpace(os.Getenv("MAX_ARCHIVE_BYTES")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 12 {
			return Config{}, fmt.Errorf("MAX_ARCHIVE_BYTES must be an integer of at least 12")
		}
		cfg.MaxArchiveBytes = parsed
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.BootstrapUserEmail == "" || cfg.BootstrapToken == "" {
		return Config{}, errors.New("BOOTSTRAP_USER_EMAIL and BOOTSTRAP_TOKEN are required")
	}
	if len(cfg.BootstrapToken) < 32 {
		return Config{}, errors.New("BOOTSTRAP_TOKEN must contain at least 32 characters")
	}
	if len(cfg.AllowedOrigins) == 0 {
		return Config{}, errors.New("ALLOWED_ORIGINS must contain at least one origin")
	}
	for _, origin := range cfg.AllowedOrigins {
		if origin == "*" {
			return Config{}, errors.New("ALLOWED_ORIGINS cannot contain * when bearer authentication is enabled")
		}
	}
	return cfg, nil
}

func value(key, fallback string) string {
	if result := strings.TrimSpace(os.Getenv(key)); result != "" {
		return result
	}
	return fallback
}

func splitCSV(raw string) []string {
	var result []string
	for _, value := range strings.Split(raw, ",") {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}
