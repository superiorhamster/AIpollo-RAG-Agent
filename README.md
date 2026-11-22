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

Open a workspace and choose **Library** to upload PDFs and DOCX files up to 25 MiB each. The right-hand reader supports page navigation, zoom, text search, and personal annotations. Owners and Editors can upload, rename, and delete documents. All members can view or download originals. PDFs open immediately. DOCX previews are generated by LibreOffice, and the page links refer to the generated PDF.

Deleting a document or workspace hides it immediately. The background worker removes stored objects and completes workspace deletion after cleanup. An interrupted upload can be retried with the same request key. After eight failed cleanup attempts, restore MinIO connectivity and run `docker compose --env-file .env -f compose.dev.yaml exec -T document-service python -m app.retry_cleanup <workspace-id>` to resume cleanup for that workspace.

The Phase 02 migrations preserve existing workspace and account data. Keep the document and ingestion schemas and MinIO bucket on rollback. Complete pending workspace deletions before downgrading Workspace to `workspace_001`.

## Indexing and source search

Configure an OpenAI-compatible embedding endpoint in the local environment with MODEL_PROVIDER=openai-compatible, MODEL_EMBEDDING_BASE_URL, MODEL_EMBEDDING_NAME, MODEL_EMBEDDING_DIMENSIONS, and MODEL_EMBEDDING_API_KEY. The base URL ends at the provider's API version. After recreating Model Gateway, Ingestion processes queued jobs, including older uploads. It sends extracted passage text to the configured provider. Only set MODEL_PROVIDER=fixture for isolated synthetic tests.

In **Library**, open **Search sources** and select documents to find passages. A result opens its page in the document viewer. With the provider disabled, uploads and previews stay available and indexing waits. Inspect a document's jobs via the existing document jobs API.

The CPU parser has a configurable 300-second document-processing deadline. A document that
exceeds it can still be previewed, but indexing reports `parse_timeout`; incomplete
extraction results are not published as searchable sources.

For a local OpenAI-compatible endpoint on the Docker host, use http://host.docker.internal:PORT/v1 for both base URLs and enable MODEL_ALLOW_LOCAL_HTTP=true in the development environment.

Set MODEL_CHAT_BASE_URL, MODEL_CHAT_NAME, and MODEL_CHAT_API_KEY for the compatible chat endpoint. In **Chats**, choose sources in the sidebar and select Ask, Plan, or Agent in the composer. On a narrow screen, select sources directly in the composer. Accepting a plan saves approval for its current version. Use **Run accepted plan** to start it. Edit or regenerate to draft a new version. Only you can access your conversations, plans, and runs.

### Local EmbeddingGemma in Compose

The optional Ollama overlay uses `embeddinggemma-2:270m-q8_0-text` with **768 output
dimensions**, verified against the downloaded model's embedding API. It runs the
pinned Ollama 0.40.16 image on CPU. Its internal origin is
`http://ollama:11434`; no Ollama host port is published. The overlay selects
`MODEL_EMBEDDING_PROTOCOL=ollama`, using native `/api/embed` with an 8192-token
context and four CPU threads, matching the downloaded model's working host profile.
The default `openai` protocol remains available for compatible providers; its base
URLs stop at `/v1`, because Model Gateway appends `/embeddings` itself.

The Ollama healthcheck computes a synthetic embedding before allowing Model Gateway
to start and keeps the model loaded. CPU cold start can exceed the gateway's normal
25-second deadline; the readiness probe allows 180 seconds. The loaded model consumes
memory even while idle. Metadata availability alone does not mark the model ready.

Set `OLLAMA_MODELS_DIR` in your private `.env` to the absolute directory containing
the existing Ollama `manifests/` and `blobs/` directories. On the current machine it
is `/home/anhpd/Project/Group/RAG/.runtime/models`. The directory is mounted read-only;
the image and model are separate downloads, and the overlay never pulls model weights.
Update models through the host Ollama instance, then update the configured model
revision and re-index. Keep model files outside Git.

```bash
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" compose-check
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" up
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" verify-embedding
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" eval-embedding
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" reindex-embeddings
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" reindex-embeddings APPLY=1
```

The overlay supplies embedding configuration and the placeholder API key `ollama`.
Keep existing `MODEL_CHAT_*` values in `.env`. Use the same `COMPOSE_FILES` argument
for `ps`, `logs`, `verify`, and `down`. Phase verification scripts continue using
isolated fixture projects and do not require this model or its cache.

