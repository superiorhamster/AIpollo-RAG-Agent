# Pipeline and UI reliability

## Goal and requirements
Resolve the verified PDF processing, model output, and UI findings for FR-01,
FR-03, FR-04, FR-05, FR-10 and the existing Plan approval/tenancy invariants.
Implement the accepted conversation plan; OCR is explicitly deferred.

## Scope and non-goals
Parser/ingestion, gateway/retrieval/orchestration, Compose configuration, web UI,
contracts and regression suites. Keep local EmbeddingGemma, chat configuration,
2 CPU parser quota, origin protection, rate limits and explicit admin promotion.
Do not add OCR, change provider credentials, delete source documents, or weaken
citation validation. Preserve the existing uncommitted embedding timeout change.

## Verified starting behavior
Parser conversion runs in a non-cancellable thread with a 110s limit; ingestion
waits 130s and has a 330s job/360s lease. Gateway source has a user edit changing
its shared HTTP client from 25s to 60s, but embedding callers still wait 30s.
Prompt examples use non-UUID IDs; invalid generation becomes a generic error.
The UI lacks several requested controls and hides polling failures. Docker was
initially inactive and became available during implementation.

## Design and security
Central shared runtime budgets derive outer deadlines from inner ones. Parse
conversion moves into a bounded subprocess with cleanup on disconnect/shutdown;
ingestion owns queuing. Keep atomic publication and service-owned data boundaries.
Use one passage per CPU embedding request in the Ollama overlay. Validate generated
JSON and current citation membership, with one budgeted regeneration, then an
explicit retryable Ask error. Preserve immutable retry history and Plan acceptance.
UI separates preview/index readiness, handles Retry-After and adds responsive PDF,
artifact/auth/language controls without changing backend password/role policy.

## Compatibility, migration and rollback
No destructive schema migration. Additive error codes are documented in OpenAPI.
Operational timeouts/batch size do not change embedding identity. Rebuild/recreate
containers after config changes. Reindex only failed/obsolete eligible jobs after
dry run; retain published generations until replacement succeeds. Roll back images
and settings while retaining database columns and source/index data.

## Implementation order
1. Runtime budgets and parser lifecycle; ingestion retries and embedding batches.
2. Scoped search deadlines, generation validation/repair, retry contract and logs.
3. UI readiness/polling, PDF/mobile controls, auth and shared language preference.
4. Targeted regressions, full Compose suites, real model/PDF evaluation and reindex.

## Verification and acceptance
Run parser lifecycle/budget, gateway embeddings/completion, worker/retry/Plan,
reindex/publication and security tests; TypeScript and production web build.
Run make bootstrap, verify, verify-phase01/02/03, verify-local-rag (including
verify-embedding, verify-provider and eval-embedding), verify-ui and
git diff --check. Attempt recovery of existing failed PDFs with preserved provenance and
real-provider PDF -> search -> Ask/follow-up -> citation navigation. Report any
blocked checks rather than counting them as passed. Reject partial indexes,
fabricated citations, implicit admin access and silent processing failures.

## Implemented behavior

| Finding | Resolution |
| --- | --- |
| Parser deadline and uninterruptible conversion | Configurable inner/outer budgets, isolated subprocess, disconnect/timeout/shutdown cleanup, explicit timeout and busy errors; reject partial output. |
| CPU embedding and caller timeouts | Separate chat/embedding deadlines, derived search and indexing deadlines, singleton Ollama passage batches; model identity preserved. |
| Invalid JSON, UUID or provenance | Correct example UUIDs, strict JSON envelope, validate every current citation, one cost/time-bounded regeneration; explicit retryable Ask error with immutable history. |
| Polling failures and misleading readiness | At most four concurrent document polls, bounded backoff and visible failure; distinct preview/index state and indexed-source selection. |
| PDF and mobile controls | Page jump, keyboard-accessible horizontal scrolling, clear citation highlight; separate chat scroll area and bounded composer. |
| Artifact/auth/language UX | Open the exact saved artifact, public sign-in link, password confirmation/live requirements, registration success, Retry-After countdown and shared EN/VI preference. |
| Origin, admin and throttling reports | Preserve CSRF protection, explicit CLI admin promotion and rate limiting. Isolated tests use matching origins and independent accounts. |
| RabbitMQ startup warnings | Existing dependency chain already waits for document infrastructure initialization through document/workspace services; verified during fresh Compose startup. |
| Scanned PDFs | OCR remains deferred by the user; `no_text` remains explicit and preview remains available. |

