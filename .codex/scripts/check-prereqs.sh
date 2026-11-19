#!/usr/bin/env bash
set -euo pipefail

missing=0
for cmd in git docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    missing=1
  fi
done

if command -v docker >/dev/null 2>&1; then
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required (docker compose)." >&2
    missing=1
  fi
fi

if command -v make >/dev/null 2>&1; then
  echo "make: $(make --version | head -n 1)"
else
  echo "make not found; it is recommended. You can run scripts and docker compose manually." >&2
fi

if command -v codex >/dev/null 2>&1; then
  echo "codex: $(codex --version 2>/dev/null || echo installed)"
else
  echo "codex not found. Install/update with: npm install -g @openai/codex@latest" >&2
fi

if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "Core prerequisites are available."
