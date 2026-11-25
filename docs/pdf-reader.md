# Embedded PDF reader

The web app uses EmbedPDF Headless 3.3.0 and its local PDFium engine. Only the active page is mounted. The browser loads the worker/WASM from the application build, with no external PDF service. Documents use the existing authenticated same-origin preview endpoint.

The compact toolbar supports page navigation, text search, zoom, Fit Width (default), Fit Page and clockwise rotation. Fit modes follow the panel dimensions and each page's shape. Text selection supports dragging, selecting the current page, copying and multiline highlighting. Scans support region highlights and notes; OCR and annotation PDF export are separate work.

Citations remain non-editable overlays, separate from personal annotations. Saved citation snapshots, source precision and coarse/page fallback are unchanged. Legacy anchors use normalized intrinsic-display coordinates; the adapter converts these to EmbedPDF's upright crop-relative page coordinates. Reader rotation affects display only and is never written back to the original PDF.

## Personal annotations

Document Service owns the private notes/highlights in PostgreSQL. GET/POST/DELETE remain compatible. POST optionally accepts a UUID Idempotency-Key; replaying the same payload returns the same annotation, and reusing the key for different content conflicts. PATCH on the annotation item accepts the annotation input (page/body/geometry) and returns the updated annotation. Every operation checks workspace membership and scopes data to the current user.

`regions` contains normalized line rectangles; `region` retains the bounding rectangle for older clients. Optional `embedpdf` is a version-1 allowlisted geometry/style snapshot (highlight/text/square), without engine IDs, scripts, binary resources or the PDF's embedded annotations. Migration documents_003 only adds columns and preserves old data on application rollback.

The Personal annotations panel below the PDF is collapsed by default to maximize reading height while keeping the four annotation tools (`Select page text`, `Copy text`, `Highlight text`, `Select highlight`) pinned in a responsive toolbar that adapts between icon+label on wide panels and icon-only with tooltips/accessible names on narrow panels. Notes and highlights on the active page open via **Add note** or the expand toggle, preserve list order on in-place edits, require inline confirmation before deletion via each row's `⋯` menu, auto-hide the `"Annotation saved."` status indicator after 3 seconds, bind note drafts to their originating page, and ask confirmation before discarding unsaved drafts when switching documents, closing the reader, or editing another item. Pending saves retain their idempotency key for Retry and lock switching or hiding the reader until resolved.

## Verification

Run `make verify-ui`, `make verify-phase02`, `make verify-phase03`, then `make verify` against the current dev stack. Browser fixtures cover reading, citation geometry/rotation, mixed page shapes, resize/mobile, multiline highlight, failed-save retry and note edits. Phase 02 covers legacy notes, validation, replay conflicts and cross-user isolation.

## Dependency checks

The pinned SDK packages declare Apache-2.0; distribution notices are served at `/aipollo/legal/embedpdf-notices.txt`. The production license inventory also includes the existing Next.js/sharp/caniuse dependencies.

The raw production audit currently reports GHSA-mrhx-c7xc-m3w5 in transitive `zod@3.25.76`, required by EmbedPDF engine-core 3.3.0. No audit suppression or incompatible Zod 4 override is configured. The application validates and bounds annotation data before the SDK receives persisted data; this does not establish that all embedded PDF metadata paths are unaffected. Follow the upstream compatible fix before production release. See https://github.com/advisories/GHSA-mrhx-c7xc-m3w5.
