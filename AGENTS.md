# Repository instructions

Read and follow the [canonical repository instructions](.codex/AGENTS.md). The project goals, phase sequence, dependency baseline, and architecture documents are in [.codex](.codex/). Paths in those documents for application code, execution plans under `harness/build/`, and developer commands are relative to the repository root. See [README.md](README.md) for the current development workflow.

## Where to work

- `apps/web/` owns the browser UI and same-origin API relay. Read its own agent instructions before changing it.
- `services/` contains service entry points and their owned schemas. `services/shared/` defines shared wire types and runtime budgets. Keep service-to-service access behind existing APIs.
- `tests/` contains fixture, database and browser regressions. `harness/build/` records implementation decisions and actual verification. See the [sentence citation guide](docs/ask-pipeline/sentence-citations.md) for the index-to-reader path and prompt contracts.

## Citation invariants

- Preserve canonical chunk text and boundaries, one vector per chunk, retrieval ranking, source filters and active-generation publication. Segment maps are optional additions to chunk payloads.
- Validate model IDs against evidence actually supplied to that invocation. Attribution may refine only an existing claim–parent citation. Preserve the answer and valid siblings when an attribution falls back.
- Keep chunk mode and omitted-mode clients compatible. Use resolved run and artifact snapshots when opening old citations. Never recompute saved anchors from the current preference or generation.

## Local work and verification

Run commands from the repository root with Bash. Use `make check`, `make env`, `make compose-check` and `make bootstrap` for setup. Use `make verify-phase03` for parser/index/Ask changes and `make verify-ui` for browser changes. Follow the citation guide for synthetic real-provider and mode-switch checks. Record actual results separately from fixtures and from earlier runs.

Use the existing Compose project and environment file when operating on the dev stack. Keep credentials and private text out of logs and commits. Preserve local edits and volumes. Use scoped synthetic data for tests that write or call a provider. Review the staged diff and confirm the exact destination before a requested push.
