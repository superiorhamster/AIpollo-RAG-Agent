# Production on one Docker host

Use a DNS hostname that points to the Docker host and permits inbound TCP 80 and 443. The production overlay publishes Caddy and uses the Web application as the single browser entry point. Keep the development and production Compose projects separate. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

## Prepare and validate

1. Run make production-env. Store the generated .env.production securely and fill in WEB_ORIGIN, PRODUCTION_HOSTNAME, the database, broker and object-store passwords, and both provider configurations. Use a deployment-specific database, broker and object-store account. Set SMTP values for password recovery, and OTEL_EXPORTER_OTLP_ENDPOINT to an OTLP HTTP collector if one is available.
2. Build and publish the application, MinIO, parser and converter images with the release commit tag. Record each published manifest digest in the corresponding RAG_*_IMAGE setting. Record the reviewed digests for PostgreSQL, Redis, RabbitMQ, Qdrant and Caddy. Migration jobs use the same digest as their owning service.
3. Run make production-check. Run the development Compose regressions and evaluate the fixture corpus. Run make verify-provider on the configured development stack to test the real embedding and chat contracts with synthetic evidence. Scan the exact proposed production digests using Grype. Review vulnerabilities and licenses for the locked dependencies and model weights before rollout.
4. Run the production Compose overlay with --no-build and --wait. Check the public HTTPS entry point and browser login. Complete the upload, index, Ask and citation walkthrough using a synthetic PDF and the real provider.

    docker compose --env-file .env.production -f compose.dev.yaml -f compose.prod.yaml up --no-build --wait

The production service environment contains the provider credentials. The Admin model view displays configured names and readiness. Change provider settings through the deployment environment and recreate Model Gateway. Keep the credential file outside backup archives and protect it in the deployment secret store.

## Backup and restore

Take backups in a maintenance window. Stop browser ingress and wait for document lifecycle messages to drain while the workers still run. Stop all application services and leave PostgreSQL, Redis, RabbitMQ, MinIO and Qdrant running. The backup command checks these conditions before creating its output directory.

    bash scripts/backup.sh .env.production /absolute/path/to/new-backup

Keep postgres.dump, documents.tar, vectors.tar and SHA256SUMS together under controlled, encrypted storage. Record the exact Compose configuration inputs and image digests separately. The dump preserves database object owners and privileges.

For a rehearsal, use a separate environment file and a new Compose project beginning with rag-restore-. The script initializes roles and storage, verifies the manifest, restores all stores and starts an isolated application with ephemeral ports. Use PostgreSQL and Qdrant versions compatible with the saved data.

    bash scripts/restore-rehearsal.sh .env.restore rag-restore-rehearsal /absolute/path/to/backup

Inspect a restored account, workspace, PDF page and indexed passage and record the restore duration before approving an upgrade. Store the previous images and pre-upgrade backup for rollback. Use the restore rehearsal workflow to prove the rollback before routing traffic to restored data.

## Replace the embedding model

Restore a backup into a separate Compose project. Configure the new compatible embedding model and start Model Gateway. Inside Ingestion, run `python -m app.reindex` to preview eligible sources, then `python -m app.reindex --apply` to queue them. The command now defaults to dry run and accepts `--workspace <uuid>`. Wait for running jobs and repeat the command if they used the old model. Wait for all eligible sources to finish and run the retrieval evaluation and citation checks with the new model. Keep serving from the original project while you validate the new index. Plan cutover during a maintenance window and include any uploads or changes made after the rehearsal snapshot.

## Operational checks

HTTP logs include status, latency and X-Request-ID. View matching request IDs across service logs or send the selected request and worker spans to an OTLP HTTP collector. In Administration, check service readiness, failed jobs, the identity audit and active model settings. Investigate repeated cleanup failures before reopening a backup or retrying a job.
