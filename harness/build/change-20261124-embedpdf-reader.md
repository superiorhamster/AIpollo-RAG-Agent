# EmbedPDF embedded reader

## Goal
Single-page EmbedPDF reader with preserved citation snapshots and durable private highlights/notes.

## Requirements
Citation document/page/region navigation, authenticated source access, per-user annotations, responsive mixed page shapes, Docker Compose development.

## Scope
Web reader/adapter, Document Service annotation models/API/migration, Gateway/OpenAPI, exact dependencies and lockfile, synthetic regression tests.

## Non-goals
OCR, PDF export, modifying originals/index/citation snapshots, collaboration, unrelated panel changes.

## Current behavior
PDF.js 6.5.438 renders a canvas without text selection. Zoom stretches CSS. Notes store one normalized rectangle privately per user. Preserve current uncommitted resizing changes.

## Proposed design
Pin EmbedPDF React/engine 3.3.0; local worker/WASM; headless PageView with required plugins, one active page, fit-width default, fit-page, zoom, rotation, search/selection. Convert API 1-based page numbers to zero-based SDK indexes. Draw citations as independent non-editable overlays, with coordinate adapters and existing fallback precision. Store validated, versioned annotation snapshots plus normalized multi-regions; hydrate without echo writes. Add PATCH and stable-id idempotent create. Show saved only on server confirmation; retry failures.

## Security/tenancy
CRUD scoped by workspace/document/current user; validate kind, finite geometry, size, plain text. Exclude original PDF annotations from personal storage. Authenticated same-origin fetch; local assets.

## Migration/rollback
Additive forward migration preserves old region/body rows. Keep a bounding legacy region for old clients. Application rollback leaves annotation data intact.

## Implementation steps
1. Inspect package types, integrate one-page renderer/local engine.
2. Fit/zoom/rotation/search/citation adapter and cleanup.
3. Migration and private annotation CRUD/retry/compatibility.
4. Update contracts/docs/tests; run sequential Compose verification.

## Verification
TypeScript/build; model/API and browser regressions; make verify; make verify-ui; make verify-phase02; make verify-phase03; git diff --check. Cover multiline highlights/selection, note reload/edit/delete, idempotency/tenant isolation, mobile/resize, mixed/rotated/cropped PDFs, citation alignment, failed saves and 20-page lifecycle.

## Acceptance criteria
Selectable PDF text; durable private highlights and notes; citation/legacy annotation compatibility; local engine assets; working production container and Compose.

## Open questions
None.

## Actual verification

- `pnpm exec tsc --noEmit`: passed. Production Next.js and Docker web builds passed.
- `make check`, `make compose-check`, `git diff --check`: passed.
- Annotation validation: 3 tests passed in the Document Service container. Legacy coordinate round-trips at 0/90/180/270 degrees passed.
- Final `make verify-ui`: **27 passed (2.3m)**. Includes Vietnamese PDF selection/copy, multiline highlight retry with the same key, note edit/reload/delete without echo POSTs, mixed/intrinsically rotated/cropped/textless pages, region highlight, 20 page switches, resize/mobile, and expired-access-token download renewal. Log: `/tmp/aipollo-embed-ui-final.log`; artifacts: `test-results/rag-ui-test-2610788-18848/`.
- `make verify-phase02`: passed (3 annotation validation tests, document/API lifecycle including cross-user isolation and idempotency conflicts, MinIO outage/recovery, workspace cleanup, and real browser PDF/DOCX/highlight/note persistence). Browser: **1 passed (1.3m)**. Log: `/tmp/aipollo-embed-phase02-2.log`; artifacts: `test-results/rag-phase02-test-2429071-25767/`.
- `make verify-phase03`: passed all unit/integration/evaluation checks, indexing/provenance/scoped search/vector cleanup, and **7 browser tests (3.2m)** for Ask retries, exact plan acceptance, citation navigation, artifacts, mobile and accessibility. Uses synthetic fixture/disabled providers, not real-model quality evaluation. Log: `/tmp/aipollo-embed-phase03.log`; artifacts: `test-results/rag-phase03-test-2477616-9488/`.
- Earlier runs exposed cold-worker readiness waits, ambiguous note text selectors, and textless SDK selections. Fixed by waiting for actual picture readiness, targeting saved notes, and enabling text tools only after nonempty text extraction. Phase 02 now retains browser traces. Subsequent checks passed.
- Production license inventory completed; SDK Apache-2.0 notices are included. Raw production audit reports **one high advisory GHSA-mrhx-c7xc-m3w5** in `zod@3.25.76`, required by EmbedPDF engine-core 3.3.0. No suppression or incompatible Zod 4 override is configured. This remains an upstream production-release concern; see `docs/pdf-reader.md`.
- Engine WASM: 7.52 MiB raw / 3.04 MiB gzip; worker: 1.57 MiB raw / 0.50 MiB gzip. These are static file measurements, not transferred-byte or cold-load latency benchmarks.

## Dev deployment

Updated the existing `super-agentic-rag-dev` project using `.env`, `compose.dev.yaml` and `compose.ollama.yaml`. Built web, API Gateway, Document Service and its migration image. Applied additive `documents_003`, then recreated only the three application services, retaining all volumes.

- Updated services healthy; `COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' make verify` passed all five infrastructure checks and all eleven application readiness checks.
- Deployed web package confirms EmbedPDF React/engine **3.3.0**. The local WASM returns **200 application/wasm**; SDK notices and annotation PATCH contract are present.
- URL: `http://127.0.0.1:23000`.
- FinManager container IDs matched before/after deployment; that stack was not changed.
- Logs: `/tmp/aipollo-embed-deploy-build.log`, `/tmp/aipollo-embed-migrate.log`, `/tmp/aipollo-embed-deploy.log`, `/tmp/aipollo-embed-verify.log`.

For reader rollback, restore the previous web image while retaining the compatible Document Service/API and additive schema. Do not run a destructive database downgrade. Old clients still read the legacy bounding region; persisted citation snapshots and source PDFs are unchanged.
