# Requirements Baseline — Super Agentic RAG v1.1

This Markdown baseline exists so coding agents can consume the core SRS without parsing a binary document.

## Actors

### User
Student, researcher, lecturer, or knowledge worker using the platform for academic learning, research, and writing.

### Admin
System administrator managing users, operational settings, jobs, logs, and platform health.

## Core functional requirements

- **FR-01 Authentication:** register/sign in/sign out; password reset as applicable; role-aware session/token handling.
- **FR-02 Workspace management:** create, rename, organize, delete, and share/authorize workspaces according to policy.
- **FR-03 Document management:** upload, organize, delete, select, and view documents in a persistent right-side panel.
- **FR-04 Processing/indexing:** parse, structure-aware chunk, embed, index, record metadata and job state.
- **FR-05 Agentic RAG chat:** source selection, citations, multi-turn context, retrieval/retrieval refinement, grounded answers.
- **FR-06 Learning:** explain, study guide, quiz, flashcards, mind map, notes/annotations.
- **FR-07 Research:** discover/compare/screen papers, extract structured evidence, build evidence tables, synthesize with citations.
- **FR-08 Writing:** draft, rewrite, summarize, insert/verify citations, export academic content/artifacts.
- **FR-09 Reference management:** paper metadata, tags/collections, common citation exports where implemented.
- **FR-10 Admin:** user/account management, job/system monitoring, logs/audit views, model/tool/system configuration.

## Interaction mode requirements

### MODE-01 Ask
Direct response mode. The system may retrieve/read sources and call safe tools needed to answer, but should avoid unnecessary autonomous multi-step work.

### LEARN-02 / MODE-02 Plan
The platform creates a user-visible plan before carrying out a multi-step task.

Acceptance contract:
- display ordered steps, expected outputs, selected sources/tools, and relevant constraints;
- allow user to edit/request adjustment or regenerate;
- expose an Accept button;
- do not execute the planned actions until acceptance;
- bind acceptance to an immutable `plan_version`;
- any edit/regeneration creates a new version and requires new acceptance;
- backend, not only frontend, enforces the gate;
- retain accepted plan/version with the resulting run for audit;
- user-visible plan is an action plan, not private model chain-of-thought.

### MODE-03 Agent
After direct user request or accepted plan, run bounded autonomous workflows with visible status, tool/action logs appropriate for users/admins, cancellation where feasible, and configured resource limits.

## Academic capabilities
The interaction mode is orthogonal to capability:

- **LEARN:** tutoring/explanation/quiz/study artifacts.
- **RESEARCH:** discovery/comparison/screening/extraction/evidence synthesis.
- **WRITE:** source-aware drafting/revision/references.

## Document side-panel behavior

- A chosen source can remain visible in a right-side panel while chat/artifacts stay in the main workspace.
- Citation click focuses the relevant document and navigates to the exact page/region or closest supported anchor.
- The panel supports basic document navigation and source switching without losing chat state.
- User annotations/highlights should retain source/page anchors.

## Non-functional baseline

- **Security:** TLS in deployment, safe password hashing, RBAC, tenant isolation, upload validation, secret management, prompt-injection-aware tool boundaries.
- **Reliability:** retries/backoff for transient failures, idempotent background jobs, durable job state, backup/restore strategy.
- **Performance:** interactive chat should stream/progress quickly; long processing must be asynchronous rather than blocking HTTP requests.
- **Scalability:** stateless API services where practical; horizontal scale-friendly workers; independent service scaling.
- **Observability:** structured logs, correlation IDs, metrics, traces for agent/retrieval/model calls and background jobs.
- **Maintainability:** explicit service boundaries, contracts, tests, migrations, documentation.
- **Deployment:** all deployable components containerized; end-to-end Docker Compose deployment supported for V1.
