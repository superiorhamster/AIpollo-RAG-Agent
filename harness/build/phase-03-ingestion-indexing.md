# Phase 03 — Ingestion and indexing

Implement FR-04 using the existing durable Ingestion jobs. Phase 02 creates index jobs, including for already-uploaded documents. The index worker uses Document's internal access to the exact PDF shown in the viewer. DOCX jobs wait for their preview without spending index attempts.

An isolated Docling parser extracts page-aware chunks, with headings, table content, and coordinates where available. Ingestion sends bounded embedding batches to Model Gateway. Retrieval owns the Qdrant writes and keys points by document, generation, and chunk. Ingestion records an active generation only after all writes succeed. Retrieval consumers use the recorded active generation as part of the query filter. Document and workspace deletion cancel jobs and enqueue durable cleanup. Existing files and job history are preserved.

Internal JSON routes cover parsing, embedding, and indexing. They require service credentials or are isolated on a dedicated network. Model Gateway stores API settings in the environment. Compose starts without a configured model and reports feature availability separately. Use an isolated test profile with deterministic embeddings, then run the provider smoke test with synthetic data once credentials are available.

Apply the additive migration before starting Ingestion. On rollback restore the previous workload after draining workers and retain the index, new columns, and cleanup records. Production publication and user-facing retrieval are covered by later phases.

Verify parser chunk provenance, old queued jobs, duplicate delivery, provider recovery, publication fencing, and cleanup through Compose. Run make check, make compose-check, make bootstrap and phase regression targets.
