# Sentence-level citations in Ask

## From PDF to reader

1. **Document Service** makes the same PDF available for indexing and preview. A PDF uses the original object. A DOCX uses its generated PDF preview. See [index source and preview](../../services/document-service/app/main.py).
2. **Document Parser** runs Docling in a subprocess. It preserves the existing normalized chunk text, section, page, split boundaries (1,500 characters), and legacy region. With enrichment enabled, it tracks sentence offsets through normalization, block splitting, and chunk joins. Offsets are half-open Python code-point indexes into the final chunk text. A sentence crossing chunks has separate partial segments. Tables and other unsafe maps can stay chunk-only. See [conversion](../../services/document-parser/app/conversion.py) and [chunking](../../services/document-parser/app/chunking.py).
3. **Geometry** matches a Docling item against its PDFium page text. It ignores whitespace and tries a narrow straight/curly quote fold when needed. The match must be unique, and boxes must be consistent with the item's page and bounds. Aligned glyphs form normalized top-left line rectangles. An attributable whole item can use coarse Docling geometry. A segment without reliable geometry can open the page without drawing a rectangle. See [segment geometry](../../services/document-parser/app/segment_geometry.py).
4. **Ingestion** passes the same chunk strings to embedding (including the existing section prefix rule). The Qdrant point ID is UUIDv5 of the generation and chunk ordinal. A segment ID is `uuid5(chunk_id, f"sentence:v1:{ordinal}")`. The enriched generation hash includes the map before derived IDs are assigned. Legacy writes retain their original hash projection. Each point still has one vector and one copy of its text. Optional `citation_segments_v1` stores IDs, ordinal, offsets, page, partial flag, precision and rectangles. The active generation is published after successful final batch write under the existing lease. See [indexing](../../services/ingestion-service/app/indexing.py), [transport types](../../services/shared/rag_index.py) and [Qdrant writes](../../services/retrieval-service/app/main.py).
5. **Retrieval** uses the existing selected-source filters, active generations, dense/BM25 query, ranking and visibility recheck. Delegated Ask requests can opt in to maps. Retrieval verifies stored segment IDs, page, offsets, coverage and rectangles, dropping invalid maps while retaining the chunk. Public source search does not expose this metadata. See [search](../../services/retrieval-service/app/search.py).
6. **Orchestrator** resolves model IDs to backend evidence, merges valid adjacent citations and persists resolved snapshots. **Web** opens the protected preview, selects the cited page and renders the segment rectangles or the legacy rectangle. See [worker](../../services/agent-orchestrator/app/worker.py), [citation resolution](../../services/agent-orchestrator/app/citations.py) and [viewer](../../apps/web/app/workspaces/%5BworkspaceId%5D/pdf-preview.tsx).

## Mode, API and history

| Selection | Behavior |
| --- | --- |
| Segment (browser default) | Standard Ask answer opts in to segment metadata and uses the adaptive selector. Unmapped chunks remain available as legacy evidence. |
| Chunk | No segment opt-in or attribution call. The answer prompt uses chunk text and chunk UUIDs, with the existing chunk validation and PDF region. |
| Older client omits mode | Retains the Orchestrator setting in the table below. Structured outputs, Plan and Agent keep their existing chunk behavior. |

The browser stores the choice locally across navigation and reload. `POST /v1/workspaces/{workspace_id}/runs` accepts the optional top-level `citation_mode` of `segment` or `chunk` for Ask. Orchestrator validates it and stores it in the run input JSON. Reusing an idempotency key with a different explicit mode conflicts. Omission preserves the previous hash. Retry copies the failed run's stored mode, objective and conversation history snapshot. See [run handlers](../../services/agent-orchestrator/app/main.py) and the [public OpenAPI contract](../../services/api-gateway/app/openapi-v1.json).

Each persisted citation retains `chunk_id`. A resolved segment anchor adds a stable `citation_id`, the selected `segment_ids`, a precision class and `regions`. Chunk citations use `segment_ids: null`. Older snapshots can omit the new fields. The result is self-contained and survives a replacement index generation. Artifact publication copies the resolved snapshot and applies current source visibility checks. Changing the preference affects new Ask turns. It does not update existing answers, artifacts, indexing jobs or vectors.

## Prompts and validation

The [prompt constants and few-shot examples](../../services/agent-orchestrator/app/ask_prompts.py) are the canonical templates. Include their actual request shapes when changing examples. Rewrite, when eligible, receives the original question and bounded prior Q&A. Only the retrieval query changes. Answer generation still receives the original question, history that fits, and freshly packed evidence.

