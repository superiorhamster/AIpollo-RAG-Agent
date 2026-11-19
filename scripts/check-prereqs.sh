#!/usr/bin/env bash
set -euo pipefail

missing=0
for command_name in git docker make; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    missing=1
  fi
done

if command -v docker >/dev/null 2>&1; then
  if ! docker compose version; then
    echo "The Docker Compose plugin is required (docker compose)." >&2
    missing=1
  fi
fi

if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "Core prerequisites are available."
