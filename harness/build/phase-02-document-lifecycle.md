# Phase 02 — Document lifecycle

## Goal and requirements
FR-03 document upload, organization and page preview, plus durable job states for FR-04.

## Scope and current state
Workspaces have ACLs and JWT authentication. Document and Ingestion are skeletons. Add PDF and DOCX upload (25 MiB), original download, rename, page preview, and asynchronous deletion. Owner and Editor manage documents; Viewer reads and downloads. Workspace deletion remains owner-only.

## Design decisions
Stream authenticated uploads and byte ranges through the public gateway to keep the MinIO bucket private. Document owns PostgreSQL metadata and deterministic object reservations. Ingestion owns jobs, runs DOCX preview conversion through a dedicated internal LibreOffice container, and leaves index jobs queued for Phase 03. Workspace coordinates cascade deletion through its own outbox and removes memberships after Document confirms cleanup. A workspace tombstone serializes cleanup with writes. Broker messages are persistent and confirmed, with deduplicated consumers.

## Security and tenancy
Use Workspace ACL checks for every document operation and scoped service credentials for internal routes. Validate MIME structure and size, isolate untrusted conversion, use private no-store responses and keep original downloads access-controlled. Store object bytes only in MinIO.

## Migration and rollback
Add workspace_002 plus owned document and ingestion schemas. Apply on an existing Phase 01 volume without resetting it. Keep the schemas and bucket for rollback. Drain pending deletions before downgrading Workspace; Phase 01 cannot enforce Phase 02 cleanup.

## Non-goals
Phase 03 owns parsing, indexing and embeddings. Phase 04 owns citation generation. Later phases implement annotations and admin UIs.

## Implementation and verification
1. Add deployable services, credentials, migrations and contracts.
2. Implement document lifecycle, asynchronous workers and viewer.
3. Run make check, make compose-check, make bootstrap, make verify-phase01, make verify-phase02, image checks configured in CI, and git diff --check where Git metadata exists.

## Acceptance
PDF and DOCX workflows work in the browser. Cross-tenant requests fail closed. Duplicate delivery and upload retry are idempotent. Workspace deletion hides content immediately and cleans storage, including under transient failures.

## Open questions
None.
