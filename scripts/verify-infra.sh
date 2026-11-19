#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo ".env is missing. Run make env first." >&2
  exit 1
fi

compose=(docker compose --env-file .env -f compose.dev.yaml)
failed=0

for service in "$@"; do
  cid="$("${compose[@]}" ps -q "$service")"
  if [ -z "$cid" ]; then
    echo "FAIL $service: container not running" >&2
    failed=1
    continue
  fi

  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
  if [ "$status" = "healthy" ]; then
    echo "OK   $service: $status"
  else
    echo "FAIL $service: expected healthy, got $status" >&2
    failed=1
  fi
done

exit "$failed"
