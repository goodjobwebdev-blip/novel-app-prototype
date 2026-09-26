package storage

import "strings"

func etagMatches(header, current string, representationExists bool) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" {
			return representationExists
		}
		if strings.HasPrefix(candidate, "W/") {
			continue
		}
		if len(candidate) >= 2 && candidate[0] == '"' && candidate[len(candidate)-1] == '"' {
			if candidate[1:len(candidate)-1] == current {
				return true
			}
		}
	}
	return false
}

func quoteETag(value string) string {
	return `"` + value + `"`
}
