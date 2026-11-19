# Execution Plans

Use an execution plan when a change is multi-service, changes a public contract, changes authorization/tenancy, introduces a data migration, or modifies the Plan/Agent state machine.

## Plan format
Create a file under `harness/build/` named `phase-<NN>-<slug>.md` or `change-<YYYYMMDD>-<slug>.md` with:

1. **Goal** — user-visible outcome.
2. **Requirements** — relevant FR/LEARN/RESEARCH/NFR IDs.
3. **Scope** — services/files expected to change.
4. **Non-goals** — explicitly excluded work.
5. **Current behavior** — short verified description.
6. **Proposed design** — API/event/data-flow changes.
7. **Security/tenancy impact** — auth and data-isolation implications.
8. **Migration/rollback** — only if persistence/contracts change.
9. **Implementation steps** — ordered, testable steps.
10. **Verification** — exact unit/integration/E2E/eval commands or checks.
11. **Acceptance criteria** — observable finish conditions.
12. **Open questions** — only blockers or material decisions.

Keep the plan updated when implementation materially diverges. Do not use it as a diary of every command.

## Recommended implementation sequence

### Phase 00 — Repository foundation
Monorepo structure, developer tooling, Docker Compose, CI skeleton, shared contracts conventions.

### Phase 01 — Identity and workspace core
Auth, User/Admin RBAC, workspaces, ownership/ACLs, audit primitives.

### Phase 02 — Document lifecycle
Upload, object storage, metadata, document side-panel API, processing-job states.

### Phase 03 — Ingestion and indexing
Parsing, structure-aware chunking, embeddings, vector/BM25 indexing, idempotency.

### Phase 04 — Grounded retrieval and citations
Hybrid retrieval, reranking, context packing, citation resolution to page/chunk.

### Phase 05 — Interaction modes
Ask mode; Plan mode state machine and approval/version contract; bounded Agent mode.

### Phase 06 — Learn capability
Explain, quiz, flashcards, study guide, mind map, notes/annotations.

### Phase 07 — Research capability
Paper comparison, screening, structured extraction, evidence table, source discovery adapters.

### Phase 08 — Write capability
Drafting, references, citation-aware transformations and export.

### Phase 09 — Admin and operations
User management, job visibility, model/tool configuration, audit/log views.

### Phase 10 — Evaluation, security, reliability
RAG evaluation suite, auth/tenant security tests, retries, backups, tracing, load tests.

### Phase 11 — Production packaging
Production Docker images, Compose deployment, runbooks, restore test, release gates.
