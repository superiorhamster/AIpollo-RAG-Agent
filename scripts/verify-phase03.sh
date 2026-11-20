#!/usr/bin/env bash
set -euo pipefail

test_dir=$(mktemp -d)
cp .env.example "$test_dir/.env.example"
setup_script="$PWD/scripts/setup-env.sh"
(cd "$test_dir" && bash "$setup_script")

export COMPOSE_PROJECT_NAME="rag-phase03-test-$$-$RANDOM"
export WEB_ORIGIN=http://127.0.0.1:3000 WEB_PORT=0 API_GATEWAY_PORT=0 POSTGRES_PORT=0 REDIS_PORT=0
export RABBITMQ_AMQP_PORT=0 RABBITMQ_MANAGEMENT_PORT=0 MINIO_API_PORT=0 MINIO_CONSOLE_PORT=0
export QDRANT_HTTP_PORT=0 QDRANT_GRPC_PORT=0 MODEL_PROVIDER=disabled
compose=(docker compose --env-file "$test_dir/.env" -f compose.dev.yaml)
cleanup() {
  result=$?
  trap - EXIT
  if ((result != 0)); then
    "${compose[@]}" logs --tail=40 ingestion-service retrieval-service model-gateway document-parser >&2 || true
  fi
  "${compose[@]}" --profile phase01-test down --volumes --rmi local || result=1
  rm -f -- "$test_dir/.env" "$test_dir/.env.example"
  rmdir "$test_dir"
  exit "$result"
}
trap cleanup EXIT

run_check() {
  "${compose[@]}" run --rm --no-deps -T -v "$PWD/tests:/tests:ro" \
    ingestion-service python /tests/phase03/api.py "$@"
}

"${compose[@]}" up --build --wait --wait-timeout 180 web
"${compose[@]}" run --rm --no-deps -T -e PYTHONPATH=/app:/app/shared -v "$PWD/tests:/tests:ro" \
  agent-orchestrator python /tests/phase05/history_ask.py
read -r workspace_id pdf_id docx_id <<< "$(run_check seed)"
MODEL_PROVIDER=fixture "${compose[@]}" up --no-deps --wait --wait-timeout 60 model-gateway
"${compose[@]}" run --rm --no-deps -T -v "$PWD/tests:/tests:ro" \
  ingestion-service python /tests/phase05/compose_api.py "$workspace_id" "$pdf_id"
"${compose[@]}" --profile phase01-test run --no-deps --rm --build \
  -e "PHASE03_WORKSPACE_ID=$workspace_id" \
  -v "$PWD/tests/phase05/citation.spec.ts:/tests/workspace.spec.ts:ro" phase01-browser-tests
run_check "$workspace_id" "$pdf_id" "$docx_id"
"${compose[@]}" run --rm --no-deps -T -v "$PWD/tests/eval:/eval:ro" \
  model-gateway python /eval/retrieval.py
