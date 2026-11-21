#!/usr/bin/env bash
set -euo pipefail
test_dir=$(mktemp -d)
cp .env.example "$test_dir/.env.example"
setup_script="$PWD/scripts/setup-env.sh"
(cd "$test_dir" && bash "$setup_script")
export COMPOSE_PROJECT_NAME="rag-ui-test-$$-$RANDOM"
export WEB_ORIGIN=http://127.0.0.1:3000 WEB_PORT=0
compose=(docker compose --env-file "$test_dir/.env" -f compose.dev.yaml -f compose.ui-test.yaml)
artifact_dir="$PWD/test-results/$COMPOSE_PROJECT_NAME"
mkdir -p "$artifact_dir"
cleanup() {
  result=$?
  trap - EXIT
  docker cp "$COMPOSE_PROJECT_NAME-browser:/tests/test-results/." "$artifact_dir" >/dev/null 2>&1 || true
  docker rm "$COMPOSE_PROJECT_NAME-browser" >/dev/null 2>&1 || true
  if ((result != 0)); then "${compose[@]}" logs --tail=30 web ui-fixtures >&2 || true; fi
  "${compose[@]}" --profile phase01-test down --volumes --rmi local || result=1
  rm -f -- "$test_dir/.env" "$test_dir/.env.example"
  rmdir "$test_dir"
  exit "$result"
}
trap cleanup EXIT
"${compose[@]}" up --build --no-deps --wait --wait-timeout "${VERIFY_WAIT_TIMEOUT:-300}" ui-fixtures web
"${compose[@]}" --profile phase01-test run --build --no-deps --name "$COMPOSE_PROJECT_NAME-browser" phase01-browser-tests
