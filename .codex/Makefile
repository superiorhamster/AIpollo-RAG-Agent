SHELL := /usr/bin/env bash
COMPOSE := docker compose --env-file .env -f compose.dev.yaml

.PHONY: check env bootstrap infra-up infra-down infra-ps infra-logs verify-infra clean-infra

check:
	@./scripts/check-prereqs.sh

env:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; else echo ".env already exists"; fi

bootstrap: check env infra-up verify-infra

infra-up: env
	$(COMPOSE) up -d

infra-down:
	$(COMPOSE) down

infra-ps:
	$(COMPOSE) ps

infra-logs:
	$(COMPOSE) logs -f --tail=100

verify-infra:
	@./scripts/verify-infra.sh

clean-infra:
	$(COMPOSE) down -v
