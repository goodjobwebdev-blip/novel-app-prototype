#!/bin/sh
set -eu

PROJECT_DIR=${PROJECT_DIR:-/srv/novel-app-prototype}
BACKUP_DIR=${BACKUP_DIR:-/srv/backups/novel-sync}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}

cd "$PROJECT_DIR"
if [ ! -f .env ]; then
  echo "Missing $PROJECT_DIR/.env" >&2
  exit 1
fi
set -a
. ./.env
set +a

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)

restart_app() {
  docker compose -f "$COMPOSE_FILE" start app >/dev/null 2>&1 || true
}
trap restart_app EXIT INT TERM

docker compose -f "$COMPOSE_FILE" stop app
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 > "$BACKUP_DIR/postgres-$stamp.sql.gz"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps --user 0:0 \
  -v "$BACKUP_DIR:/backup" --entrypoint sh app \
  -c "tar -czf /backup/archives-$stamp.tar.gz -C /data ."
sha256sum "$BACKUP_DIR/postgres-$stamp.sql.gz" "$BACKUP_DIR/archives-$stamp.tar.gz" \
  > "$BACKUP_DIR/checksums-$stamp.sha256"
chmod 600 "$BACKUP_DIR/postgres-$stamp.sql.gz" "$BACKUP_DIR/archives-$stamp.tar.gz" "$BACKUP_DIR/checksums-$stamp.sha256"

restart_app
trap - EXIT INT TERM
echo "Backup written to $BACKUP_DIR with timestamp $stamp"
