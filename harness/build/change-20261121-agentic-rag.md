# Agentic RAG implementation

## Goal and requirements
Implement the approved staged roadmap for LEARN, RESEARCH and WRITE while preserving tenant authorization, exact plan acceptance and cited evidence. Execute the PR sequence 1A, 1B, 1C, 2A, 2B, 3A, 3B, 4A-D.

## Current behavior
Plan revisions store only the objective. Returned steps are constructed on read and execution always runs retrieve/compose. Run leases are durable but completed steps are not persisted. Crossref, artifacts and citation navigation already exist.

## Design
Persist immutable versioned workflow definitions and lease-fenced step results in the orchestration schema. Validate task/capability/source subsets. Preserve legacy two-step plans. Use durable draft jobs for curriculum generation, private conversations for tutoring, bounded LangGraph workflows for multi-paper research, private FSRS reviews and cited SVG graphs. Providers remain behind Model Gateway. All deployables stay in Compose.

## Security and compatibility
Acceptance authorizes the exact stored workflow. New versions invalidate approval for future runs. Resume reads the run's accepted version. All APIs retain workspace/user scoping and validate source IDs before retrieval. Never persist reasoning or log source text. Additive forward migrations retain legacy data. Use opt-in feature flags for new workflows.

## Steps and acceptance
1A: immutable workflow persistence, ordered execution, lease-fenced restart recovery, progress API/UI and exact-version authorization tests.
1B/C: asynchronous source-grounded curriculum generation and private multi-turn Socratic tutoring.
2A/B: per-paper retrieval, bounded gap filling, support verification and paired baseline evaluation.
3A/B: personal review scheduling and cited interactive concept maps.
4A-D: approved discovery, verified writing, mock defense and formula extraction evaluation gate.

## Verification
Run changed domain/API/DB/tenant/replay/restart tests, existing Plan protocol and history/retry suites, TypeScript/build, Phase 01-03/UI and real-model RAG evaluation for generation changes. Run one full test stack at a time and git diff --check. Check new dependencies with repository scans. Preserve main volumes and report measured results.

## Rollback
Disable new workflows while retaining schema and stored approved definitions. Keep completed step outputs, never silently reinterpret a stored workflow.

## Progress
1A implemented: versioned definitions, lease-fenced step results, source checks at resume/publication, cumulative reserved cost and manual activity editor/progress API.
1C implemented: structured Socratic questions, explicit hint/solution actions and private history. Feature flags default off.
Verification observed: 13 history/tutor tests, 12 PostgreSQL retry/privacy/feature tests, 5 workflow acceptance/cancellation/recovery/deadline tests, 3 completion adapter tests, TypeScript, Python compilation, shell syntax and diff checks passed.
Full isolated Phase 03 passed, including seven browser flows, ingestion/provenance/access/cleanup and dense/hybrid evaluation. Final UI suite passed all nine cases, including manual activity revision and hint/solution actions.
The first full-stack attempt exceeded the old 110-second test wait under concurrent-stack load. Test waits now derive from runtime budgets. Subsequent full-stack suites run with main stopped, preserving volumes and restoring main via an exit trap.
Real provider verification initially failed before domain execution: the provider returned a non-JSON response when stream was omitted. Direct synthetic probes returned an error without stream and JSON HTTP 200 with stream=false. Gateway now explicitly requests non-streaming completions. The rerun of real-model PDF/Ask/tutor/approved-workflow E2E is in progress.
Feature flags default off in Compose. Main stack bootstrap was verified after forward migrations. Final health and provider results remain to be recorded.
1B implementation in progress: durable curriculum draft jobs own their lease, fixed wall-clock deadline, cost reservations and transient retry count. A separate Orchestrator task retrieves read-only evidence and publishes a validated 1–6-step schedule only to its still-current, uncancelled, unaccepted revision. Acceptance is blocked until publication. Days describe the student's schedule; execution produces all materials immediately after acceptance/start. Browser polling and scoped session restoration preserve the draft across reloads. New feature flag defaults off. No dependency added.
2A/B, 3A/B and 4A-D are pending. No claim of full roadmap completion.

## PR 2A/B execution design
Add LangGraph only to Orchestrator, pinned with its lockfile. Route opt-in AGENT/approved PLAN research comparison/evidence-table/synthesis with 2–5 sources through explicit decompose → per-paper retrieve → grade matrix → at most two gap searches → synthesize → verify nodes. ASK stays on its existing path. Persist lease-fenced graph state in the run's owned schema after each node and reserve each model call before invocation. The source/version acceptance snapshot remains authoritative; budget/deadline/cancellation checks run before every tool. Matrix cells are keyed by document and criterion and record evidence-supported, contradicted or insufficient findings. Preserve both sides of contradictory reports and don't compare incompatible units. Synthesis is verified against actual supplied chunks; one bounded rewrite may remove or qualify unsupported claims. Feature flags default off until the paired synthetic/real-provider evaluation passes. No LangSmith upload/tracing or external providers are introduced.

## Verified after remote dev integration (2026-11-22)
Merged origin/dev 114fb85 into dev-DuyAnh at 25e7d21. Preserved adaptive sentence citations, retry mode snapshots and Socratic/workflow behavior. PR 1B now implements durable curriculum generation, citation/day metadata, reload restoration and the ready-before-acceptance gate. The initial Compose run exposed missing UPDATE(workflow) privileges; migration 005 grants only that column. Restricted-runtime tests subsequently passed: 7 curriculum, 7 research, 18 history, 5 workflow, 14 retry. Production builds passed. All 11 synthetic browser cases passed, including curriculum reload and matrix source navigation. Phase 01/02 and the earlier 10-case Compose UI suite passed. Full Phase 03 and live-model reruns after the grant/research changes remain required.

PR 2A/B implementation: pinned LangGraph 1.2.24, source-balanced per-paper context, durable node snapshots, run-wide search/model/token/cost/deadline limits, bounded gap filling, cited evidence matrix and semantic synthesis verification with one repair. Workflow defaults off. Paired fixture executed both baseline Ask and graph against the same scoped data: coverage 1/4 → 3/4 cells; fixture latency p50 0.239s/p95 0.322s, max 8 model calls / 4 searches across seven fixture runs. These measurements use mock providers, not local model quality/latency. pip-audit of the locked Orchestrator requirements found no known vulnerabilities. The real-model evaluation gate has not passed; keep the flag off. Stages 3A/B and 4A-D remain pending.

Latest observed validation: merged curriculum/research code passed full Compose Phase 03 (all seven browser flows plus parser, indexing, source scope, history, retry and both new workflow DB suites), Compose UI (11 cases), and bootstrap/make verify. Phase 01/02 had already passed. Real-model embedding/provider smoke passed; real Ask failed because all 2048 output tokens were consumed by reasoning. Optional reasoning effort was added and tested (4 adapter cases). Low effort passed small probes but still exhausted the real Ask budget; a further full-contract synthetic probe with none returned text using 252 tokens and zero reasoning tokens. A full-model rerun with that diagnosed setting is still required.
