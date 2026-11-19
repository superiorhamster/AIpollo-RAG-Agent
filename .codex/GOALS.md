# Project Goals

## Purpose
Create a complete, functional, production-grade **Super Agentic RAG** platform for school learning and academic-paper research.

## Desired outcomes
- Users can organize academic sources into workspaces.
- Users can upload and view documents, with the selected document kept visible in a right-side panel.
- RAG answers are grounded in selected sources and expose verifiable citations.
- The platform supports learning artifacts such as explanations, quizzes, flashcards, study guides, notes, annotations, and mind maps.
- Research workflows support paper discovery, comparison, screening, structured extraction, and evidence tables.
- Writing workflows can draft with source-aware references and citation verification.
- Interaction modes provide user control: Ask for direct responses, Plan for preview/approval, Agent for bounded autonomous execution.
- User and Admin roles are authenticated and authorized.
- The system is decomposed into microservices and is fully deployable with containers.

## Success conditions
- End-to-end flow works: sign in -> workspace -> upload -> process/index -> ask -> cited answer -> click citation -> document panel opens exact evidence.
- `/plan` cannot execute until the user accepts the exact current plan version.
- Cross-tenant access tests fail closed.
- Ingestion is retryable and idempotent.
- Services expose health/readiness status and structured logs/traces.
- The repository can be bootstrapped predictably by a developer or Codex from documented commands.

## V1 non-goals
- Full Zotero replacement.
- Fully autonomous unsupervised research with unrestricted external actions.
- Kubernetes as a requirement for the initial release.
- Training a foundation model from scratch.
- Full PRISMA/systematic-review compliance tooling.
- Audio/video generation as a core requirement.
