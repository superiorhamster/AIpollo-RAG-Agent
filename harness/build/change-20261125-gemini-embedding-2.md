# Gemini Embedding 2 support

## Goal and requirements
Use `gemini-embedding-2` for source indexing and search (FR-04), preserving grounded citation navigation and tenant isolation.

## Scope and non-goals
Update Model Gateway, the additive internal embedding request, Retrieval's query role, synthetic evaluation, and an optional Compose configuration. Preserve canonical chunks, ranking, citation payloads, chat configuration, and the existing Ollama profile. No multimodal ingestion or live-data reindex in this change.

## Current behavior
The local configuration selects native Ollama/EmbeddingGemma, 768 dimensions. Gateway already handles Google's OpenAI-compatible singleton responses with bounded concurrency, but does not send an output dimension or distinguish document/query inputs.

## Design
Add optional `input_type=document|query`, defaulting to document for existing callers. For Gemini Embedding 2 only, Gateway formats documents as `title: none | text: ...`, queries as `task: search result | query: ...`, sends configured dimensions, and includes a retrieval-format revision in the fingerprint. Formatting occurs at the provider boundary, leaving chunk text unchanged. Other models keep their existing requests and fingerprints. Select Gemini through `compose.gemini.yaml`, with a dedicated private `GEMINI_API_KEY`, default 3072 dimensions, and the existing OpenAI protocol/HTTPX dependency.

## Security and tenancy
Keep service tokens, HTTPS validation, request deadlines, access filters and active-generation publication. Never print keys or user text. Real-provider checks use only the existing synthetic bilingual corpus.

## Migration and rollback
Model/config/format changes select a separate fingerprint-named Qdrant collection. Use the existing dry-run reindex command, then explicitly apply when ready. Existing generations and saved citation snapshots are retained. Remove the Gemini overlay and restore the prior Compose selection to roll back, then reindex sources whose active pointer already changed. Search requires the selected fingerprint and does not mix in vectors from another model. Never delete volumes or old collections.

## Implementation steps
1. Add request role, Gemini-only formatting/dimensions/versioning and focused adapter tests.
2. Mark Retrieval and synthetic evaluation queries correctly; verify source scope remains unchanged.
3. Add opt-in Gemini configuration and setup/reindex instructions.
4. Run adapter and retrieval tests, Compose validation, and `make verify-phase03`; record actual results below.

## Verification and acceptance
- Adapter tests cover model IDs, query/document roles, default-role compatibility, configured dimensions, fingerprints, malformed vectors and existing provider cancellation/order behavior.
- Retrieval regression verifies query role and unchanged active tenant/document/generation scope.
- Validate merged Compose with a synthetic API key; never print expanded configuration.
- `make verify-phase03` verifies fixture parser/index/Ask/citation flows; it is separate from real-provider evaluation.
- `make COMPOSE_FILES="compose.dev.yaml compose.gemini.yaml" verify-embedding` and `eval-embedding` require a private Gemini key and run only on synthetic data.
- `git diff --check` must pass.

## Open questions and actual results
- No Gemini key is currently configured, so live-provider validation/evaluation and activation are pending. The existing private `.env` and running stack were not switched. No real user data was sent to Google or reindexed.
- `make check`: passed.
- Host adapter tests using the existing Python environment (FastAPI 0.163.1, HTTPX 0.28.1): 19 tests passed, including the new Gemini cases and rejection of old fingerprints before provider calls. These use mocked provider responses, not live Google embeddings.
- Host `tests/phase03/segment_retrieval.py` with synthetic service-token environment: 1 test passed, including query role and source/citation scope assertions.
- `GEMINI_API_KEY=synthetic-compose-validation-only make COMPOSE_FILES="compose.dev.yaml compose.gemini.yaml" compose-check`: passed. Synthetic value used only to validate configuration, never to call a provider.
- `make verify-phase03`: attempted with Docker access, but unavailable because `/var/run/docker.sock` does not exist in the execution environment. No fixture integration, browser, DB or live-Qdrant evaluation result is claimed.
- Final static checks: Python syntax passed for all seven changed Python files; merged Compose passed at 3072, 768 and 1536 dimensions while preserving chat configuration and the base service set; `git diff --check` passed.
