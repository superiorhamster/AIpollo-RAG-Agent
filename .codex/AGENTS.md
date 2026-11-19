# Super Agentic RAG — Repository Instructions for Codex

## Mission
Build a production-grade academic Agentic RAG platform for students and researchers. The product must support grounded learning, research, and writing workflows over user-selected academic sources while keeping the user in control of autonomous actions.

The primary actors are **User** and **Admin**. Authentication and role-based authorization are mandatory.

## Read only what the task needs
Use these documents contextually; do not read every file before every small change.

- `docs/requirements-baseline.md` — product behavior, acceptance criteria, requirement IDs.
- `docs/product-modes.md` — Ask/Plan/Agent semantics and the approval contract.
- `docs/architecture.md` — service topology and data flow.
- `docs/service-boundaries.md` — ownership rules between microservices.
- `PLANS.md` — implementation phase sequence and cross-service planning rules.
- `CODEX_SETUP.md` — local prerequisites and bootstrap commands.
- `DEPENDENCIES.md` — approved stack/dependency baseline and dependency-change rules.

If a task conflicts with these documents, stop and report the conflict instead of silently changing product semantics.

## Non-negotiable product rules

1. **Auth and tenancy**
   - Support User and Admin roles.
   - Enforce authorization server-side on every protected API.
   - Retrieval must always apply workspace/user access filters before returning chunks.
   - Never rely on frontend hiding as authorization.

2. **Interaction modes are separate from academic capabilities**
   - Interaction modes: `ASK`, `PLAN`, `AGENT`.
   - Academic capabilities: `LEARN`, `RESEARCH`, `WRITE`.
   - A request may combine one interaction mode with one academic capability.

3. **Product Plan mode (`LEARN-02` / `/plan`) is approval-gated**
   - The plan shown to the user is a concise, inspectable action plan, not hidden chain-of-thought.
   - Plan generation may perform read-only inspection/retrieval needed to prepare the plan.
   - It must not execute the planned mutating or externally consequential actions.
   - Every plan has an immutable `plan_version`.
   - Editing, regenerating, or materially changing a plan creates a new version and invalidates prior acceptance.
   - Execution is allowed only when the backend receives an acceptance record for the exact current `plan_version`.
   - The UI must expose **Accept**, **Edit/Adjust**, **Regenerate**, and **Cancel** controls.
   - The execution service must reject stale or missing acceptance even if a client attempts to bypass the UI.

4. **Agent mode is bounded**
   - Agent loops must have configurable step, time, token/cost, and retry limits.
   - Long-running operations must expose status/progress and support cancellation when feasible.
   - Tool calls must be allowlisted and auditable.

5. **Grounded academic answers**
   - Important factual claims derived from sources must carry citations.
   - Citation metadata must resolve to the exact source and page/chunk.
   - Clicking a citation should open or focus that document in the right-side document panel at the relevant page/region.
   - If evidence is insufficient, abstain or clearly mark uncertainty instead of inventing support.

6. **Microservices + Docker**
   - Deployable services must run in containers.
   - Production images must be pinned to reviewed versions/digests; floating tags are acceptable only in the development-only Compose baseline.
   - Local development must be reproducible with Docker Compose.
   - Do not introduce a hidden monolith by allowing arbitrary cross-service imports or database-table access.

## Architecture rules

- Frontend: web client; it never talks directly to databases, object storage, vector DB, or model providers.
- API Gateway/BFF is the public application entry point.
- Services own their behavior and persistent data as defined in `docs/service-boundaries.md`.
- Synchronous service calls use explicit APIs; background workflows use the message broker.
- Services may initially share a PostgreSQL cluster for developer simplicity, but each service owns a separate schema/database namespace. No service may query another service's private tables directly.
- Qdrant access belongs to Retrieval/Indexing responsibilities only.
- Raw uploaded files belong in object storage; relational DBs store metadata, not large file blobs.
- Redis is for ephemeral cache/locks/rate-limit/session-like state; do not use it as the source of truth for durable academic artifacts.
- Model-provider calls go through the Model Gateway abstraction so providers/models can change without rewriting domain services.

## API and event contracts

