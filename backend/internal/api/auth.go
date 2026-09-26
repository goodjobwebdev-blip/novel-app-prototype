package api

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"

	"novel-sync/internal/storage"
)

type userContextKey struct{}

type authenticator interface {
	Authenticate(context.Context, string) (storage.User, error)
}

func authentication(auth authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r.Header.Get("Authorization"))
			if !ok {
				writeError(w, http.StatusUnauthorized, "authentication_required", "A valid bearer token is required.")
				return
			}
			user, err := auth.Authenticate(r.Context(), token)
			if err != nil {
				// Keep unknown, expired, and revoked tokens indistinguishable.
				writeError(w, http.StatusUnauthorized, "authentication_required", "A valid bearer token is required.")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
		})
	}
}

func bearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || subtle.ConstantTimeCompare([]byte(strings.ToLower(parts[0])), []byte("bearer")) != 1 || len(parts[1]) < 32 {
		return "", false
	}
	return parts[1], true
}

func currentUser(r *http.Request) storage.User {
	return r.Context().Value(userContextKey{}).(storage.User)
}
