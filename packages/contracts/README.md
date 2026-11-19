# Shared transport contracts

The [service boundaries](../../.codex/docs/service-boundaries.md) identify the owner of each API and event. Keep contracts language-neutral. Services can generate local types from schemas without importing another service's implementation or persistence models.

## HTTP

- Publish an OpenAPI contract for each externally consumed versioned API. Introduce business APIs under `/v1` and use a new version for breaking changes.
- Propagate `X-Request-ID` on inter-service HTTP calls and use `request_id` for the same identifier in structured logs and events.
- Use the stable identifier names in the [repository instructions](../../.codex/AGENTS.md), including `user_id`, `workspace_id`, and `document_id`.

Phase 01 uses the [Identity and Workspace OpenAPI contract](../../services/api-gateway/app/openapi-v1.json), served by the gateway at `/openapi.json`. Browser writes carry the configured web origin. Registration acknowledges valid input with HTTP 204, including a replay for an existing email. Login sets `rag_access` and `rag_refresh` as HTTP-only cookies. A successful `POST /v1/auth/refresh` replaces both cookies and keeps the original twelve-hour session deadline. When creating a workspace, send a fresh UUID in `Idempotency-Key`. A replay of the same name returns the original response even after deletion. Reusing the key with a different name returns HTTP 409.

The Workspace service checks the current session at `GET /internal/v1/session` and checks a proposed collaborator at `GET /internal/v1/users/{user_id}`. Both routes belong to Auth, require the Workspace service credential, and stay on the internal network. The session lookup also requires the user session cookie. Identity responses use `USER` or `ADMIN`. Workspace responses use `OWNER`, `EDITOR`, or `VIEWER` to indicate the requesting account's access.

Phase 02 uploads send raw bytes as `application/octet-stream`, a percent-encoded UTF-8 file name in `X-Filename`, and a UUID `Idempotency-Key`. The original and preview routes support single byte ranges and HEAD. Deleting a document or workspace returns HTTP 202 for accepted background cleanup.

## Events

- `document.uploaded.v1` is emitted by Document after durable storage. Ingestion creates one index job per document and an additional preview job for DOCX.
- `document.deletion_requested.v1` is emitted by Document to cancel the document's open Ingestion jobs.
- `workspace.deletion_requested.v1` is emitted by Workspace for Document cleanup and Ingestion cancellation. Document emits `workspace.documents_deleted.v1` after deleting all reserved objects so Workspace can finish deletion.
- Each event includes `workspace_id`, `actor_id`, and the shared envelope fields. Document-scoped events include `document_id`, and uploads include `media_type`. Outboxes retain the same `event_id` on delivery retry. Consumers deduplicate with durable job keys and deletion records.

- Name events for a fact the owning service recorded. Document their producer, schema version, and idempotency semantics next to the schema.
- Include `event_id`, `occurred_at` (UTC RFC 3339), `schema_version`, `request_id`, and actor and tenant context where relevant.
- Use `event_id` to deduplicate repeated delivery and define an operation-specific idempotency key when multiple events can represent a retry of the same operation.

## Operational endpoints

All application skeletons implement these routes. The response matches [health-response.schema.json](health-response.schema.json) and identifies the service by its Compose name.

| Route | HTTP 200 status value | Meaning |
| --- | --- | --- |
| `GET /healthz` | `ok` | The HTTP process is serving requests. |
| `GET /readyz` | `ready` | The service can accept traffic. |

Phase 00 readiness depends on the HTTP process. When a service adds a required dependency, extend its readiness check to return HTTP 503 with `status: unavailable` while the dependency is unavailable. Keep operational routes free of private data and credentials.

Phase 03 reads the viewer's PDF via Document's authenticated internal index-source route. Model Gateway exposes embedding-config and embeddings to the indexer and Retrieval. The configuration supplies the embedding dimension and a non-secret fingerprint. A document generation becomes active only after Retrieval acknowledges all batches. Deletion invalidates the generation and schedules durable Qdrant cleanup.

Phase 04 source search accepts a query and an explicit non-empty list of document IDs at POST /v1/workspaces/{workspace_id}/search. The result lists indexed IDs and matching evidence with document, chunk, page, and optional normalized bounding coordinates. Both dense and BM25 prefetch apply the caller's authorized source and active generation filters.

Phase 05 adds private workspace conversations, plans, approval, and runs. Creating plans, accepting a plan version, and starting runs require UUID idempotency keys. Starting a planned run requires the exact current accepted version. Run events contain authorized snapshots, including citations once an answer passes validation.

Phases 06–09 add capability-specific cited result fields, private document annotations, workspace artifact and reference APIs, and administration. The public gateway checks the configured origin for writes. Artifact publication requires a completed private run from the requesting Owner or Editor. Artifact reads revalidate workspace membership and source availability. The Admin service checks the current role and forwards changes to the owning service.
