#!/usr/bin/env bash
set -euo pipefail

test_dir="$(mktemp -d)"
cp .env.example "$test_dir/.env.example"
setup_script="$PWD/scripts/setup-env.sh"
(
  cd "$test_dir"
  bash "$setup_script"
)

# Give the test project independent data and ephemeral host ports.
export COMPOSE_PROJECT_NAME="rag-phase01-test-$$-$RANDOM"
export WEB_ORIGIN=http://127.0.0.1:3000 WEB_PORT=0 API_GATEWAY_PORT=0 POSTGRES_PORT=0 REDIS_PORT=0
export MODEL_PROVIDER=disabled QDRANT_HTTP_PORT=0 QDRANT_GRPC_PORT=0
export RABBITMQ_AMQP_PORT=0 RABBITMQ_MANAGEMENT_PORT=0 MINIO_API_PORT=0 MINIO_CONSOLE_PORT=0
export POSTGRES_DB=phase01_test POSTGRES_USER=phase01_test_operator
export POSTGRES_PASSWORD="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
export AUTH_ACCOUNT_LIMIT=4 AUTH_PEER_LIMIT=100 AUTH_RATE_WINDOW_SECONDS=900
export AUTH_ACCESS_TTL_SECONDS=300 AUTH_SESSION_TTL_SECONDS=43200
export PHASE01_TEST_DB_USER="$POSTGRES_USER" PHASE01_TEST_DB_PASSWORD="$POSTGRES_PASSWORD"

compose=(docker compose --env-file "$test_dir/.env" -f compose.dev.yaml)
cleanup() {
  result=$?
  trap - EXIT
  if ((result != 0)); then
    "${compose[@]}" logs --tail=60 >&2 || true
  fi
  "${compose[@]}" --profile phase01-test down --volumes --rmi local || result=1
  rm -f -- "$test_dir/.env" "$test_dir/.env.example"
  rmdir -- "$test_dir"
  exit "$result"
}
trap cleanup EXIT

"${compose[@]}" up --wait --wait-timeout 60 postgres
"${compose[@]}" run --rm --no-deps db-init
"${compose[@]}" run --rm --no-deps --build auth-migrate alembic -c app/alembic.ini upgrade identity_001
"${compose[@]}" run --rm -T --no-deps auth-migrate python - < tests/phase01/legacy-session.py
"${compose[@]}" up --build --wait --wait-timeout 120 web
"${compose[@]}" exec -T auth-service python - < tests/phase01/jwt-claims.py
read -r admin_id PHASE01_PROMOTED_ACCESS <<< "$("${compose[@]}" exec -T -e WEB_ORIGIN workspace-service python - --seed-admin < tests/phase01/api.py)"
export PHASE01_PROMOTED_ACCESS
"${compose[@]}" exec -T auth-service python -m app.promote_admin "$admin_id"
"${compose[@]}" exec -T -e WEB_ORIGIN -e PHASE01_TEST_DB_USER -e PHASE01_TEST_DB_PASSWORD -e PHASE01_PROMOTED_ACCESS workspace-service \
  python - < tests/phase01/api.py
"${compose[@]}" --profile phase01-test run --rm --build phase01-browser-tests
