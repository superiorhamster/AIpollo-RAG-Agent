# Super Agentic RAG

## Run the development stack

Install Git, Bash, GNU Make, Docker Engine or Docker Desktop, and the Docker Compose plugin. Start Docker, then run this from the repository root.

```bash
make bootstrap
```

Bootstrap checks prerequisites, fills in missing development credentials in `.env`, builds the containers, applies database migrations, waits for readiness, and runs the infrastructure and HTTP smoke checks. The first build downloads dependencies and compiles MinIO from its pinned upstream release. Set `WEB_PORT`, `API_GATEWAY_PORT`, or the infrastructure port variables in `.env` if the defaults are in use. `WEB_ORIGIN` defaults to `http://127.0.0.1` and `WEB_PORT`. On loopback HTTP, opening a page through `localhost` or `127.0.0.1` redirects to the configured hostname at the same port. Set `WEB_ORIGIN` to the exact browser origin for other addresses.

| Component | Development address |
| --- | --- |
| Web | `http://127.0.0.1:23000` |
| API gateway | `http://127.0.0.1:23001` |
| PostgreSQL | `127.0.0.1:23002` |
| Redis | `127.0.0.1:23003` |
| RabbitMQ AMQP | `127.0.0.1:23004` |
| RabbitMQ management | `http://127.0.0.1:23005` |
| Qdrant HTTP | `http://127.0.0.1:23006` |
| Qdrant gRPC | `127.0.0.1:23007` |
| MinIO API and console | `http://127.0.0.1:23008` and `http://127.0.0.1:23009` |

Only the web client, gateway, and local infrastructure ports are published, all on loopback. Other backend services listen on port `8000` and are reachable by service name within Compose. Each application exposes `/healthz` and `/readyz`.

| Command | Effect |
| --- | --- |
| `make compose-check` | Validate the resolved Compose configuration. |
| `make up` | Rebuild and start the full stack after editing source. |
| `make ps` / `make logs` | Inspect container status or follow logs. |
| `make verify` | Check infrastructure health, application endpoints, and the web home page. |
| `make verify-phase01` | Run the identity and workspace API, database, and Playwright checks in an isolated Compose project. |
| `make verify-phase02` | Run document API, fault recovery, and Playwright checks in an isolated Compose project. |
| `make verify-phase03` | Check queued indexing and scoped retrieval with synthetic data in an isolated Compose project. |
| `make promote-admin USER_ID=<uuid>` | Give an existing account the platform Admin role and revoke its active sessions. |
| `make down` | Stop and remove containers while retaining data volumes. |
| `make infra-up` / `make infra-down` | Start or stop only the five infrastructure services. |
| `make infra-ps` / `make infra-logs` / `make verify-infra` | Inspect, follow logs, or verify only the infrastructure services. |
| `make clean-infra` | Stop the stack and delete its local data volumes. |

## Repository layout

- `apps/web/` contains the Next.js App Router client, strict TypeScript configuration, and pnpm lockfile. For host development, use Node.js 22 and the pnpm version in `package.json`, then run `pnpm install --frozen-lockfile` and `pnpm dev` from `apps/web`.
- `services/` contains the ten FastAPI service entry points. Each service owns its `pyproject.toml` and `uv.lock`. For host-side service development, use Python 3.12+, export the relevant service settings from Compose, and set `PYTHONPATH` to the absolute path of `services/shared` before running `uv run --locked uvicorn app.main:app` from the service directory.
- `infra/` contains local infrastructure builds. The MinIO build uses the [upstream source release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z).
- `packages/contracts/` defines the [transport conventions](packages/contracts/README.md) and health schema.
- `.codex/` holds the [architecture](.codex/docs/architecture.md), [service boundaries](.codex/docs/service-boundaries.md), and project requirements. Follow the root [AGENTS.md](AGENTS.md) and the [Phase 01 execution plan](harness/build/phase-01-identity-workspace-core.md).

## Identity and sharing

Open the web app, create an account, then sign in. Create a workspace to become its owner. To share it, ask a collaborator for the User ID shown on their Account page, then use **Sharing** to grant Viewer or Editor access. Viewers can read the workspace. Editors can also rename it. Owners manage sharing and deletion. The platform Admin role is separate from workspace access. Users promoted to Admin sign in again to start a new session.

