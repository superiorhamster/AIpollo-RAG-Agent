# History aware Ask

- **Goal and requirements.** Extend MODE-01 with follow-up retrieval and separately attributed conversation recall while preserving FR-05 citation rules.
- **Scope.** Orchestrator worker and response model, Web citation rendering, fixture completions and targeted regressions.
- **Non-goals.** Provider changes, index changes, new APIs, and PLAN or AGENT workflow changes.
- **Baseline.** At `390356e` retrieval sees only the current question. The generator loads earlier questions after retrieval. Every generated claim requires a current passage ID. The shared artifact path expects document-backed output.
- **Design.** Read a bounded chronological projection of earlier successful Ask input and accepted claim text. Request a standalone query through existing completions. Feed it only to existing retrieval. Generate from the original question and supported data, persist provenance in existing JSON and render chat claims separately.
- **Tenancy.** Constrain history by workspace, actor and conversation. Use current access and lease checks around the added stage. Keep conversation-only claims private when generating shared artifacts.
- **Migration and rollback.** Existing JSON documents remain readable. No migration. Reverting code restores the old retrieval flow and old readers can still display text with its citation list.
- **Implementation.** Add prompt/schema contracts, update stage sequencing and result handling, then wire the UI and fixtures.
- **Verification.** Run the new Ask worker suite in a Python service image. Exercise the first Ask, three-turn demo, fallback, isolation, attribution, citation rejection and cancellation. Verify the fixture browser case if infrastructure is available.
- **Acceptance.** A first Ask needs one answer call. Follow-ups may rewrite retrieval without changing the answer objective. Supported document claims expose current citations, and chat claims have a distinct label and no PDF target.
- **Open validation.** The Bến Sương transcript confirms live answer content and follow-up resolution, with citation and New chat gaps noted in the [verification record](../../docs/ask-pipeline/debugging.md#verification-record).

## Completion deadlines and diagnostics

The broad propagated timeout-budget patch was reverted. The existing 12-second rewrite cap, worker deadline and 25-second upstream HTTPX read timeout apply. The narrower gateway change makes one extra upstream attempt only after HTTP 503 during final Ask compose. The two attempts share a 28-second gateway cap. Gateway diagnostics record request ID, exception class, elapsed time and upstream status when available.

The worker still contains temporary `DEMO_*` probes and two diagnostic log calls for the Nobita/demo evidence investigation. These report IDs, counts and predicate results without printing passages. Exclude these temporary hunks from the implementation commit. The packed-ID variable is also used by validation and should remain staged.

## Manual Ask retry

The final Ask gateway-503 path persists a private marker and exposes a retryable flag while keeping the public error generic. The saved objective and conversation let the UI replay the original submission with a fresh key. Replacement attempts stay beside the original turn until page reload. Older generic failures remain ineligible. Manual Retry required no migration or changes to prompts, retrieval, deadlines or the existing gateway retry policy. Recorded worker and browser regressions passed for classification, original-source replay, fresh keys, pending locking, repeated failure and successful citation display.
