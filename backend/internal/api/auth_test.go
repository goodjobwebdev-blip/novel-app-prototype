package api

import (
	"net/http/httptest"
	"testing"
)

func TestBearerToken(t *testing.T) {
	valid := "01234567890123456789012345678901"
	for _, test := range []struct {
		name   string
		header string
		want   bool
	}{
		{name: "valid", header: "Bearer " + valid, want: true},
		{name: "case insensitive", header: "bearer " + valid, want: true},
		{name: "missing", header: "", want: false},
		{name: "wrong scheme", header: "Basic " + valid, want: false},
		{name: "short", header: "Bearer short", want: false},
		{name: "extra", header: "Bearer " + valid + " extra", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, got := bearerToken(test.header)
			if got != test.want {
				t.Fatalf("bearerToken() valid = %v, want %v", got, test.want)
			}
		})
	}
}

func TestRequestTokenSupportsBasicAuthProxy(t *testing.T) {
	token := "01234567890123456789012345678901"
	request := httptest.NewRequest("GET", "/", nil)
	request.Header.Set("Authorization", "Basic ignored-by-sync-backend")
	request.Header.Set("X-Sync-Token", token)

	got, ok := requestToken(request)
	if !ok || got != token {
		t.Fatalf("requestToken() = %q, %v", got, ok)
	}
}

func TestSyncTokenRejectsWhitespace(t *testing.T) {
	if _, ok := syncToken(" 01234567890123456789012345678901"); ok {
		t.Fatal("syncToken accepted leading whitespace")
	}
}