The gateway serves the [Phase 01 OpenAPI contract](services/api-gateway/app/openapi-v1.json) at `/openapi.json`. It requires the configured `Origin` on API writes, including refresh. Auth uses a five-minute access JWT and rotates the refresh token within a twelve-hour session measured from login. The browser renews access on demand. Use loopback HTTP for local Compose and set `WEB_ORIGIN` to the full HTTPS origin for TLS deployments so session cookies carry `Secure`.

When upgrading from opaque sessions, run `make bootstrap` and sign in again. The migration preserves accounts and workspace data. Retain `AUTH_JWT_SIGNING_KEY` in the local environment across restarts. For rollback, stop Web, Gateway, Workspace, and Auth, use the current Auth migration image to run `alembic -c app/alembic.ini downgrade identity_001`, then restore the previous application images and sign in again.

The database provisioning job adds separate identity and workspace schemas to the existing PostgreSQL database. `make up` applies their Alembic migrations before starting dependent services. `make down` preserves data. Rolling application images back to Phase 00 preserves the new schemas. Keep generated `.env` credentials private and use separate secrets for deployments.

## Documents

Open **Documents** on a workspace to upload PDFs and DOCX files up to 25 MiB each. Owners and Editors can upload, rename, and delete documents. All members can view or download originals. PDFs open immediately. DOCX previews are generated by LibreOffice, and the page links refer to the generated PDF.

Deleting a document or workspace hides it immediately. The background worker removes stored objects and completes workspace deletion after cleanup. An interrupted upload can be retried with the same request key. After eight failed cleanup attempts, restore MinIO connectivity and run `docker compose --env-file .env -f compose.dev.yaml exec -T document-service python -m app.retry_cleanup <workspace-id>` to resume cleanup for that workspace.

The Phase 02 migrations preserve existing workspace and account data. Keep the document and ingestion schemas and MinIO bucket on rollback. Complete pending workspace deletions before downgrading Workspace to `workspace_001`.

## Indexing and source search

Configure an OpenAI-compatible embedding endpoint in the local environment with MODEL_PROVIDER=openai-compatible, MODEL_EMBEDDING_BASE_URL, MODEL_EMBEDDING_NAME, MODEL_EMBEDDING_DIMENSIONS, and MODEL_EMBEDDING_API_KEY. The base URL ends at the provider's API version. After recreating Model Gateway, Ingestion processes queued jobs, including older uploads. It sends extracted passage text to the configured provider. Only set MODEL_PROVIDER=fixture for isolated synthetic tests.

Choose sources in a workspace and use **Search sources** to find passages. A result opens its page in the document viewer. With the provider disabled, uploads and previews stay available and indexing waits. Inspect a document's jobs via the existing document jobs API.

For a local OpenAI-compatible endpoint on the Docker host, use http://host.docker.internal:PORT/v1 for both base URLs and enable MODEL_ALLOW_LOCAL_HTTP=true in the development environment.

Set MODEL_CHAT_BASE_URL, MODEL_CHAT_NAME, and MODEL_CHAT_API_KEY for the compatible chat endpoint. In a workspace, choose sources and select Ask, Plan, or Agent in **Workspace assistant**. Accepting a plan saves approval for its current version. Use **Run accepted plan** to start it. Edit or regenerate to draft a new version. Only you can access your conversations, plans, and runs.

## Academic work and administration

The workspace assistant can generate cited learning, research and writing outputs. Owner and Editor can save an answer as a shared artifact. Search titles or topics with Crossref from **References**, save selected records with tags, and export BibTeX. PDFs support personal page notes and highlights. Shared artifacts export as Markdown or DOCX.

Administrators can open **Administration** from the Account page to review accounts, jobs, model settings, readiness and the identity audit. Configure SMTP_HOST and SMTP_FROM for password-recovery email. Role and account availability changes revoke the affected sessions.

See [Production on one Docker host](docs/operations/production.md) for the production overlay, digest validation, and backup and restore rehearsal.
