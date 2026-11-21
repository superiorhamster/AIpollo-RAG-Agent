#!/usr/bin/env bash
set -euo pipefail
# Uses configured providers with synthetic inputs and completely independent data.
export COMPOSE_PROJECT_NAME="rag-local-test-$$-$RANDOM"
export WEB_ORIGIN=http://127.0.0.1:3000 WEB_PORT=0 API_GATEWAY_PORT=0 POSTGRES_PORT=0 REDIS_PORT=0
export RABBITMQ_AMQP_PORT=0 RABBITMQ_MANAGEMENT_PORT=0 MINIO_API_PORT=0 MINIO_CONSOLE_PORT=0
export QDRANT_HTTP_PORT=0 QDRANT_GRPC_PORT=0
compose=(docker compose --env-file .env -f compose.dev.yaml -f compose.ollama.yaml)
artifact_dir="$PWD/test-results/$COMPOSE_PROJECT_NAME"
mkdir -p "$artifact_dir"
cleanup() {
  result=$?
  trap - EXIT
  docker cp "$COMPOSE_PROJECT_NAME-browser:/tests/test-results/." "$artifact_dir" >/dev/null 2>&1 || true
  docker rm "$COMPOSE_PROJECT_NAME-browser" >/dev/null 2>&1 || true
  if ((result != 0)); then
    "${compose[@]}" logs --tail=30 agent-orchestrator ingestion-service model-gateway document-parser >&2 || true
  fi
  "${compose[@]}" --profile phase01-test down --volumes --rmi local || result=1
  exit "$result"
}
trap cleanup EXIT
"${compose[@]}" up --build --wait --wait-timeout "${VERIFY_WAIT_TIMEOUT:-300}" web
"${compose[@]}" exec -T model-gateway python - < scripts/verify-embedding.py
"${compose[@]}" exec -T model-gateway python - < scripts/verify-provider.py
"${compose[@]}" run --rm --no-deps -T -e PYTHONPATH=/app:/app/shared \
  -v "$PWD/tests/eval:/eval:ro" model-gateway python /eval/embedding_provider.py
read -r parse_seconds run_seconds <<< "$("${compose[@]}" exec -T ingestion-service python -c 'from rag_runtime import RuntimeBudgets; b=RuntimeBudgets.from_env(); print(b.parse, b.run)')"
"${compose[@]}" --profile phase01-test run --build --no-deps --name "$COMPOSE_PROJECT_NAME-browser" \
  -e "LOCAL_RAG_PARSE_SECONDS=$parse_seconds" -e "LOCAL_RAG_RUN_SECONDS=$run_seconds" \
  -v "$PWD/tests/phase05/local_rag.spec.ts:/tests/workspace.spec.ts:ro" phase01-browser-tests