## Verification results

- Worker/history/context-packing/repair/privacy/cost: 12 tests passed.
- PostgreSQL retry authorization, immutable snapshots, Plan/version invariants and
  read-only worker mappings: 10 tests passed.
- PostgreSQL reindex/publication, CPU batches, bounded parser errors and graceful
  lease release: 6 tests passed.
- Plan protocol: revision gates, idempotent acceptance/start, cross-user denial,
  retained accepted version, SSE and cancellation passed on a fresh UTF-8 database.
- Model Gateway adapter tests in Docker: 12 embedding and 3 completion tests passed.
- Parser tests in Docker: 2 configuration/partial-result and 4 real subprocess
  lifecycle/budget tests passed.
- Phase 01 full isolated Compose suite passed: JWT, 7 API and 5 browser tests.
- Phase 02 full isolated Compose suite passed: lifecycle/access/idempotency,
  MinIO outage/recovery, cascade cleanup and PDF browser workflow.
- Phase 03 full isolated Compose suite passed: parser/worker/retry/reindex tests,
  7 citation/Plan/mobile/keyboard/artifact browser cases, PDF/DOCX provenance,
  scoped search, vector cleanup and live Qdrant retrieval evaluation.
- Production Next build, TypeScript and Python compilation passed.
- Final isolated UI Compose suite: all 7 browser cases passed, including recovery
  from polling failure and the final PDF page-summary compatibility change.
- Real-provider Compose suite passed: two Vietnamese embedding inputs (768
  dimensions, unchanged fingerprint), citation-bearing chat adapter check, and
  Vietnamese PDF indexing -> scoped search -> grounded Ask -> follow-up in the
  same conversation -> navigation to the cited PDF page.
- Real local-model evaluation: all 12 versioned synthetic bilingual queries had
  Recall@3=1.0, MRR=1.0 and Top-1=1.0, with no regression against the fixture
  baseline. This small corpus is a regression check, not a production-quality
  benchmark. Qdrant fixture dense/hybrid evaluation also retained Recall@10 and
  MRR=1.0.
- Final main-stack `make COMPOSE_FILES="compose.dev.yaml compose.ollama.yaml"
  WAIT_TIMEOUT=300 bootstrap` passed, including prerequisite, infrastructure and
  application checks. All 19 long-running containers are healthy; FinManager was
  left running and untouched. Temporary test projects were removed and the
  host-only PostgreSQL test server was stopped.

## Operational recovery and remaining verification

The main stack's volumes were retained while isolated full-stack suites ran. Running
two complete stacks at once on this host caused false browser/provider timeouts;
the isolated Phase 01 rerun passed. The new live E2E also explicitly checks the
successful login response and allows 20 seconds for navigation instead of a flaky
5-second assertion. The main stack is restored and verified.
The private local configuration uses a 600-second parse budget with the same 2 CPU
quota. A previously failing heavy PDF completed parsing in 389 seconds, beyond the
300-second default. Nine eligible index jobs were requeued. At handoff, the first
recovery job has succeeded, one is running and seven are queued. Its parser call
returned 200 in 176.9 seconds; 34 observed embedding calls all returned 200, with
maximum latency 13.9 seconds. There are now 12 succeeded published indexes. The
remaining eight recovery jobs continue in the running stack; this is not a claim
that the background queue has finished. All four active copies
of the reported existing PDF can be previewed; one already has a current-model
published index. Its scoped search returned six passages across pages 1-6, all
with matching document IDs, valid chunk UUIDs and normalized page regions.
Published generations are retained throughout recovery.

One of the two named PDFs from the supplied reports is absent from the current
document database and local Downloads, so its exact reproduction cannot be claimed.
No product decisions remain; OCR is deferred. Do not claim a remote push: the
available GitHub integration lacks repository write access and Git authentication
has not succeeded.
