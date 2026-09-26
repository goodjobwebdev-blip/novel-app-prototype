CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    label TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT ARRAY['books:read', 'books:write'],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
);
CREATE INDEX api_tokens_user_id_idx ON api_tokens(user_id);

CREATE TABLE books (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    current_revision BIGINT NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    current_etag TEXT NOT NULL DEFAULT 'rev-0-empty',
    current_object_key TEXT,
    current_content_hash TEXT,
    current_size BIGINT NOT NULL DEFAULT 0 CHECK (current_size >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (owner_id, client_book_id)
);
CREATE INDEX books_owner_updated_idx ON books(owner_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE book_versions (
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision > 0),
    etag TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    size BIGINT NOT NULL CHECK (size >= 0),
    device_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (book_id, revision)
);
CREATE INDEX book_versions_book_created_idx ON book_versions(book_id, created_at DESC);
