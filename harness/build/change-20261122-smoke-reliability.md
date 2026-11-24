# Running-stack smoke and reliability

## Goal and scope
Verify the existing Docker Compose environment at its configured browser origin with a synthetic account and PDF. Exercise registration, login/session renewal, workspace/source operations, indexing/search, PDF reading, Plan acceptance rules and a grounded Ask/citation. Keep FinManager and existing user data unchanged.

## Initial evidence
`make verify` passes and 19 RAG containers are healthy. The configured chat provider is a local 9router process at port 20128. Its model list advertises the configured model, but a synthetic completion through Model Gateway returns 503 after upstream HTTP 400. This is a provider-dependent failure, not proof of general stack health.

## Implementation and security
Add a repeatable running-stack browser smoke target with the exact configured Origin. Keep the test runner containerized and use existing Compose images. Record only stage statuses/counts and safe error codes. Use a unique synthetic account/workspace; delete the workspace and revoke its session. Check non-AI flows even when generation fails. Inspect local routing metadata read-only before choosing a provider/configuration fix; do not alter shared 9router accounts or FinManager.

## Verification and acceptance
Run the running-stack smoke, provider smoke and `make verify`. Run `make verify-ui` for UI changes and Phase 03/targeted service tests for any changed Ask execution/provider semantics. Preserve citation UUID/scope/anchors and immutable acceptance. Report actual failures separately from successful core checks. No schema migration is planned; rollback any behavioral fix through code/config while retaining user data.

## Findings
- Running-stack smoke passed all 13 stages with zero browser JavaScript errors, including a real grounded Ask and citation-to-PDF navigation. Report: `test-results/rag-smoke-27920-14-browser/smoke-report.json`.
- The initial free combo and `free-llms` failed; direct free probes returned 429/503. The user added `cx/gpt-5.6-luna` to `claude-free`. Both the configured combo provider check and a direct Luna structured/source-ID probe then passed. The application's model setting remains `claude-free`; embedding remains EmbeddingGemma. Shared 9router routing was not edited by the agent.
- The real outage showed a technical `interaction unavailable` string. The UI now gives localized provider guidance and retains the original question's Retry action. The expanded fixture UI suite passed 16/16 cases.
- Added `make verify-smoke` and concise provider smoke failure output. The smoke runner reads the running Origin and returns nonzero on failed generation while recording successful core stages. Cleanup removes its workspace and revokes the session; the unique synthetic account row remains because no public self-delete API exists.
- The earlier Phase 03 process was interrupted when Docker stopped. Its isolated test project was cleaned up and the main stack restored. A fresh complete Phase 03 suite then passed, including all seven browser cases. The subsequent direct-Luna paired evaluation exposed the coverage failure documented below.

## Handoff state
Main-stack smoke, UI and fresh full Phase 03 regressions passed. The focused gap fix passed all 18 restricted-role research/writing/defense tests (maximum ten fixture model calls and four searches). Its paired real-model rerun is pending; no full Agentic acceptance is claimed yet. Source changes have no migration or dependency additions. Existing user data and FinManager are preserved.

## Follow-up: missing research matrix cell
The fresh Phase 03 suite and all seven citation browser cases passed. The direct-Luna paired live evaluation then indexed both papers and completed the baseline/Agentic runs, but its matrix marked B's explicitly reported recurrent method insufficient (four supported, two insufficient cells). This is a real coverage failure, not the Vietnamese keyword assertion alone. The retained final snapshot cannot establish whether initial grading missed the fact or a later full-matrix regrade erased it.

Code inspection identifies both repair weaknesses: unchanged gap reads skip grading entirely, and changed gap reads regrade previously verified unrelated cells. Limit supplemental grading to the missing cells of the queried paper, using that paper's context; retain verified cells from other criteria/papers. Allow one focused grading after each successful supplemental read even when chunk IDs/text are unchanged, within the existing two-search and model/deadline budgets. Add a regression for an initially omitted fact already present in a returned chunk and preserve previously verified cells. Re-run the affected service suite and paired real-model evaluation, then required stack checks. Keep research rollout opt-in and distinguish any remaining model-quality failure from stack health.

## 23 November remediation
Fix route-specific auth deadlines, browser session renewal and indexing waits, and wire the isolated identity regression into Phase 01. Preserve checked findings, check draft coverage per requested fact and source, and give the tutor bounded, rule-specific repair instructions. Verify isolated Phase suites before the real-provider baseline and research quality gate. Retain existing feature flags and audit state.

The identity ASGI integration test uses HTTPX 0.28.1 from Auth's locked test group to exercise cookies and application routing with a captured reset message. Its Compose profile uses the same restricted runtime DB role as Auth. The normal Auth image uses production dependencies. Local PostgreSQL regressions passed 19 research/writing cases and 6 workflow cases, including preserving a cited paper's missing topic and source revocation. The 20 history/tutor tests passed. The first Phase 01 run passed the identity suite and seven API cases, then exposed a missing browser build-context entry for the shared session helper. That entry was added.
