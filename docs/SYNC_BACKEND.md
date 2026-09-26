# Novel sync backend

The Go service under `backend/` is an optional, separately deployed backend for versioned `.arcbook` storage. The browser database remains the local source used while writing. This initial server implements the backend half of single-writer roaming; the frontend does not connect to it yet.

## Guarantees and boundaries

- Every remote book belongs to an authenticated user.
- API tokens are stored as SHA-256 hashes, never as plaintext.
- Archives are immutable filesystem objects; PostgreSQL stores ownership, revisions, hashes, sizes, and current-version pointers.
- Replacing remote state requires `If-Match`. A stale upload receives `412 Precondition Failed` instead of overwriting another device.
- Uploads are streamed to a temporary file, size-limited, checked for the `ARCBK001` header and manifest length, hashed, and atomically renamed.
- Deleting a book is currently a soft deletion. Objects remain available to server operators for recovery until a later retention job removes them.
- The first release does not merge records, provide registration, process subscriptions, split media from archives, or automatically synchronize the current frontend.

## Configuration

| Variable | Required | Description |
|---|---:|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Compose supplies this. |
| `DATA_DIR` | yes | Archive and temporary-file root; `/data` in containers. |
| `ALLOWED_ORIGINS` | yes | Exact comma-separated frontend origins. Wildcards are rejected. |
| `BOOTSTRAP_USER_EMAIL` | yes | Email attached to the initial private account. |
| `BOOTSTRAP_TOKEN` | yes | At least 32 characters. Changing it rotates the bootstrap token on restart. |
| `MAX_ARCHIVE_BYTES` | no | Maximum request size; defaults to 512 MiB. |
| `PORT` | no | HTTP port; defaults to `8080`. |

Generate production secrets with characters that are safe in a PostgreSQL URL:

```sh
openssl rand -hex 32
```

## API

All routes except health require the sync token. Direct deployments can use bearer authentication:

```http
Authorization: Bearer YOUR_BOOTSTRAP_TOKEN
```

When a reverse proxy uses HTTP Basic Auth, send the application token separately so both authentication layers can coexist:

```http
Authorization: Basic BASE64_PROXY_CREDENTIALS
X-Sync-Token: YOUR_BOOTSTRAP_TOKEN
```

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | Container/reverse-proxy health check |
| `GET` | `/api/v1/me` | Verify authentication |
| `GET` | `/api/v1/books` | List owned remote books |
| `POST` | `/api/v1/books` | Connect a local book identity |
| `GET` | `/api/v1/books/{id}` | Read metadata and current ETag |
| `DELETE` | `/api/v1/books/{id}` | Soft-delete a remote book |
| `GET`, `HEAD` | `/api/v1/books/{id}/state` | Download/current archive metadata |
| `PUT` | `/api/v1/books/{id}/state` | Conditionally upload a new archive |
| `GET` | `/api/v1/books/{id}/versions` | List immutable versions |
| `GET`, `HEAD` | `/api/v1/books/{id}/versions/{revision}` | Download an older version |

Create a remote book:

```sh
curl https://sync.example.com/api/v1/books \
  -u 'BASIC_USER:BASIC_PASSWORD' \
  -H 'X-Sync-Token: YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"clientBookId":"LOCAL_DEXIE_BOOK_ID","title":"My Novel"}'
```

The response starts with `currentEtag: "rev-0-empty"`. Preserve the quoted HTTP `ETag` response header and use it for upload:

```sh
curl -X PUT https://sync.example.com/api/v1/books/REMOTE_BOOK_ID/state \
  -u 'BASIC_USER:BASIC_PASSWORD' \
  -H 'X-Sync-Token: YOUR_TOKEN' \
  -H 'Content-Type: application/vnd.arc-book' \
  -H 'If-Match: "rev-0-empty"' \
  -H 'X-Device-ID: desktop' \
  --data-binary @book.arcbook
```

