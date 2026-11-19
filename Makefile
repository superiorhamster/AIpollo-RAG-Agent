SHELL := /usr/bin/env bash
COMPOSE := docker compose --env-file .env -f compose.dev.yaml
INFRA_SERVICES := postgres redis rabbitmq qdrant minio
WAIT_TIMEOUT ?= 180
PRODUCTION_ENV ?= .env.production
PRODUCTION_COMPOSE := docker compose --env-file "$(PRODUCTION_ENV)" -f compose.dev.yaml -f compose.prod.yaml

.PHONY: check env bootstrap compose-check up ps logs down verify verify-app verify-phase01 verify-phase02 verify-phase03 verify-provider promote-admin \
        infra-up infra-down infra-ps infra-logs verify-infra clean-infra

check:
	@./scripts/check-prereqs.sh

env:
	@bash scripts/setup-env.sh

bootstrap: check
	$(MAKE) up
	$(MAKE) verify

compose-check: env
	$(COMPOSE) config --quiet

up: env
	$(COMPOSE) up --build --wait --wait-timeout $(WAIT_TIMEOUT)

ps:
	$(COMPOSE) ps --all

logs:
	$(COMPOSE) logs -f --tail=100

down:
	$(COMPOSE) down

verify: verify-infra verify-app

verify-app:
	$(COMPOSE) exec -T api-gateway python - < scripts/verify-app.py

verify-phase01: env
	@bash scripts/verify-phase01.sh

verify-phase02: env
	@bash scripts/verify-phase02.sh

verify-phase03: env
	@bash scripts/verify-phase03.sh

verify-provider:
	$(COMPOSE) exec -T model-gateway python - < scripts/verify-provider.py

promote-admin:
	@if ! [[ "$$USER_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$$ ]]; then echo 'Usage: make promote-admin USER_ID=<uuid>' >&2; exit 2; fi
	$(COMPOSE) exec -T auth-service python -m app.promote_admin "$$USER_ID"

infra-up: env
	$(COMPOSE) up --build --wait --wait-timeout $(WAIT_TIMEOUT) $(INFRA_SERVICES)

infra-down:
	$(COMPOSE) stop $(INFRA_SERVICES)
	$(COMPOSE) rm -f $(INFRA_SERVICES)

infra-ps:
	$(COMPOSE) ps --all $(INFRA_SERVICES)

infra-logs:
	$(COMPOSE) logs -f --tail=100 $(INFRA_SERVICES)

verify-infra:
	@./scripts/verify-infra.sh $(INFRA_SERVICES)

clean-infra:
	$(COMPOSE) down -v

.PHONY: production-env production-check

production-env:
	@bash scripts/setup-env.sh "$(PRODUCTION_ENV)" .env.production.example

production-check:
	@set -o pipefail && $(PRODUCTION_COMPOSE) config --format json | python3 scripts/production-config.py
