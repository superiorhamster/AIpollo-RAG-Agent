# Ask and Learning Plan redesign

## Goal and requirements

Preserve Ordinary Ask capabilities (F01) and introduce private Learning Plans (F02). Follow A01–A12, T01–T10, V2-01–V2-06, FA01–FA04 and the owner-approved manual management requirements.

## Scope and existing behavior

Change the orchestrator, Gateway relay, workspace UI, additive orchestration migrations and regression tests. Active legacy PLAN currently has separate APIs, a curriculum worker and a Plan-bound Run path. Ordinary Ask and AGENT also use the Run queue and citation snapshots. Keep historical data, independent capabilities and existing retrieval contracts. Live cutover and release are separate operations.

## Design and ordered delivery

1. Capture baseline and validate the isolated test configuration.
2. Fence legacy API and worker execution, including queued and expired rows. Retain old schemas and artifact projections.
3. Add owner/workspace scoped Learning Plans, canonical blueprint admission, events, cards, selection revisions and typed mutation operations. Use transactions with revision and lease checks. Check current membership and ownership, including publication and replay.
4. Pin Run inputs for Retry and integrate optional source state, static prompts and validated grounding. Use the original query for answers. Keep citations and current Plan content intact.
5. Add Workspace management and chat interactions. Exercise browser workflows and compare Ordinary Ask with baseline.
6. Audit integrated gates, record limitations and prepare owner UAT.

## Migration and recovery

Apply additive migrations only to the isolated QA database. Disable the Learning Plan feature for local rollback and retain additive data and the legacy execution fence. Before changing images, inspect queued requests and schema compatibility. Preserve production and review volumes.

## Verification and acceptance

Use tests/phase05/history_ask.py and retry_api.py for deterministic Ask baseline. Add migration, direct ACL and transaction tests, Playwright journeys and targeted guarded live testing. Check four independent Source/Plan states, manual CRUD and progress with zero provider calls, stale cards, durable selection, saved citations, actual Chunk/Segment PDF anchors and independent agentic capabilities. Record actual evidence against the acceptance matrix.

## Owner UAT Round 2

Refine Answer on the existing live QA project and keep the Rewrite, Create and Edit prompt banks stable. Project ordinary history without incompatible Plan-sourced replies and keep the same stored Retry snapshot. Show the contextual unsupported answer when available. Run paired synthetic API experiments, focused local contract tests and the live Orchid browser journey before handing QA back to the owner. Retain the current database, provider configuration, volumes and migrations.

## Historical checkpoint — 2026-11-27

P5 was interrupted with earlier gates still open. Corrective UAT-01–08, behavioral UAT-09–12, regression checks, Round 3 UI refinement, HarborDesk OOD, progress and sampled Completion are recorded in the [local status](../../docs/ask-learning-plan/verification.md). The owner accepted the current behavior. Preserve current prompts, demos, checkpoint evidence and QA.

Await approval of the [remaining execution plan](../../docs/ask-learning-plan/handoff.md) and [Owner review copy](../../docs/ask-learning-plan/handoff.md). Then execute G1 reload reproduction, G2 technical safety and recovery, G3 capacity/grounding deltas, G4 GUI/accessibility, and G5 final integrated audit. G1 starts without provider traffic, using two synthetic chats and comparing UI restore to persisted selection/state. Task exits and evidence are maintained in that plan and the local matrix. No separate tracker or release authorization.

## Core Completion checkpoint

Owner approved G0 → G1 → G2-Core → G3-Core → targeted regression → team handoff → Owner review. G0/G1 have scoped browser evidence. G2-Core/G3-Core have focused local and QA DB evidence. See the [status](../../docs/ask-learning-plan/verification.md), [test evidence](../../docs/ask-learning-plan/verification.md) and [unassigned packages A/B/C](../../docs/ask-learning-plan/handoff.md). Extended gates remain in the baseline plan. Stop at Owner review.

## Final Learning Plan UI checkpoint

Owner accepted HarborDesk Core UAT (CORE-01–05). Separate engineering evidence covers progress persistence, Retry and mutation safety. The exact historic 08A symptom remains unspecified. The final UI scope is the workspace sidebar picker, Day-grouped manager/detail/editor and scrollable Create card preview of the current authorized Plan. [Acceptance and evidence](../../docs/ask-learning-plan/verification.md) · [Owner Review](../../docs/ask-learning-plan/operations-demo.md). At this checkpoint QA 23900 was left running for visual Owner Review. Packages A/B/C and extended mandatory gates remain open.


## Main local dev consolidation

Owner accepted Core Completion and Final Learning Plan UI. The accepted uncommitted working tree is running in main local dev on 23000 with new storage. QA on 23900 is retained stopped. [Launch and recovery](../../docs/ask-learning-plan/operations-demo.md) · [Runtime evidence](../../docs/ask-learning-plan/verification.md). Extended gates and demo preparation remain open.