Re-index defaults to a dry run across active workspaces. Add `WORKSPACE_ID=<uuid>` to
limit it to one workspace. Applying it requeues eligible completed/failed index jobs,
resets attempts and keeps old generation pointers until publication succeeds.
Already current successful jobs, queued/running jobs, preview jobs and deleted
sources are skipped. Wait for running jobs and rerun the command if they used the
previous model. Check document jobs until the selected sources finish. The model,
endpoint, dimensions and revision determine a new fingerprint; the Ollama protocol
and CPU/context options also participate. Retrieval never mixes
old vectors into the new collection. Searches can temporarily lack evidence while
sources are rebuilding.

To roll back, stop the overlay project while keeping volumes, restore the earlier
embedding settings, start the base Compose project, and apply re-index again. Old
collections and original documents are retained. `eval-embedding` reports local
cosine retrieval metrics on the synthetic bilingual corpus and compares the fixture
baseline. The Phase 03 evaluation separately checks live Qdrant hybrid ranking and
tenant filters. Neither small corpus substitutes for production retrieval evaluation.

### Gemini embeddings return 502 `invalid_embedding`

Gemini's OpenAI-compatible endpoint can return HTTP 200 with a valid embedding row that omits `index`. The [Model Gateway adapter](services/model-gateway/app/main.py) sends each input separately to `generativelanguage.googleapis.com`, with up to four concurrent requests per batch, and assembles the vectors in input order. The entire Gemini batch has a 25-second deadline, within Ingestion's 30-second read timeout. A timeout or failed response cancels outstanding requests and returns an error for the whole batch. Each Gemini response must contain exactly one row. Its index may be omitted or set to the integer `0`. Dimension and nonzero-vector checks still apply. Other hosts use the existing indexed batch path.

From the repository root, rebuild only Model Gateway and run the [mocked regression tests](tests/model-gateway/embeddings.py). The tests cover omitted indexes, full 16-input batches, concurrency limits, out-of-order completion, deadline cancellation, upstream failure, and response validation. CI runs these tests in Model Gateway. The following commands use Bash, as does the Makefile.

```bash
docker compose --env-file .env -f compose.dev.yaml up -d --no-deps --build --wait model-gateway
docker compose --env-file .env -f compose.dev.yaml exec -T model-gateway python - < tests/model-gateway/embeddings.py
make verify-provider
```

The adapter fix requires no `.env` changes. The rebuild uses the current configuration, so queued indexing can resume and send document passages to the configured embedding endpoint. `make verify-provider` sends synthetic data to the configured embedding and chat endpoints. On the local Gemini run after the fix, the embedding check passed with a 3072-dimensional vector. The chat response separately failed JSON parsing with an unterminated string.

## Academic work and administration

The workspace assistant can generate cited learning, research and writing outputs. Owner and Editor can save an answer as a shared artifact. Search titles or topics with Crossref from **References**, save selected records with tags, and export BibTeX. PDFs support personal page notes and highlights. Shared artifacts export as Markdown or DOCX.

Administrators can open **Administration** from the Account page to review service readiness, ingestion jobs, account access, audit events, and the active model configuration. Configure SMTP_HOST and SMTP_FROM for password-recovery email. Role and account availability changes revoke the affected sessions.

See [Production on one Docker host](docs/operations/production.md) for the production overlay, digest validation, and backup and restore rehearsal.

### Processing deadlines and recovery

`DOCUMENT_PARSE_TIMEOUT_SECONDS` defaults to 300. A separate parsing subprocess
is killed after that budget plus 30 seconds, or when its caller disconnects.
Ingestion waits another 15 seconds; concurrent parser requests return `parser_busy`
with `Retry-After` and remain subject to bounded ingestion retries. OCR is disabled:
scanned PDFs without a text layer report `no_text` and can still be previewed.

`MODEL_EMBEDDING_TIMEOUT_SECONDS` defaults to 60 and embedding callers allow another
15 seconds. The Ollama overlay embeds one passage per request to bound CPU batch
latency; it retains the selected model, vector dimensions and provider fingerprint.
Chat calls retain their separate 25-second client deadline. Search has an explicit
overall budget with longer gateway/BFF deadlines. `INDEX_JOB_TIMEOUT_SECONDS`
defaults to 1800 (lease plus 60), and `RUN_TIMEOUT_SECONDS` to 210 (lease plus 15).
Invalid combinations are rejected at startup. No partial index is published.
For heavy PDFs on a 2-CPU machine, set `DOCUMENT_PARSE_TIMEOUT_SECONDS=600` in
private `.env`; caller deadlines become 645 seconds automatically. The default
remains 300. Graceful worker shutdown returns only its own unfinished lease to the
queue without consuming an attempt or changing the published generation.

