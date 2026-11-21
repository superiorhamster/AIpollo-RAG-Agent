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

## Initial verification before Docker was available

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

## Full-stack follow-up, 2026-11-21

Docker became available and the checks previously blocked above were run. The
working checkout is now `/home/anhpd/Project/Group(personal)/RAG`; the model cache
remains in the original path documented in README. Keep the existing chat provider.

### Failures reproduced and corrected

- Ask execution attempted to mutate the immutable SQLAlchemy `RowMapping` returned
  by the real worker claim query. Remove the unnecessary assignment after persisting
  history. A PostgreSQL-backed regression executes an Ask using that exact mapping
  type and checks success, durable history and source citations; the test fails
  against the original worker and passes with the fix.
- Ollama's metadata-only probe reported ready before CPU weights were loaded. A
  synthetic native embedding probe now warms the model and keeps it loaded before
  Model Gateway starts. The stock image needs no added curl/Python dependency.
- The OpenAI-compatible Ollama default CPU profile exceeded batch deadlines on this
  machine. Add an explicit native embedding protocol with the verified 8192-token,
  four-thread profile, no silent truncation, ordered/validated 768-dimensional
  output and a distinct configuration fingerprint. The default OpenAI-compatible
  adapter remains covered. Add three native-protocol tests.
- Fresh RabbitMQ volumes could acquire a root-owned Erlang cookie from the root
  healthcheck. Run the probe as the broker user and allow 15 seconds for diagnostics
  during CPU-heavy parser startup; measured five-second probes falsely timed out.
  Allow parser/test-stack startup
  time under CPU contention. Correct Docker test/evaluation `PYTHONPATH`, avoid
  recreating the stack for Phase 01 browser tests, retain browser artifacts, and
  wait for explicit login/run results in browser assertions.
- Existing-document re-indexing exposed a parser deadline configuration typo:
  `doc_timeout` was ignored by Docling 2.150.1, leaving `document_timeout=None`.
  One conversion returned only after 225.8 seconds, beyond ingestion's 130-second
  request deadline. Set the intended `document_timeout=110`. Add tests against the
  installed Docling options and rejection of partial conversion results; run them
  in an independent parser container in Phase 03 verification. Large documents can
  still exceed the supported processing limit and must not publish partial indexes.

### Observed verification

- `make bootstrap`, overlay `compose-check`, and final `make verify`: passed.
  Nineteen long-running Compose services, including Ollama, are healthy. FinManager
  was left running and unchanged. Test Compose projects used independent volumes
  and were removed after their suites; the application volumes were retained.
- `make verify-phase01`: JWT claim check 1/1, identity/workspace API tests 7/7,
  browser flows 5/5 (45.4 seconds), including session renewal, permissions and admin.
- `make verify-phase02`: lifecycle API checks 1/1, MinIO outage/retry and deletion
  cancellation/cleanup checks, and PDF/DOCX browser flow 1/1 (1.1 minutes).
- `make verify-phase03`: worker tests 10/10, PostgreSQL retry/Plan/Ask tests 9/9,
  re-index/publication tests 3/3, accepted-Plan API execution, browser flows 7/7
  (1.2 minutes), queued indexing, provenance, tenant filtering and vector cleanup.
- Docker Model Gateway tests: embeddings 12/12 and completion retries 3/3. Parser
  configuration/partial-result tests passed 2/2 against the final image. Together
  with the worker, retry/Plan and re-index suites above, 39 targeted tests passed.
- Qdrant evaluation: dense and hybrid Recall@10=1.0 and MRR=1.0; measured p95
  latency 91.5 ms and 88.4 ms respectively on the synthetic evaluation corpus.
- Overlay `verify-embedding`: two Vietnamese inputs returned 768-dimensional
  vectors. `eval-embedding`: 12 bilingual queries, Recall@3=1.0, MRR=1.0 and
  Top1=1.0, matching the fixture baseline with no regressed metrics; embedding time
  was 5647.4 ms. These small synthetic corpora are regression gates, not a general
  Vietnamese retrieval quality benchmark.
- Overlay `verify-provider`: the configured real chat endpoint returned a grounded
  answer with the expected citation using synthetic inputs.
- A separate Chromium test on the running application used the real embedding and
  chat providers: create account/workspace, upload a generated Vietnamese PDF,
  await successful indexing, search only the selected source, Ask and follow-up in
  one conversation, then click a citation and assert the correct PDF page rendered.
  Passed in 31.6 seconds and passed again against the final parser image in 2.6
  minutes, including broker recovery after recreation/reprovisioning. Service-user
  AMQP authentication was also verified directly. Its search request uses a
  45-second test deadline; the
  initial 8-second test request timeout was corrected without changing production
  deadlines. The synthetic workspace was deleted and test sessions revoked.
- Web TypeScript check, production Next build, shell syntax checks, migration
  preservation test and `git diff --check`: passed. No dependencies were added.

### Existing-data migration and handoff

Re-index dry run selected eight eligible index jobs across five workspaces. Applied
the migration through the ingestion-owned CLI, retaining old published indexes.
Six succeeded using the current local-model fingerprint. The other two initially
exhausted dependency retries with the old parser; after retrying only those two
against the corrected parser, both ended in explicit `parse_failed` responses.
Measured parse times were 115.1 and 111.6 seconds with HTTP 422, confirming the
processing deadline is enforced. No index jobs remain queued or running. Those
two sources are retained for preview but have not migrated to searchable vectors
for the new model; existing-data migration is therefore **6/8 complete**. Supporting
these slower documents needs separate parser performance/processing-budget work.

The final bootstrap and host web/API readiness checks passed after all runtime
fixes. Reviewed the intended staged diff with `git diff --cached` and
`git diff --cached --check`; `.env`, model weights, generated browser artifacts and
raw logs are excluded. Persisted only the model-cache path in the private `.env`
so the documented overlay commands work without a shell-only override.

Local runtime/evaluation logs are in `/tmp/aipollo-full-*.log`; browser artifacts are
under ignored `test-results/`. The passing Phase 01 and Phase 03 artifact folders
end in `417116-31369` and `481914-24530`; the real-provider browser result is
`test-results/live-embedding-final/.last-run.json`. A copy of the synthetic test is
saved beside that result as `verification.spec.ts`. Raw failure logs/traces can
contain disposable test credentials and must not be committed or shared unredacted.
The temporary PostgreSQL regression server was stopped. Keep the application stack
running. No remote push or merge was performed.
