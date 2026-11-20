# Debugging Ask

Use [architecture.md](architecture.md) for current boundaries and [the Segment 05 audit](segment-05-audit-report.md) for the earlier implementation. The developer’s [Gemini setup notes](../../../aipollo-setup-gemini-debug.md) are outside the repository. Sections 3–8 record earlier observations.

## Find the failing stage

| Symptom | Inspect first | Evidence and interpretation |
|---|---|---|
| PDF opens but indexing fails | Ingestion job for the exact document UUID. Check `status`, `attempts`, `error_code`, `request_id`, `index_generation`, and fingerprint. Correlate Document `index-source`, parser `/parse`, Model Gateway `/embeddings`, and Retrieval `/index-batch`. | Preview and indexing are separate. Parser 422 can indicate failed/empty extraction. `index_dependency_unavailable` groups several downstream failures. A queued job can be waiting for model configuration. A succeeded job still needs the current fingerprint. See `services/ingestion-service/app/indexing.py:97`, `:185`, `services/ingestion-service/app/main.py:87`. |
| Gemini response has no index | Model Gateway's image and embedding route status. Compare its deployed code with the Gemini singleton logic. | Setup notes §3 records upstream 200, a 3072-dimensional vector, missing index, and old gateway `502 invalid_embedding`. Current code accepts omitted index for a Gemini singleton and rejects multiple rows, bad index or invalid vector. A fresh 502 can still be invalid shape, dimensions or nonzero check. See `services/model-gateway/app/main.py:111`, `:119`, `tests/model-gateway/embeddings.py:39`. |
| “Not enough evidence” | Run result and requested document UUIDs, then active generation and fingerprint. Correlate `active-indexes`, query `embeddings`, `search`, and `completions`. | With no active matching generation, Retrieval returns empty before the query embedding. A completed retrieval can also return empty. The worker can abstain if no passages fit the prompt or if no generated claims survive validation. Check whether completions was reached before interpreting the label. See `services/retrieval-service/app/search.py:87`, `services/agent-orchestrator/app/worker.py:125`, `:158`, `:186`. |
| “interaction unavailable” | Use run `step` and last correlated HTTP status to distinguish retrieval and compose. | Retrieval errors, non-200 completions, invalid model JSON and generated-schema failures can all land in `interaction_unavailable`. A 200 completions route only establishes receipt of text. Separate codes cover `time_limit`, `source_unavailable` and revoked workspace access. See `services/agent-orchestrator/app/worker.py:139`, `:153`, `:183`, `:192`. |
| Citation opens a real passage but supports a different statement | Compare the saved claim and its cited chunk IDs with the page/region the UI opened. Compare with earlier user turns, using synthetic fixtures when sharing diagnostics. | A valid packed chunk ID proves that the chunk was available to generation. The validator does not check entailment. If saved metadata is correct and the reader opens the corresponding chunk, inspect model attribution first. If the saved target is wrong, trace Qdrant payload/document/generation and parser provenance. See `services/agent-orchestrator/app/worker.py:158`, `services/retrieval-service/app/search.py:129`, `apps/web/app/workspaces/[workspaceId]/interaction-panel.tsx:286`. |

## Read-only checks against the dev stack

From the repository root in Bash/WSL, substitute an existing request UUID copied from local job/run metadata. Keep logs local and share only route, status, timing, request ID and error class.

```bash
docker compose --env-file .env -f compose.dev.yaml ps --all
docker compose --env-file .env -f compose.dev.yaml logs --no-color \
  document-service document-parser ingestion-service model-gateway retrieval-service agent-orchestrator \
  | grep -F '<request-uuid>'
```

- **Browser:** Inspect existing GET run snapshots or SSE frames in DevTools. `run_id` identifies the run and `conversation_id` identifies the thread. An existing document jobs GET is `/v1/workspaces/<workspace-id>/documents/<document-id>/jobs`; use the signed-in browser. Capture IDs rather than relying on duplicate filenames. See `services/document-service/app/main.py:289`, `services/agent-orchestrator/app/main.py:289`.
- **PostgreSQL:** In a read-only transaction, select `document_id, job_id, request_id, status, attempts, error_code, index_generation, embedding_fingerprint` from `ingestion.jobs` for that UUID and `kind='index'`. For Ask select `run_id, request_id, conversation_id, step, status, error_code, input->'document_ids', result->'insufficient_evidence'` from `orchestration.runs` for that run. Avoid printing full input/result. Match timestamps and request IDs across services. See `services/ingestion-service/app/migrations/versions/ingestion_001.py:11`, `services/ingestion-service/app/migrations/versions/ingestion_002.py:11`, `services/agent-orchestrator/app/migrations/versions/orchestration_001.py:54`.
- **Qdrant:** Use the local `POST /collections/rag_chunks_<fingerprint>/points/count` read operation with `exact:true` and a `filter.must` containing equality matches on `workspace_id`, `document_id`, and the matching `generation`. Read model config from the gateway’s local embedding-config route with in-container authentication if needed. That route performs no provider call. Count verifies published points, while actual ranking needs a search test. See `services/model-gateway/app/main.py:93`, `services/retrieval-service/app/main.py:99`.
- **Existing results:** Setup notes §§5–6 records an earlier chat 503 after successful embeddings and a later user-reported full synthetic smoke pass. Test source checks Gemini vectors/order and API/browser citation integration, but that evidence does not establish the history-only failure reason. See `tests/model-gateway/embeddings.py:39`, `tests/phase05/citation.spec.ts:26`.

