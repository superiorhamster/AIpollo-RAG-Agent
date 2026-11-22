# Sentence citation MVP progress

Baseline dev 826d786. Approved design: docs/proposals/sentence-level-citation-implementation-plan.md. No commit or push.

- Phase 1 parser: implement offset-preserving segmentation and verify against golden legacy chunks.
- Phase 2 index: enrich existing points under generation fencing; verify delegated scope and legacy reads.
- Phase 3 Ask: validate both adaptive paths, target fallback, budgets and history.
- Phase 4 UI: verify multiple highlights and reload, then attempt real-model E2E.

Reviewed the design, previous fixture results, worker/gateway budgets, and current index/reader contracts. No new checks run yet.

First implementation across all four phases:
- Parser: tracks normalized passage offsets, uses PDFium unique matching with quote folding and line/coarse/page fallback.
- Index: enriched revision hashes metadata before deriving and storing IDs; Retrieval confirms UUID and offsets after scope checks.
- Ask: legacy/single/two/auto modes, scoped attribution with one call and per-target fallback; result snapshots carry resolved citation fields.
- Web: multiple boxes and stable citation keys. Tests/build/live verification pending.

Verification setup:
- Mocked worker cases cover forced single/two, auto overhead branching, cross-parent ID rejection with a successful sibling, malformed attribution fallback, unchanged answer and serialized rectangles.
- Added parser split and page-fallback checks, plus an opt-in history assertion in the existing real-provider Playwright flow.
- Build started in the existing super-agentic-rag-dev project with INDEX_SENTENCE_CITATIONS=true and ASK_SENTENCE_CITATIONS=auto. Parser image is fetching bundled Docling weights. No results counted yet.

Real-provider prompt probe v1 (synthetic only, through Model Gateway):
- 3 HTTP 200 calls. Mixed single-pass inference passed (13:30, both correct IDs).
- Unsupported adversarial objective failed: model echoed the injected UUID. Worker membership would reject that ID. Strengthened prompt and added negative few-shot.
- Batched attribution under-selected the schedule premise, while selecting the rule and abstaining on the unknown room. Clarified that a parent can supply one necessary premise of a claim.
- Gateway timings 2.45 / 0.79 / 1.01 seconds, input tokens 1335 / 1289 / 1050, output tokens 80 / 61 / 65. Rerun pending.

Prompt v2: mixed and attribution passed. Unsupported adversarial ID was no longer accepted, but the model wrote a cited absence claim with an unrelated schedule ID, so the expected empty claims contract still failed. Added explicit prohibition on citation-bearing abstention (v3). v2 timings 1.41 / 0.75 / 1.12 s, inputs 1452 / 1406 / 1124, outputs 80 / 38 / 76.

- Affected services rebuilt healthy, including the production Next build. Normal Docker configuration worked.
- First focused run: parser 3/3, lifecycle 4/4, reindex 6/6, embedding 12/12, completion 3/3. History 8/14 under live auto env (legacy request mock expected no opt-in); Retry API 9/10 (legacy snapshot expectation lacked explicit null). Protocol was invoked by stdin and failed because its relative fixture paths need a mounted file.
- Fixed the fixture setup/expectation and reran history 14/14 and Retry API 10/10. Rebuilt Orchestrator with revised prompts.
- Prompt v3 passed 3/3 through the configured live model (mixed 13:30, adversarial unsupported empty, attribution picks both premises and abstains on unknown room). Calls 2.72 / 2.00 / 1.97 s, inputs 1499 / 1453 / 1124, outputs 80 / 4 / 76.
- Browser real-model scenario started using an in-runner loopback proxy for configured origin :23000. Result pending.

- First live browser run indexed the PDF and answered both questions, but failed the precision assertion. Direct parser probe on the previous long fixture showed two chunks with zero enriched. Verified that `converter.convert()` closes the BytesIO, causing the later PDFium construction to fall back. Captured immutable bytes before handing the stream to Docling. Parser rebuild and browser rerun pending.

- Extended reindex tests: one run exposed a missing test import, corrected, then 7/7. Artifact snapshot/export scenario passed. Plan protocol needed a mounted fixture path and fixture-only token; rerun passed. Retrieval map scope/fallback 1/1. Worker suite 15/15 after adding deadline/cancellation.
- Parser rebuild exposed a second runtime mismatch: this PDFium version's page and text-layer handles require explicit close instead of a context manager. Replaced those uses with contextlib.closing. Validation pending.

- Direct parser fixture with fixed code: 2/2 chunks enriched, nine line-precision anchors (one sentence split by the unchanged chunk boundary). Parser unit tests 4/4, using the rebuilt image plus a temporary read-only mount of the corrected PDFium module.
- Second real browser run started. Final parser image build started separately to remove the temporary source mount.

- After parser fixes, the browser rerun passed real upload/index/search, both Ask answers, resolved segment/region presence and history API and UI reopen. The final overlay assertion failed. It clicked the last generic citation pill rather than the verified precise citation and queried the mark by accessible name, so that run did not isolate the viewer behavior. Updated the test to click the precise anchor by its resolved identity and assert its exact DOM overlay count. Final rerun pending.

## Reproduction notes