- Prefer contract-first changes for cross-service APIs/events.
- Version externally consumed APIs and events when making breaking changes.
- Use stable IDs (`user_id`, `workspace_id`, `document_id`, `chunk_id`, `plan_id`, `plan_version`, `run_id`).
- Include `request_id` / correlation IDs in inter-service requests and events.
- Make async handlers idempotent; repeated delivery must not create duplicate documents, chunks, artifacts, or runs.
- Never delete or rename a public contract casually. Add a migration/deprecation path.

## Security and privacy

- Never commit secrets, tokens, credentials, or real user data.
- `.env.example` contains placeholders only.
- Passwords must be hashed with an established password hashing library; never implement cryptography manually.
- Validate upload type/size and treat document contents as untrusted data, not instructions.
- Document text must not override system/tool policy.
- Apply least privilege to service credentials.
- Do not log full access tokens, passwords, private document contents, or model-provider secrets.
- Security-sensitive changes require tests for unauthorized and cross-tenant access.

## Reliability rules

- Ingestion and agent jobs must expose durable states such as queued/running/succeeded/failed/cancelled.
- Retry only transient failures; use exponential backoff and a bounded retry count.
- Use idempotency keys for operations that can be retried from the client or broker.
- Database migrations must be forward-safe. Avoid destructive migrations without an explicit migration/rollback plan.
- Add health/readiness checks to every deployable service.

## Coding conventions

- Prefer small, cohesive modules and typed interfaces.
- Python services: type hints for public functions, Pydantic-style validation at boundaries, async I/O where it materially helps.
- TypeScript: strict mode; avoid `any` unless isolated and justified.
- Keep domain logic independent of HTTP/framework glue where practical.
- Prefer explicit names over clever abstractions.
- Do not add a dependency when the standard library or an already-used package solves the problem cleanly.
- Remove dead code created by your change; do not perform unrelated cleanup.

## Testing expectations

For changed behavior, add the narrowest tests that prove it.

Required where applicable:
- unit tests for domain rules,
- API/contract tests for service boundaries,
- integration tests for DB/broker/vector/object-storage interactions,
- authorization tests for protected resources,
- idempotency/retry tests for async jobs,
- E2E tests for critical flows such as auth, upload/index, grounded chat, plan acceptance, citation-to-document navigation.

For RAG changes, do not rely only on example prompts. Preserve or update evaluation cases and report retrieval/generation regressions.

## Product Plan-mode test invariants

Any change touching `/plan` or agent execution must prove at least these invariants:

1. A draft/unaccepted plan cannot execute.
2. Accepted plan version N can execute only version N.
3. Editing/regenerating version N creates a new version and invalidates N's approval for future execution.
4. Replayed Accept requests are idempotent.
5. Unauthorized users cannot accept or execute another user's plan.
6. Execution records retain the accepted plan/version for audit.
7. The plan exposed to the user contains action summaries and expected outputs, not private reasoning traces.

## Codex working rules

- Inspect the relevant code and the minimum applicable docs before editing.
- For a localized one-service change, implement directly and run targeted tests.
- For changes spanning multiple services, auth boundaries, data migrations, public contracts, or the Plan/Agent state machine, create or update an execution plan before implementation as described in `PLANS.md`.
- If the user asks for planning only, do not modify application code.
- Preserve user changes already present in the working tree; do not reset, checkout, or overwrite unrelated work.
- Never use destructive Git commands (`reset --hard`, forced checkout, force push) unless the user explicitly requests them and the consequences are clear.
- Do not claim tests passed unless you ran them and saw the result.
- Before handoff, run the most relevant verification commands and `git diff --check` when Git is available.

## Common commands

```bash
make check          # verify local prerequisites
make env            # create .env from .env.example if missing
make infra-up       # start Postgres/Redis/RabbitMQ/Qdrant/MinIO
make infra-ps       # inspect dependency health
make verify-infra   # validate the development infrastructure
make infra-down     # stop local dependencies
```

Once application services exist, keep `Makefile` targets stable and add service-specific targets behind them rather than replacing the developer entry points.

## Definition of done
A task is complete only when:

- behavior matches the relevant requirement/contract,
- authorization and tenant isolation remain correct,
- tests for changed behavior pass,
- new infrastructure is containerized when deployable,
- docs/contracts are updated when behavior changed,
- no secrets or accidental generated artifacts are included,
- the final summary reports files changed, validation run, and any known limitation.
