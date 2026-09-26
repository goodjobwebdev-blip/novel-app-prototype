# Novel sync backend

The Go service under `backend/` is an optional, separately deployed backend for versioned `.arcbook` storage. The browser database remains the local source used while writing. The frontend connects to this service for opt-in, per-book, single-writer roaming between browsers or devices.

## Guarantees and boundaries

- Every remote book belongs to an authenticated user.
- API tokens are stored as SHA-256 hashes, never as plaintext.
- Archives are immutable filesystem objects; PostgreSQL stores ownership, revisions, hashes, sizes, and current-version pointers.
- Replacing remote state requires `If-Match`. A stale upload receives `412 Precondition Failed` instead of overwriting another device.
- Uploads are streamed to a temporary file, size-limited, checked for the `ARCBK001` header and manifest length, hashed, and atomically renamed.
- Deleting a book is currently a soft deletion. Objects remain available to server operators for recovery until a later retention job removes them.
- The first release does not merge records, provide registration, process subscriptions, or split media from archives. Each sync transfers one complete `.arcbook` archive.
- The browser checks the remote revision when a connected book opens and when the tab regains focus or connectivity. Uploads are manual by default; an optional two-minute idle upload can be enabled.
- A conflict is never overwritten automatically. The user can import the cloud state as an unlinked recovery copy, download it, deliberately keep local and overwrite the cloud, or decide later.

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

## Browser setup and workflow

1. Open the application's global **Settings → Sync** tab.
2. Enter the HTTPS backend URL, reverse-proxy Basic Auth username/password, and backend sync token.
3. Use **Test connection**, then save the settings.
4. Open a book's **Book → Storage & backups** settings and choose **Enable cloud sync**.
5. On another browser or device, configure the same global credentials, choose **Cloud books** in the Library, and import the book.

Sync credentials are device-global and stored in that browser's `localStorage`. This is convenient for a personal deployment, but anyone with access to the browser profile or page-level script execution can potentially read them. Do not use shared browser profiles, and rotate both credentials if the profile is compromised.

Book connections and sync state are stored in separate IndexedDB tables and are not included in exported archives. Normal backup import remaps identities and remains unlinked; cloud import preserves identities so subsequent versions can safely replace that connected local book.

Manual **Sync now** is authoritative: it flushes the current editor, creates and hashes a complete archive, and then uploads, downloads, or presents a conflict. Automatic checks only compare remote revisions. Optional automatic upload waits for two minutes of local inactivity and is off by default.

The current archive encoder and SHA-256 step can require substantial memory for media-rich books, and every changed revision uploads the full archive. The browser archive format permits files up to 2 GB, while the backend and Caddy examples default to 512 MiB; raise both `MAX_ARCHIVE_BYTES` and Caddy's `request_body max_size` together if larger books must sync.

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

The browser client sends the reverse-proxy credentials in `Authorization`, sends the application token in `X-Sync-Token`, and uses `credentials: "include"`. CORS preflight requests do not carry either credential, which is why the `OPTIONS` handler must bypass Basic Auth.

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
