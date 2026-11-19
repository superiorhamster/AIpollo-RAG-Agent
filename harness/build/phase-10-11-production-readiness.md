# Phases 10–11 — Evaluation and production readiness

Add reproducible evidence-ranking evaluation, request correlation, OpenTelemetry export, and operator backup and restore procedures. The production Compose overlay pins images by digest and publishes only the TLS proxy. Keep services and storage on Compose networks, with a separate environment file and project identity for production.

Evaluate dense-only and hybrid retrieval on the versioned bilingual synthetic corpus and report Recall@10, MRR, latency and scope exclusions. Run regression and Compose smoke tests with fixture models. Exercise the hosted provider using synthetic documents. Test approval, replay safety and restore before rollout.

Take consistent backups during maintenance with application writers stopped. Keep PostgreSQL ownership, private object names, and Qdrant snapshot data together under one checksum manifest. Restore into an isolated Compose project before release. Retain the previous reviewed image references and snapshots for rollback.
