# Phase 05 — Ask, Plan and Agent

Build MODE-01 through MODE-03 as workspace-scoped private interactions. PostgreSQL in the Orchestrator owns conversations, immutable plan revisions, acceptance records and run state. Persist idempotency keys for creating plans, accepting revisions and starting runs. Edits/regeneration create a reviewable version and invalidate previous approval for new runs. Once claimed, a run uses its pinned plan revision.

The worker delegates the actor ID to scoped service APIs and rechecks current workspace access before each tool and before returning data. Use Retrieval and Model Gateway with an allowlist of source search and grounded response. Return only references to actual retrieved chunks. Missing evidence returns an abstention. Store progress, deadlines, tool labels and outcome without private model reasoning. Keep task outcomes private and keep user browser cookies out of worker storage.

Use workspace API routes for Ask, Plan versions, acceptance and runs. Publish run snapshots through an event stream and use a separate Cancel action. Add an additive schema and provisioning role. Retain run, plan and conversation tables on rollback.

Verify unaccepted/stale/cross-user execution, duplicate accepts and starts, concurrent edit/start, pinned execution, cancellation, restart, private chat and grounded answer provenance.