- **Chunk answer:** `ANSWER_SYSTEM` receives entries shaped as `{id,text,section}`. The answer response is `{"claims":[{"text":"…","source":"document","evidence":["uuid"]}]}`. A conversation claim has no evidence IDs. Unsupported answers can return empty claims.
- **Adaptive single pass:** `PRIMARY_SEGMENT_SYSTEM` adds a grouped example mixing `{section,segments:[{id,text}]}` and the legacy chunk shape. The demonstration derives a conclusion from multiple IDs and abstains on an unsupported question despite an injected ID. The selector retains the baseline packed parents/history, then checks byte and estimated cost limits. Auto uses single pass when there are at most 32 segment labels and at most 6,144 extra bytes, including the system prompt. These are heuristic seeds.
- **Adaptive two pass:** Pass 1 is the chunk answer. `ATTRIBUTION_SYSTEM` receives verbatim claims and only their already-cited parents in `{parents,targets}`. It asks for `{"attributions":[{"target":"c0:p0","segment_ids":["uuid"]}]}` or null for abstention. Its example attributes separate premises to different parents and abstains on an unknown room. Invalid, absent, duplicate or unsupported selections preserve the original chunk citation for that target. A malformed response or provider failure preserves the baseline result. The pass cannot rewrite answer text or add sources. It has one optional call, capped at 1,024 output tokens, 28 seconds or remaining run time minus a five-second reserve, whichever is lower. It shares the worker's estimated cost budget.

Answer parsing validates structured claims and exact packed UUID membership. Up to six evidence IDs per claim are accepted. The worker can make one bounded REPAIR attempt for invalid answer output. Attribution validates IDs only against their supplied parent and has no repair. The Model Gateway accepts system and user messages, forwards to the configured OpenAI-compatible chat endpoint and may retry a flagged **answer** or **attribution** request once after upstream HTTP 503, as well as strip unsupported `reasoning_effort`/`response_format` optional parameters on HTTP 400/422. Rewrite is unflagged. See [worker budgets](../../services/agent-orchestrator/app/worker.py) and [gateway completion](../../services/model-gateway/app/main.py).

Adjacent cited segments can merge within one chunk, page and precision class. Gaps and separate lines remain separate, and long runs may fall back to page navigation. An allowed UUID only proves the model saw that evidence. Semantic support still needs review.

## Setup and verification

Follow [local setup](../../README.md#run-the-development-stack). Use Bash, Docker Compose and the repository's Make targets. Copy settings through `make env`, then set provider values in local `.env` per [indexing and source search](../../README.md#indexing-and-source-search). Keep keys out of Git and logs. The web app normally opens at [127.0.0.1:23000](http://127.0.0.1:23000).

| Setting | Default | Scope |
| --- | --- | --- |
| `INDEX_SENTENCE_CITATIONS` | `false` | Set to `true` for new parser runs to generate maps. Recreate the parser when changing it. Existing indexed documents keep chunk citations until indexed with maps. |
| `ASK_SENTENCE_CITATIONS` | `legacy` | Server fallback for requests without explicit mode. `auto`, `single` and `two` are available for diagnostics. An explicit browser Segment request uses auto. |

From the repo root, keeping the same project and Compose files as the running stack:

```bash
make bootstrap
INDEX_SENTENCE_CITATIONS=true docker compose --env-file .env -f compose.dev.yaml \
  up -d --no-deps --wait document-parser
```

Add the existing project name and any overlays if you use them. Upload a fresh text-native test PDF after enabling maps. Ask in Segment, switch to Chunk on the same source, reload, and reopen the conversation and its PDF citations. Job state should stay unchanged when switching.

| Check | Command or entry point |
| --- | --- |
| Parser, indexing, scoped retrieval and worker | `make verify-phase03` uses a separate fixture project and includes map scope/fallback, generation fencing, mode selection and retry. |
| Browser regressions | `make verify-ui` uses a fixture gateway. For real model/browser checks, use `tests/phase05/local_rag.spec.ts` with the Playwright Compose runner. Pass `EXPECT_CITATION_MODE_SWITCH=1` to the runner for switching, reload/navigation and history checks. Enable parser maps in the stack under test. The runner origin must match server origin. |
| Real provider | `make verify-provider` sends synthetic inputs to the configured provider. For both citation prompts on an already running stack, run `docker compose --env-file .env -f compose.dev.yaml exec -T agent-orchestrator /app/.venv/bin/python - < tests/phase05/citation_provider.py`, adding your project name as needed. `make verify-local-rag` is a separate isolated E2E and smoke check, not the mode-switch regression by default. |

## Troubleshooting and limits

- **Segment shows a chunk anchor:** check the parser flag, index job, and active generation of a freshly uploaded PDF first. A legacy or invalid map falls back per chunk. Two-pass attribution can abstain or time out, keeping that target's chunk citation.
- **Segment citation opens the page without a rectangle:** geometry may be unaligned, invalid or unsupported. Compare stored precision and regions rather than inferring accuracy from the pill. The PDF preview and annotations still work independently.
- **Answer fails or claims look wrong:** separate Qdrant scope/active generation, answer schema or ID validation, and gateway errors. Orchestrator logs path/label/overhead and attribution target counts or errors keyed by request ID. Use counts and synthetic test material rather than logging prompts or documents. A valid ID can still be semantically wrong.
- **Reindex and quality:** the fixture results do not establish production precision for scanned, rotated, cropped or complex table pages. Same-fingerprint backfill is not automatic. A new generation can affect ties via new point IDs. Before broad backfill, evaluate tie parity, prompt thresholds, latency and labeled support on a wider corpus. Keep offset and boundary parity tests in place.

See the [implementation log](../../harness/build/change-20261122-sentence-citation-mvp.md) for observed failures, fixes and verification scope.