Run from the repository root in WSL. The dev Compose command was
`docker compose -p super-agentic-rag-dev --env-file .env -f compose.dev.yaml`.
With `INDEX_SENTENCE_CITATIONS=true ASK_SENTENCE_CITATIONS=auto`, built/recreated
document-parser, ingestion-service, retrieval-service, agent-orchestrator,
model-gateway, api-gateway and web via `up -d --build --no-deps --wait`.
Each Python test except the protocol fixture was fed to
`compose exec -T <owning-service> /app/.venv/bin/python - < tests/...`.
The Plan protocol used `compose run --rm --no-deps -T` with read-only test and
Model Gateway source mounts at /suite and explicit fixture mode. The live
prompt checks used `tests/phase05/citation_provider.py` through Model Gateway.

Browser tests mounted `tests/phase05/local_rag.spec.ts` as /tests/workspace.spec.ts
in the existing phase01-browser-tests runner, set EXPECT_SENTENCE_CITATIONS=1,
and relayed local :23000 to web :3000 in the runner's shared network namespace
to preserve the configured request origin. Each run created its own synthetic
account/workspace/PDF and cleaned up its synthetic workspace.

- Auto browser E2E passed (52.5 s total) using a fresh synthetic Vietnamese PDF, real query embeddings and chat. It verified successful index, one scoped evidence item, both answers, a persisted segment citation, reopening conversation history in Chromium, and one exact overlay on page 1. Follow-up run ee8eab79-9db6-452e-9fe0-72382728f330. Updated worker suite 16/16.

- Three-page synthetic parser audit: 15/15 canonical chunks identical with/without enrichment; 14 had maps. Line rectangles were observed for 38, 34 and 11 segment fragments on pages 1/2/3. Counts include headings/fragments and are not comparable to the earlier prose-only spike's sentence counts.
- Forced-two browser E2E passed (53.6 s total): fresh narrower Vietnamese PDF, real indexing/search, initial and follow-up answers, stored segments after history reopen and **two** PDF line overlays on page 1. Follow-up run 1e2c8736-d772-48d7-ac2f-25650f0d7f1f. The runner then restored Orchestrator to auto.
- Wide-corpus threshold/semantic accuracy, rotation/scans/table cells, real cost accounting and exact retrieval tie parity across existing-generation backfill remain outside these verified fixtures. No bulk reindex, user-facing toggle, production rollout, commit or push.

## Phase status at handoff

| Phase | Status and evidence |
| --- | --- |
| 1. Parser and geometry | Verified on synthetic one- and three-page PDFs; canonical chunk parity and PDFium failure fallback covered. Final image parser 4/4 and lifecycle 4/4. |
| 2. Index and retrieval | Verified with 7 reindex/index-generation tests, 1 retrieval-scope test and real scoped search in both live browser runs. |
| 3. Adaptive Ask and history | Worker 16/16 and Retry API 10/10, separate Plan protocol and artifact snapshot scenarios passed. Prompt v3 3/3 real synthetic calls. Real auto and forced-two runs persisted resolved citations. |
| 4. Viewer and end-to-end | Production web build passed. Both Chromium scenarios passed with history reopening and exact overlays, including two boxes for the forced-two case. |

The focused Python unittest total is 57 passing tests (including 12 embedding
and 3 completion adapter tests). Standalone Plan and artifact suites and live
checks are reported separately. This was focused verification rather than a run
of every repository test.

The final parser image was deployed with no temporary bind mounts, and its
conversion and geometry file SHA-256s matched the workspace. The browser checks
used the identical corrected geometry source mounted read-only while the final
image was building. All 18 long-running dev services were healthy and web
readiness returned HTTP 200. Dev runtime is in auto with parser enrichment on;
the checked-in defaults remain legacy/off and the existing .env was not edited.

## Citation Mode switch follow-up

The browser defaults to Segment and stores its selection in localStorage. New
Ask requests send a validated optional mode. Explicit Segment uses adaptive
Ask; Chunk suppresses segment retrieval and attribution. Omitted mode retains
the previous server setting and request hash. Retry inherits the failed run's
mode. The mode lives in the existing run input JSONB; no migration or reindex.

Rebuilt Web, Orchestrator and API Gateway. Worker 17/17, Retry API 11/11 and
the artifact suite passed. Live Chromium mode-switch scenario passed (51.1 s):
first turn Segment, follow-up Chunk on the same source, job snapshot unchanged,
Chunk restored after reload and Library/Chats navigation, both run snapshots
unchanged, and both saved PDF anchors rendered in the reader. The scenario used
a fresh synthetic PDF and the configured real model.

## PR verification

Reran the focused suites against the running development stack: parser 4,
parser lifecycle 4, generation/reindex 7, scoped segment retrieval 1, Ask
worker 17, Retry API 11, embedding adapter 12 and completion adapter 3
(all 59 tests passed). The separate artifact snapshot/export scenario passed.
The three synthetic provider probes passed again (2.80, 2.15 and 2.04 seconds).
Chromium passed the Segment-to-Chunk switch, history reopen, both PDF anchors,
and unchanged jobs on a fresh synthetic PDF in 46.2 seconds total. These are
focused checks, not a new run of every repository suite.

The maintained setup and architecture guide is
[Sentence-level citations in Ask](../../docs/ask-pipeline/sentence-citations.md).
