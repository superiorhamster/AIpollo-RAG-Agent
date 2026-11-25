#!/usr/bin/env bash
set -euo pipefail
# Uses configured providers with synthetic inputs and completely independent data.
export AGENTIC_TUTOR_ENABLED=true AGENTIC_WORKFLOW_ENABLED=true AGENTIC_CURRICULUM_ENABLED=true RUN_MAX_OUTPUT_TOKENS=2048
scenario=${LOCAL_RAG_SCENARIO:-baseline}
case "$scenario" in
  baseline) browser_spec=tests/phase05/local_rag.spec.ts ;;
  research)
    browser_spec=tests/phase05/research_live.spec.ts
    export AGENTIC_RESEARCH_ENABLED=true AGENTIC_WRITING_ENABLED=true AGENTIC_DEFENSE_ENABLED=true
    export ADAPTIVE_FLASHCARDS_ENABLED=true INTERACTIVE_CONCEPT_MAP_ENABLED=true
    ;;
  *) echo 'Unknown local RAG scenario.' >&2; exit 2 ;;
esac
export COMPOSE_PROJECT_NAME="rag-local-test-$$-$RANDOM"
export WEB_ORIGIN=http://127.0.0.1:3000 WEB_PORT=0 API_GATEWAY_PORT=0 POSTGRES_PORT=0 REDIS_PORT=0
export RABBITMQ_AMQP_PORT=0 RABBITMQ_MANAGEMENT_PORT=0 MINIO_API_PORT=0 MINIO_CONSOLE_PORT=0
export QDRANT_HTTP_PORT=0 QDRANT_GRPC_PORT=0
compose=(docker compose --env-file .env)
for file in ${COMPOSE_FILES:-compose.dev.yaml}; do compose+=(-f "$file"); done
artifact_dir="$PWD/test-results/$COMPOSE_PROJECT_NAME"
mkdir -p "$artifact_dir"
cleanup() {
  result=$?
  trap - EXIT
  docker cp "$COMPOSE_PROJECT_NAME-browser:/tests/test-results/." "$artifact_dir" >/dev/null 2>&1 || true
  docker rm "$COMPOSE_PROJECT_NAME-browser" >/dev/null 2>&1 || true
  # Retain stage timings for the synthetic corpus even when the browser stops before generation.
  "${compose[@]}" logs --no-color ingestion-service document-parser model-gateway |
    python3 -c 'import json,sys
for line in sys.stdin:
    try: event=json.loads(line[line.index("{"):])
    except (ValueError,TypeError): continue
    if event.get("event")=="http.request" and event.get("route") in {"/internal/v1/parse","/internal/v1/embeddings"}:
        print(json.dumps({key:event.get(key) for key in ("service","route","request_id","status","duration_ms")}))' > "$artifact_dir/index-timings.jsonl" || true
  if ((result != 0)); then
    "${compose[@]}" logs --tail=30 agent-orchestrator ingestion-service model-gateway document-parser api-gateway auth-service web >&2 || true
  fi
  "${compose[@]}" --profile phase01-test down --volumes --rmi local || result=1
  exit "$result"
}
trap cleanup EXIT
"${compose[@]}" up --build --wait --wait-timeout "${VERIFY_WAIT_TIMEOUT:-300}" web
if [[ "$scenario" == baseline ]]; then
  "${compose[@]}" exec -T model-gateway python - < scripts/verify-embedding.py
  "${compose[@]}" exec -T model-gateway python - < scripts/verify-provider.py
  "${compose[@]}" run --rm --no-deps -T -e PYTHONPATH=/app:/app/shared \
    -v "$PWD/tests/eval:/eval:ro" model-gateway python /eval/embedding_provider.py
fi
read -r index_seconds run_seconds <<< "$("${compose[@]}" exec -T ingestion-service python -c 'from rag_runtime import RuntimeBudgets; b=RuntimeBudgets.from_env(); print(b.index, b.run)')"
"${compose[@]}" --profile phase01-test run --build --no-deps --name "$COMPOSE_PROJECT_NAME-browser" \
  -e "EXPECT_CITATION_MODE_SWITCH=${EXPECT_CITATION_MODE_SWITCH:-0}" -e "LOCAL_RAG_INDEX_SECONDS=$index_seconds" -e "LOCAL_RAG_RUN_SECONDS=$run_seconds" \
  -v "$PWD/$browser_spec:/tests/workspace.spec.ts:ro" phase01-browser-tests
if [[ "$scenario" == research ]]; then
  docker cp "$COMPOSE_PROJECT_NAME-browser:/tests/test-results/." "$artifact_dir"
  "${compose[@]}" logs --no-color model-gateway retrieval-service > "$artifact_dir/call-metadata.log"
  python3 tests/eval/agentic_metrics.py "$artifact_dir/evaluation/research-output.json" "$artifact_dir/call-metadata.log" > "$artifact_dir/runtime-metrics.json"
  "${compose[@]}" run --rm --no-deps -T -v "$artifact_dir/evaluation:/evaluation:ro" -v "$PWD/tests/eval:/eval:ro" \
    model-gateway python /eval/research_live_judge.py /evaluation/research-output.json > "$artifact_dir/support-metrics.json"
fi