## Observations and open hypotheses

- Earlier read-only stack audit and setup notes §7: original PDF ending `8b49` parsed successfully, then failed with `index_dependency_unavailable`, no generation and zero current points. Both other original selected sources lacked active generations. The newer PDF ending `2a47` succeeded and had four active points. The Ask close to publication did not reach query embedding. A later UI report in §8 shows that an Ask about watering returned 250 mL and its citation opened page 1.
- Setup notes §8: a history-only question failed with `interaction unavailable`. A later mixed question returned the conversation’s label “Mật mã Mây Tím” and the PDF’s 16:10 Friday, citing the PDF for both.
- A fresh read-only check found a likely match for that sequence without inspecting prompt or completion text. Run `37c91ac0-6470-45b7-ac59-2e27b84c65a8` (request `096c97c5-e30c-4e28-aaf4-677d3e9cf0d1`, 12:27:55 UTC) failed at `compose` with `interaction_unavailable`. Search, query embedding and completions each logged HTTP 200 for the request. That places the observed failure after retrieval, with completion parsing or validation a leading hypothesis. The exact exception was not logged. Run `6fdccf7a-c82c-4f1a-a0b1-a916905bef38` (request `392ac541-ed35-47c2-bf59-7f2ddb4c8646`, 12:29:09 UTC) also logged HTTP 200 for all three routes and persisted two claims. Confirm the mapping to the reported UI turns before treating these IDs as definitive.

## Controlled same-chat versus New chat check

Run this only in an approved provider test session, ideally with a fixture or synthetic sources. Submitting these UI requests can call the configured provider. This test was not run for the documentation audit.

1. Choose a fixed set of indexed source UUIDs. Include a synthetic PDF with a distinctive documented fact such as “16:10 Friday”; confirm it omits a unique label such as “Mật mã Mây Tím.” Keep source versions, model and capability fixed.
2. Start a chat and submit a seed question that includes the unique label and asks a document-backed question. Wait for a succeeded run so the seed is eligible for `prior_questions`.
3. In the same chat, ask “What label did I give the watering event?” and record status, step, error code, claims and citation IDs. Click **New chat**, verify the same selected UUIDs, and ask exactly the same question again. Record the new conversation ID and outcomes.
4. Repeat the comparison with fresh independent threads for “When did the watering happen, and what label did I give it?” Seed only the same-chat arm. This avoids feeding the first follow-up into the next comparison. Also run a document-only control for the time and check the cited page.
5. Compare route/status traces and saved attribution. Same-chat Ask can rewrite the retrieval query and recall user-supplied facts without citing a PDF. The New chat arm should have no access to the seed. Model results can vary. Record the source selection and actual claims in each arm.

## Manual Retry checks

- Inspect the authorized run snapshot. `interaction_unavailable` alone is generic. A final Ask Model Gateway HTTP 503 produces `retryable: true`; a rewrite fallback, unrelated validation error, or historical generic failure lacks that flag. The snapshot includes the saved Ask objective. UI **Retry** submits it with the original conversation ID and a fresh idempotency key. [Run projection](../../services/agent-orchestrator/app/main.py#L27) · [Retry UI](../../apps/web/app/workspaces/%5BworkspaceId%5D/interaction-panel.tsx#L199)
- An automatic gateway retry on upstream 503 uses the **same** request ID and stays within one run. A manual Retry creates a **new** run and request ID. Compare timestamps and route status for each ID. Rewrite and compose can share a request ID within a run, and an abandoned rewrite can log after compose starts. A second eligible failure re-enables the button. A successful attempt replaces the displayed failed turn until page reload. [Gateway retry](../../services/model-gateway/app/main.py#L202)

## Verification record

### Live Bến Sương smoke test

The supplied live transcript shows correct content for questions 1–8 and an insufficient-evidence response for question 9. The follow-ups resolved the lantern and mounting bracket across turns. Question 4 calculated 19:20 minus 35 minutes as 18:45 on Saturday. The response said **“before 18:45”**, which is stricter than **“by 18:45”**.

The copied transcript did not capture citation pills. The two required citations on the 18:45 claim remain unverified. Independent **New chat** runs for questions 5–9 also remain unverified. These observations describe live content and do not establish live Retry behavior.

### Automated regressions

Recorded implementation verification: five focused worker tests passed, including gateway-503 classification, first Ask, bounded history and the synthetic three-turn demo. The simulated Retry browser regression passed in installed Chrome and in isolated Compose. It covers repeated 503, queued-button locking, double-click protection, replay of the original sources after deselection, fresh keys, and success with a citation in the original turn. All seven browser cases passed in the recorded Compose run. That run subsequently encountered fixture sign-in throttling after an additional standalone Chrome login. The fresh isolated Phase 03 rerun exited successfully. The docs update did not rerun the tests or contact Gemini. [Worker tests](../../tests/phase05/history_ask.py) · [Retry browser test](../../tests/phase05/citation.spec.ts#L26)
