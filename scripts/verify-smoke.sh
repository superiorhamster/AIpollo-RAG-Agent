#!/usr/bin/env bash
set -euo pipefail
compose=(docker compose --env-file .env)
for file in ${COMPOSE_FILES:-compose.dev.yaml}; do compose+=(-f "$file"); done
origin=$("${compose[@]}" exec -T web node -p 'process.env.WEB_ORIGIN')
"${compose[@]}" --profile phase01-test build phase01-browser-tests
browser_image=$("${compose[@]}" --profile phase01-test config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin);print(c["services"]["phase01-browser-tests"].get("image",c["name"]+"-phase01-browser-tests"))')
container="rag-smoke-$$-$RANDOM-browser"
artifact_dir="$PWD/test-results/$container"
mkdir -p "$artifact_dir"
cleanup() {
  result=$?
  trap - EXIT
  docker cp "$container:/tests/test-results/." "$artifact_dir" >/dev/null 2>&1 || true
  docker rm -f "$container" >/dev/null 2>&1 || true
  echo "Smoke artifacts: $artifact_dir"
  exit "$result"
}
trap cleanup EXIT
# Linux host networking reaches the published loopback origin without changing its CSRF policy.
docker run --name "$container" --network host --shm-size=256m -e "PHASE01_TEST_ORIGIN=$origin" \
  -v "$PWD/tests/smoke/running-stack.spec.ts:/tests/workspace.spec.ts:ro" "$browser_image"
