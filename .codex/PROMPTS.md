# Reusable Codex Prompts

## Start a phase
Read the applicable `AGENTS.md`, `GOALS.md`, `PLANS.md`, the relevant file in `harness/build/`, and only the docs needed for this phase. Inspect the existing implementation before editing. Implement the approved phase, run the planned verification, and report changed files, test evidence, and unresolved limitations.

## Plan a cross-service change only
Perform read-only discovery. Read the applicable `AGENTS.md` and the minimum relevant architecture/requirements documents. Create or update one execution plan under `harness/build/`. Do not modify application code, manifests, dependencies, migrations, or deployment files. Include security/tenancy impact and exact verification steps. Stop after the plan is ready for approval.

## Implement a requirement
Implement requirement `<ID>` without unrelated refactors. Trace the requirement to the current services/contracts, add tests that prove the acceptance criteria, run the relevant checks, and report any ambiguity between the requirement and existing behavior.

## Review Plan-mode safety
Review all code involved in product `/plan` generation, acceptance, versioning, and execution. Specifically test stale acceptance, cross-user access, direct API bypass of the UI gate, replay/idempotency, auditability, and accidental execution during planning. Report concrete findings by severity with file/line evidence and suggested fixes.

## Review a RAG change
Evaluate both software correctness and retrieval quality. Run unit/integration tests plus the relevant RAG evaluation dataset. Compare the changed metrics against the baseline. Do not approve a retrieval change based only on a few manual prompts.
