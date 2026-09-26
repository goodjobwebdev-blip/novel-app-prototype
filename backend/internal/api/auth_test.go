package api

import "testing"

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
