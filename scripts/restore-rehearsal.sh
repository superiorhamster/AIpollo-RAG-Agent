#!/usr/bin/env bash
set -euo pipefail
umask 077

if (($# != 3)) || [[ "$2" != rag-restore-* ]]; then
  echo 'Usage: bash scripts/restore-rehearsal.sh ISOLATED_ENV rag-restore-NAME BACKUP_DIRECTORY' >&2
  exit 2
fi
env_file=$1
project=$2
backup=$3
(cd "$backup" && sha256sum --strict --check SHA256SUMS)
compose=(docker compose --project-name "$project" --env-file "$env_file" -f compose.dev.yaml)
export WEB_PORT=0 API_GATEWAY_PORT=0 POSTGRES_PORT=0 REDIS_PORT=0 QDRANT_HTTP_PORT=0 QDRANT_GRPC_PORT=0
export RABBITMQ_AMQP_PORT=0 RABBITMQ_MANAGEMENT_PORT=0 MINIO_API_PORT=0 MINIO_CONSOLE_PORT=0
export MODEL_PROVIDER=disabled
if [[ -n "$("${compose[@]}" ps --all --quiet)" ||
      -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]]; then
  echo 'Choose a new restore rehearsal project.' >&2
  exit 2
fi
"${compose[@]}" up --build --wait postgres redis rabbitmq qdrant minio
"${compose[@]}" run --rm -T db-init
"${compose[@]}" run --rm -T --build document-infra-init
"${compose[@]}" exec -T postgres sh -ec 'exec pg_restore --clean --if-exists --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  <"$backup/postgres.dump"
"${compose[@]}" run --rm --no-deps --build -T -v "$PWD/scripts/object-backup.py:/backup.py:ro" \
  document-service python /backup.py restore <"$backup/documents.tar"
"${compose[@]}" run --rm --no-deps --build -T -v "$PWD/scripts/vector-backup.py:/backup.py:ro" \
  retrieval-service python /backup.py restore <"$backup/vectors.tar"
"${compose[@]}" up --build --wait --wait-timeout 180
"${compose[@]}" exec -T api-gateway python - <scripts/verify-app.py
printf 'Restored project %s. Inspect it before deleting its isolated volumes.\n' "$project"