After edits, rebuild/recreate with the same Compose overlay used to start the stack:

```bash
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" up
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" reindex-embeddings
make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml" reindex-embeddings APPLY=1
```

The first reindex command is a dry run. Add `WORKSPACE_ID=<uuid>` to scope recovery.
Changing `.env` without recreating the affected containers does not apply settings.
Generation accepts strict JSON or a complete JSON code fence and validates current
passage UUIDs/provenance. One budgeted regeneration is allowed. Persistent invalid
output reports `invalid_model_output`, rather than insufficient evidence; Ask Retry
keeps the original question, sources and private history snapshot.

Origin protection, authentication throttling and explicit administrator promotion
remain enabled. Tests must use their configured web origin and isolated accounts.
There is no shared development admin password.

### UI regression verification

`make verify-ui` builds the production web image and runs nine Chromium cases
against a synthetic gateway on an isolated Compose project. It covers registration
confirmation/success, bilingual navigation, Retry-After, independent preview/index
readiness, polling recovery, PDF controls and mobile layout, and exact artifact
opening. No application databases or real model providers are used. Browser
artifacts are retained under ignored `test-results/`. The real-provider PDF flow
and Phase 01–03 suites remain separate verification gates.

`make verify-local-rag` uses the configured real chat provider and local Ollama
cache in a separate Compose project with independent databases and storage. It
checks embedding/chat adapters and the bilingual retrieval corpus, generates a
Vietnamese PDF, verifies indexing/search, asks a follow-up question,
and opens the cited PDF page. Its own test data is removed afterwards. Run one
full verification stack at a time on resource-limited hosts; retained main-project
volumes and queued jobs are not part of the test.

### Opt-in reviewed workflows and tutoring

Set `AGENTIC_WORKFLOW_ENABLED=true` and/or `AGENTIC_TUTOR_ENABLED=true` in private
`.env`, then recreate with your existing Compose overlay and `make up`. The
orchestration migration preserves historical plans and their approvals.
**Customize activities** saves a new plan version with up to six source-scoped
activities. Review and Accept that version before execution. Per-activity progress
and cited results are available in the assistant and `GET /v1/workspaces/{id}/runs/{run}/steps`.
**Socratic tutor** is an Ask/Learn task with **More hints** and **Show solution**
actions. Tutor questions stay in the private conversation history.
Feature availability comes from the authenticated `workflow-features` endpoint.
These flags default to false. Curriculum generation and the later Agentic RAG
milestones are tracked in `harness/build/change-20261121-agentic-rag.md`.


### Ask citation mode

In the Ask composer, **Citation Mode** defaults to **Segment**. It uses adaptive
sentence citations for the standard answer output where indexed sentence
maps are available. Choose **Chunk** to use the legacy evidence prompt and PDF
region. The selection is saved in the browser and applies to new Ask turns.
Saved answers and artifacts keep their original citations. Retry reuses the
failed turn's mode. Switching modes does not reindex any documents.

See the [sentence citation guide](docs/ask-pipeline/sentence-citations.md) for the
data flow, API and prompts, parser setup, verification commands and troubleshooting.
The [implementation record](harness/build/change-20261122-sentence-citation-mvp.md)
records observed model and browser results.

Set `AGENTIC_CURRICULUM_ENABLED=true` alongside `AGENTIC_WORKFLOW_ENABLED=true`
to enable source-grounded study schedules in Plan → Learn → Study guide. Choose
1–6 study days. The draft is queued durably; reload the same tab to resume
viewing it. Each day shows activities, expected materials and source pages.
Missing chapters, provider failures and invalid drafts remain unaccepted; adjust
the objective or regenerate. Accept the completed version, then start it to
produce all materials in order for the student to use on those days. This does
not schedule future background executions. Disabling the flag stops new draft
generation while preserving saved plans and approved workflows.

