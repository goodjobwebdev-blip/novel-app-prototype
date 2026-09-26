package storage

// QuoteETag formats an opaque ETag value for an HTTP response header.
func QuoteETag(value string) string { return quoteETag(value) }
