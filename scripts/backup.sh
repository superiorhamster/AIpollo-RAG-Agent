#!/usr/bin/env bash
set -euo pipefail
umask 077

if (($# != 2)); then
  echo 'Usage: bash scripts/backup.sh ENV_FILE NEW_BACKUP_DIRECTORY' >&2
  exit 2
fi
env_file=$1
backup=$2
compose=(docker compose --env-file "$env_file" -f compose.dev.yaml -f compose.prod.yaml)
running=$("${compose[@]}" ps --services --status running)
if [[ -z "$running" ]] || printf '%s\n' "$running" | rg -qv '^(postgres|redis|rabbitmq|minio|qdrant)$'; then
  echo 'Leave only PostgreSQL, Redis, RabbitMQ, MinIO and Qdrant running during a backup.' >&2
  exit 2
fi
broker=$("${compose[@]}" exec -T rabbitmq rabbitmqctl -q list_queues -p rag-documents name messages)
if printf '%s\n' "$broker" | awk 'NF == 2 && $2 ~ /^[0-9]+$/ && $2 > 0 {found=1} END {exit !found}'; then
  echo 'Drain the document lifecycle queues before entering the backup maintenance window.' >&2
  exit 2
fi
mkdir -- "$backup"
"${compose[@]}" exec -T postgres sh -ec 'exec pg_dump --format=custom -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  >"$backup/postgres.dump"
"${compose[@]}" run --rm --no-deps -T -v "$PWD/scripts/object-backup.py:/backup.py:ro" \
  document-service python /backup.py save >"$backup/documents.tar"
"${compose[@]}" run --rm --no-deps -T -v "$PWD/scripts/vector-backup.py:/backup.py:ro" \
  retrieval-service python /backup.py save >"$backup/vectors.tar"
(cd "$backup" && sha256sum postgres.dump documents.tar vectors.tar >SHA256SUMS)
echo 'Backup complete.'