For opt-in multi-paper comparison, set `AGENTIC_RESEARCH_ENABLED=true`. Agent and
accepted Plan research comparison/evidence-table/synthesis tasks require 2–5
papers. Each paper receives its own search, with at most two supplementary
searches across the run. The cited paper × criterion matrix marks missing data;
a separate semantic check removes unsupported synthesis claims after at most
one repair. `RESEARCH_MAX_MODEL_CALLS` (default 12),
`RESEARCH_MAX_TOTAL_OUTPUT_TOKENS` (default 16384), and the existing time/cost
budgets apply across retries and workflow steps. A budget stop returns verified
partial findings. Use `RUN_MAX_OUTPUT_TOKENS=2048` for structured research output.
Ask and historical runs retain their existing execution route. Disable the flag
to stop routing new runs through the graph; stored results remain readable.
This workflow stays opt-in pending the real-model coverage/support evaluation.

Enable `ADAPTIVE_FLASHCARDS_ENABLED=true` to review saved flashcard artifacts
with a private FSRS schedule. Flip a due card, then rate Again/Hard/Good/Easy
(Quên/Khó/Nhớ/Dễ). Due times use UTC. Existing decks receive stable projected
card IDs without changing their shared body; every user has independent state.
Disable the flag to keep the original flashcard reader while retaining progress.
`INTERACTIVE_CONCEPT_MAP_ENABLED=true` renders saved mind maps as accessible SVG
concept graphs. Focus a node and press Enter/Space; choose its source page when
multiple citations are available. Missing or revoked sources use the existing
artifact/reader access errors. The legacy list remains available with the flag off.

For a reasoning-capable compatible chat provider, optionally set
`MODEL_CHAT_REASONING_EFFORT` to a value supported by that model (for example
`low` or `none`). Omit it for providers that do not support the parameter. A
completion can otherwise consume its whole output budget on reasoning and
return no answer text. Gateway diagnostics record only finish/token metadata,
never reasoning or answer contents. See the
[provider parameter](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Set `AGENTIC_DISCOVERY_ENABLED=true` for an editable Crossref query after missing
internal evidence. The provider is called only after **Approve Crossref search**;
**Save reference** is separate. Import/index full text before citing it.
`AGENTIC_WRITING_ENABLED=true` enables verified drafts for Agent or accepted Plan
Write → Draft. Review the cited preview before saving an artifact.
`AGENTIC_DEFENSE_ENABLED=true` adds Ask → Research → Mock defense. Select the draft
document, inspect the targeted passage and counter-evidence, and answer the
reviewer's question in the private conversation. Criticism does not become a
shared cited artifact.

`make verify-formulas` generates a synthetic text-layer STEM PDF and an
extraction report under `test-results/formula-extraction/`. It measures symbols,
indices, units and coordinate retention. The initial corpus is explicitly
unreviewed; a passing smoke result alone does not enable Formula Inspector.
Variable explanations, numeric examples and charts stay gated until reviewed,
representative cases pass. OCR remains separate.

`make verify-agentic-research` runs an isolated real-model synthetic corpus with
a dense Paper A, dataset available only in Paper B, different time units,
conflicting Gamma results under the same protocol and an unanswerable GPU-memory question. It also
checks verified drafts, private mock defense, generated FSRS cards and concept
graphs. The preserved six-chunk Ask path runs on the same corpus as a baseline.
Per-paper matrix coverage, correlated completion/embedding/search calls and
p50/p95 timings are saved with an independent model support score under
`test-results/rag-local-test-*/`. The small synthetic sample is a release gate
input, not a production latency estimate or a substitute for human evaluation.

For compatible chat providers that support JSON object response mode, set
`MODEL_CHAT_RESPONSE_FORMAT=json_object`. It is omitted by default. This requests
valid JSON; backend schema, citation and source checks still apply. Unsupported
providers should leave it empty. See the [response format API contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).


### Smoke test the running stack

Start the normal development stack, then run:

```bash
make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' verify-smoke
```

This Linux Docker browser runner reads `WEB_ORIGIN` from the running web container
and checks registration/login, access renewal, protected APIs, upload/indexing,
scoped search, the PDF reader, exact Plan acceptance/version rules, grounded Ask
and citation navigation. It uses synthetic content on the existing stack. Its
workspace is deleted and its session revoked; the synthetic account record remains
because the application has no public account-deletion API. Each run uses a unique
account. Existing users, workspaces, feature flags and provider settings are preserved.

Stage results and failure screenshots/traces are saved under
`test-results/rag-smoke-*-browser/`. Generation failure makes the command fail even
when core checks pass. `make verify` checks local service HTTP readiness;
`make verify-provider` separately checks actual embedding/chat calls. A router can
advertise a model whose backend accounts are unavailable or rate-limited. Check
that provider's available accounts/quota before changing the RAG application.
