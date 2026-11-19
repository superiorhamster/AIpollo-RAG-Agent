# Phase 04 — Grounded retrieval

Implement the retrieval and citation foundation for FR-05. Start with workspace source search and use the same retrieval route from the conversational phase. The workspace tool selects authorized source IDs, shows bounded evidence passages, and focuses the existing PDF viewer when a citation is selected.

Retrieval checks access through Document's authenticated listing, resolves active index generations through Ingestion, and filters both Qdrant prefetch branches to that scope. Fuse dense and full-text BM25 ranks. Deduplicate and rerank candidates before packing evidence. Confirm the authorized document set again before returning results. The public contract identifies each result by document, chunk, and page, with an optional normalized bounding region.

Deploy the additive routes alongside the indexed document lifecycle. Readily revert new clients and routes while retaining the stored index. Verify the selected source scope, missing/removed generations, foreign workspace denial, and citation navigation. Compare retrieval modes on the versioned evaluation set before the production release.
