package storage

import "testing"

func TestETagMatches(t *testing.T) {
	tests := []struct {
		name   string
		header string
		value  string
		exists bool
		want   bool
	}{
		{name: "exact", header: `"rev-1-abc"`, value: "rev-1-abc", exists: true, want: true},
		{name: "list", header: `"old", "rev-1-abc"`, value: "rev-1-abc", exists: true, want: true},
		{name: "stale", header: `"rev-0-empty"`, value: "rev-1-abc", exists: true, want: false},
		{name: "weak does not match", header: `W/"rev-1-abc"`, value: "rev-1-abc", exists: true, want: false},
		{name: "wildcard exists", header: `*`, value: "rev-1-abc", exists: true, want: true},
		{name: "wildcard missing", header: `*`, value: "rev-0-empty", exists: false, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := etagMatches(test.header, test.value, test.exists); got != test.want {
				t.Fatalf("etagMatches() = %v, want %v", got, test.want)
			}
		})
	}
}
