# PR 2 corrections and local EmbeddingGemma

## Goal and requirements
Preserve an Ask turn's context across retries, reserve prompt space for fresh evidence,
and run `embeddinggemma-2:270m-q8_0-text` in Compose. This supports grounded answers,
source provenance, tenant isolation, bounded runs, and reproducible containers from
the repository's requirements baseline. No later-phase product features are added.

## Scope and non-goals
Change orchestration, the web Retry request, gateway contracts/tests, Model Gateway,
the development Compose overlay, and an ingestion-owned re-index command. Keep the
configured chat model. Do not push, merge, delete old collections, or commit model
weights, runtime directories, credentials, or local environment files.

## Current behavior
PR 2 starts a fresh run when retrying and reloads history relative to its new creation
time. History is packed before evidence. The completion retry suite incorrectly
inspects the final log record and is not run by CI. Existing embedding configuration
uses 1536 dimensions. The downloaded Ollama model produces 768-dimensional vectors
through `/v1/embeddings`; its local runtime is Ollama 0.40.16.

## Proposed design and security
- Add optional `retry_of_run_id` to StartRun and RunView. Validate the original run
  with the existing workspace/user scope and permit only retryable failed Ask runs.
  Derive objective/conversation server-side and reject conflicting inputs with 409.
- Persist private bounded history snapshots, including empty lists, before model
  calls. Retries copy the original snapshot. Legacy runs build a snapshot using the
  original creation cutoff. Snapshots are never returned in API responses.
- Pack ranked evidence before history and calculate byte/cost limits on the final
  prompt. Keep authorization checks on retrieval and on every run execution.
- Add a Compose overlay with pinned Ollama 0.40.16, a read-only existing model cache,
  a model healthcheck, CPU inference, and no published ports. Permit local HTTP to
  the exact `ollama` hostname for embeddings only. Chat configuration is unchanged.
- Use 768 dimensions and a revision tied to model digest c21dd30c1e38444d3b4faa091407b6fa97221447b4965d74931d43d7f09bbbfd.
- Re-index through an ingestion CLI, defaulting to dry run. Requeue eligible terminal
  index jobs with a different fingerprint or failed state; skip running, cancelled,
  deleted, already queued, and already current successful jobs. Retain published
  generations until the worker successfully publishes a replacement.

## Migration and rollback
Add nullable retry-parent and JSONB snapshot columns in orchestration_002. Preserve
existing records and the old model's Qdrant collections. Rollback builds must retain
the orchestration_002 readiness check without dropping audit columns. To roll back embeddings restore the previous model
configuration and re-run the same re-index command. Searches may temporarily lack
sources while indexes for the configured fingerprint are being rebuilt.

## Implementation steps
1. Add migration, retry validation, immutable snapshots, and evidence-first packing.
2. Update web requests and the checked-in OpenAPI contract.
3. Add pinned Ollama overlay, Compose-aware Make targets, and re-index CLI.
4. Add retry/packing, authorization/idempotency, embedding, re-index and browser
   regressions. Fix completion logging assertions and execute the suite in CI.
5. Update usage/rollback documentation, verify, review staged changes and create one
   local Conventional Commit on dev-Duy.

## Verification and acceptance
Run worker and gateway suites, DB-backed retry/re-index checks, Compose config
validation, web typecheck/build, `make verify`, `make verify-phase01`,
`make verify-phase02`, `make verify-phase03`, live container-to-Ollama embedding and
Vietnamese PDF retrieval/citation checks, evaluation, and `git diff --check`.
Accept only context-stable retries, no cross-tenant retries, evidence retained under
4096 bytes, 768-dimensional vectors, idempotent re-indexing, and no tracked secrets.
Record actual test results and environmental blockers below; never count skipped
Compose checks as passed.

## Open questions
None. The user selected Ollama in Compose and authorized one local commit.

## Verification results

Implementation is complete for review; deployment and full-stack verification remain
pending because Docker is unavailable in this execution environment. The requested
local commit records that limitation rather than treating these checks as passed.

- Locked dependencies in an isolated Python 3.14.7 environment: worker/prompt tests
  10/10, gateway embedding tests 9/9, completion retry tests 3/3.
- PostgreSQL 16 test databases, Unix socket only: retry/API/Plan invariants 8/8 and
  re-index/publication tests 3/3. These cover concurrency, old request hashes,
  cross-user/workspace parents, empty/legacy snapshots, version approval and deleted
  sources. API tests override actor resolution; full auth/membership remains a
  separate Compose gate. No application database or source documents were modified.
- Applied orchestration_001, inserted a synthetic existing run, upgraded to
  orchestration_002 and asserted the row/hash/input survived with nullable new fields.
- `make compose-check` and the Ollama overlay equivalent passed. Rendered topology
  assertions verified image digest, read-only existing cache, no published Ollama
  ports, 768 dimensions, health dependency and preserved chat settings.
- `apps/web/node_modules/.bin/tsc --noEmit --project apps/web/tsconfig.json` passed.
  Production Next build passed outside the sandbox with the existing frozen lockfile.
- A temporary loopback Model Gateway called the existing host Ollama using synthetic
  corpus-v1 inputs. Twelve bilingual queries returned 768-dimensional embeddings;
  Recall@3, MRR and Top1 were 1.0, matching the fixture baseline, with about 720 ms
  total embedding time. This is local cosine evaluation, not a Qdrant or PDF E2E test.
- Shell syntax checks and `git diff --check` passed. No dependency/lockfile changes.
- Attempted `make verify`, `make verify-app`, `make verify-phase01`,
  `make verify-phase02` and `make verify-phase03`, also outside the sandbox. All
  stopped because `/var/run/docker.sock` is absent. Docker is inactive, and sudo
  cannot start it because the environment sets `no new privileges`.
- Consequently Ollama container startup, browser regressions, full Qdrant hybrid
  evaluation, real PDF/citation E2E and existing-data re-indexing have not run. They
  must pass with Docker available before deployment/merge. The CLI's default now
  previews only; operations documentation was updated to require `--apply`.
