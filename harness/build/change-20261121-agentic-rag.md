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
1B, 2A/B, 3A/B and 4A-D are pending. No claim of full roadmap completion.
