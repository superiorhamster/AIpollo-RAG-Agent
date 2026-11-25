#!/usr/bin/env bash
set -euo pipefail

test_dir="$(mktemp -d)"
cp .env.example "$test_dir/.env.example"
setup_script="$PWD/scripts/setup-env.sh"
(cd "$test_dir" && bash "$setup_script")
mkdir -m 755 "$test_dir/fixtures"

export COMPOSE_PROJECT_NAME="rag-phase02-test-$$-$RANDOM"
artifact_dir="$PWD/test-results/$COMPOSE_PROJECT_NAME"
mkdir -p "$artifact_dir"
export WEB_ORIGIN=http://127.0.0.1:3000 WEB_PORT=0 API_GATEWAY_PORT=0 POSTGRES_PORT=0 REDIS_PORT=0
export MODEL_PROVIDER=disabled QDRANT_HTTP_PORT=0 QDRANT_GRPC_PORT=0
export RABBITMQ_AMQP_PORT=0 RABBITMQ_MANAGEMENT_PORT=0 MINIO_API_PORT=0 MINIO_CONSOLE_PORT=0
export POSTGRES_DB=phase02_test POSTGRES_USER=phase02_test_operator
export POSTGRES_PASSWORD="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
export RABBITMQ_DEFAULT_USER=phase02_operator
export RABBITMQ_DEFAULT_PASS="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
export PHASE02_RABBIT_USER="$RABBITMQ_DEFAULT_USER" PHASE02_RABBIT_PASS="$RABBITMQ_DEFAULT_PASS"
export PHASE02_POSTGRES_USER="$POSTGRES_USER" PHASE02_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"

compose=(docker compose --env-file "$test_dir/.env" -f compose.dev.yaml)
cleanup() {
  result=$?
  trap - EXIT
  docker cp "$COMPOSE_PROJECT_NAME-browser:/tests/test-results/." "$artifact_dir" >/dev/null 2>&1 || true
  docker rm "$COMPOSE_PROJECT_NAME-browser" >/dev/null 2>&1 || true
  "${compose[@]}" unpause document-converter >/dev/null 2>&1 || true
  if ((result != 0)); then
    "${compose[@]}" logs --tail=35 document-infra-init workspace-service document-service ingestion-service document-converter api-gateway web >&2 || true
  fi
  "${compose[@]}" --profile phase01-test down --volumes --rmi local || result=1
  rm -f -- "$test_dir/.env" "$test_dir/.env.example"
  rm -f -- "$test_dir/fixtures/study.pdf" "$test_dir/fixtures/paper.docx"
  rmdir -- "$test_dir/fixtures" "$test_dir"
  exit "$result"
}
trap cleanup EXIT

run_api() {
  "${compose[@]}" exec -T -e PHASE02_RABBIT_USER -e PHASE02_RABBIT_PASS -e PHASE02_POSTGRES_USER \
    -e PHASE02_POSTGRES_PASSWORD workspace-service python - "$@" < tests/phase02/api.py
}

"${compose[@]}" up --build --wait --wait-timeout "${VERIFY_WAIT_TIMEOUT:-300}" web
"${compose[@]}" run --rm --no-deps -T -e PYTHONPATH=/app:/app/shared -v "$PWD/tests/phase02/annotations.py:/tests/annotations.py:ro" \
  document-service python /tests/annotations.py
run_api
workspace_id="$(run_api --prepare)"
"${compose[@]}" stop minio
run_api --offline "$workspace_id"
"${compose[@]}" up --wait --wait-timeout 60 minio
run_api --recover "$workspace_id"
printf 'MinIO outage and retry passed.\n'

"${compose[@]}" pause document-converter
deleted_workspace="$(run_api --cascade)"
"${compose[@]}" unpause document-converter
"${compose[@]}" exec -T -e "PHASE02_DELETED_WORKSPACE=$deleted_workspace" document-service python - <<'PY'
import os
from minio import Minio

storage = Minio("minio:9000", "rag-documents", os.environ["DOCUMENT_STORAGE_PASSWORD"], secure=False)
prefix = os.environ["PHASE02_DELETED_WORKSPACE"] + "/"
assert not list(storage.list_objects(os.environ["DOCUMENT_BUCKET"], prefix=prefix, recursive=True))
print("Cascade cancelled conversion and cleared the workspace prefix in MinIO.")
PY

run_api --fixtures | tar -xf - -C "$test_dir/fixtures"
"${compose[@]}" --profile phase01-test run --no-deps --name "$COMPOSE_PROJECT_NAME-browser" --build \
  -v "$PWD/tests/phase02/documents.spec.ts:/tests/workspace.spec.ts:ro" \
  -v "$test_dir/fixtures:/fixtures:ro" phase01-browser-tests