Each successful upload returns the next `ETag`. A `412` means another client changed the remote archive; clients must download or preserve both copies rather than retrying blindly.

## Local development

```sh
make up
curl http://127.0.0.1:8087/api/v1/health
make backend-test
make down
```

Development credentials are intentionally fixed in `docker-compose.yml` and must never be used in production.

## VPS deployment

### 1. Prepare DNS and directories

Point a hostname such as `sync.example.com` at the VPS. On the VPS:

```sh
sudo mkdir -p /srv/novel-app-prototype /srv/backups/novel-sync
sudo chown -R "$USER":"$USER" /srv/novel-app-prototype /srv/backups/novel-sync
git clone YOUR_REPOSITORY_URL /srv/novel-app-prototype
cd /srv/novel-app-prototype
cp .env.example .env
chmod 600 .env
```

Edit `.env` and set:

- a hexadecimal `POSTGRES_PASSWORD` generated with `openssl rand -hex 32`;
- a separate hexadecimal `BOOTSTRAP_TOKEN`;
- your real email;
- the exact deployed frontend origin in `ALLOWED_ORIGINS`;
- an unused loopback `HOST_PORT`, default `8087`.

### 2. Start the service

```sh
cd /srv/novel-app-prototype
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:8087/api/v1/health
```

PostgreSQL is not published to the host. The API listens only on `127.0.0.1`, where Caddy can reach it.

### 3. Add Caddy

Add a site block, replacing the hostname and port if necessary:

If Caddy Basic Auth is required, let unauthenticated CORS preflight requests reach the backend, then protect all real requests. Generate the password hash with `caddy hash-password`.

```caddyfile
sync.example.com {
    @preflight method OPTIONS

    handle @preflight {
        reverse_proxy 127.0.0.1:8087
    }

    handle {
        basic_auth {
            sync-user PASSWORD_HASH
        }

        request_body {
            max_size 512MB
        }

        reverse_proxy 127.0.0.1:8087
    }
}
```

The browser client must use `X-Sync-Token` and `credentials: "include"`. Visit the sync origin once to establish the browser's Basic Auth credentials before connecting it from the app.

Format, validate, and reload using the method appropriate for your Caddy installation. A common systemd installation uses:

```sh
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://sync.example.com/api/v1/health
```

Keep Caddy's `max_size` aligned with `MAX_ARCHIVE_BYTES`.

### 4. Deploy updates

The Makefile follows the `ai-rpg-v2` deployment style:

```sh
make deploy DEPLOY_HOST=your-user@your-vps DEPLOY_PATH=/srv/novel-app-prototype
```

The server checkout must already be on the branch you intend to deploy. Deployment uses `git pull --ff-only` and rebuilds only this project's Compose services.

### 5. Configure backups

The database and archive volume must be backed up together. The script briefly stops the API, dumps PostgreSQL, archives `/data`, records checksums, and restarts the API:

```sh
chmod +x scripts/backup-sync.sh
PROJECT_DIR=/srv/novel-app-prototype \
BACKUP_DIR=/srv/backups/novel-sync \
./scripts/backup-sync.sh
```

Schedule it with cron or a systemd timer and copy the resulting files off the VPS. A backup on the same VPS does not protect against disk or account loss. Test restoration before relying on it.

## Production checklist

- Keep `.env` mode `600` and never commit it.
- Allow inbound public traffic only to SSH, HTTP, and HTTPS; do not expose PostgreSQL or port `8087`.
- Keep Docker, PostgreSQL, Caddy, and the host patched.
- Copy coordinated backups off-site and perform restore drills.
- Treat `.arcbook` files as sensitive manuscript data.
- Rotate `BOOTSTRAP_TOKEN` immediately if it is exposed.
- Before public registration or paid plans, add token-management endpoints, registration/login, email verification, quotas, rate limiting, retention jobs, audit events, and billing entitlements.
