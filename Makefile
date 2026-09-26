.PHONY: up down build logs backend-test backend-check backend-smoke check prod-build prod prod-down prod-logs prod-status backup deploy

DEPLOY_HOST ?= myvps
DEPLOY_PATH ?= /srv/novel-app-prototype

# ── Development ──────────────────────────────────

up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f backend

backend-test:
	cd backend && go test ./...

backend-check:
	cd backend && go vet ./... && go build ./cmd/server ./cmd/migrate

backend-smoke:
	python3 scripts/backend-smoke-test.py

check: backend-test backend-check
	npm run build

# ── Production ───────────────────────────────────

prod-build:
	docker compose -f docker-compose.prod.yml build

prod:
	docker compose -f docker-compose.prod.yml up -d --build

prod-down:
	docker compose -f docker-compose.prod.yml down

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f app

prod-status:
	docker compose -f docker-compose.prod.yml ps

backup:
	PROJECT_DIR=$(CURDIR) scripts/backup-sync.sh

# Usage: make deploy DEPLOY_HOST=user@example.com DEPLOY_PATH=/srv/novel-app-prototype
deploy:
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && git pull --ff-only && docker compose -f docker-compose.prod.yml up -d --build'
