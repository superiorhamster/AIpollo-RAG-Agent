# Dependency Baseline

This file is a **stack policy**, not a lockfile. Add exact package versions to the relevant service manifest and commit lockfiles when each service is created. Do not put the entire backend in one shared Python environment simply because the services use similar libraries.

## Codex/developer tooling

Required or strongly recommended on the host:

- Codex CLI: `@openai/codex` (current release)
- Git
- Docker Engine / Docker Desktop
- Docker Compose v2
- Bash + GNU Make for provided helper commands
- Python 3.12+ and `uv` for local Python editing/testing
- Node.js LTS + Corepack/pnpm for the frontend

## Frontend baseline

Expected choices when the web app is scaffolded:

- Next.js + React + TypeScript (strict mode)
- Tailwind CSS or an equivalent token-driven styling layer
- TanStack Query for server-state fetching/caching
- Zod for client boundary validation where useful
- PDF.js / React PDF-compatible viewer for the document side panel
- Playwright for E2E tests
- Vitest or the framework's supported unit-test runner

The PDF/document viewer must support page navigation and a stable API for focusing a citation anchor from chat/research output.

## Python microservice baseline

Use only what each service needs. Common candidates:

- FastAPI + Uvicorn
- Pydantic / pydantic-settings
- SQLAlchemy 2.x + Alembic + async PostgreSQL driver
- HTTPX for service-to-service HTTP
- OpenAI SDK behind the Model Gateway when OpenAI models are configured
- LangGraph in the Agent Orchestrator if its state-machine model remains the chosen orchestration approach
- qdrant-client in Retrieval/Ingestion only
- Redis client in services that actually use caching/locks/rate limits
- RabbitMQ client such as aio-pika in event producers/consumers
- S3-compatible SDK (`boto3`, `aioboto3`, or MinIO SDK) in document/artifact storage owners
- structlog or equivalent structured logging
- OpenTelemetry SDK/instrumentation for traces/metrics

## Document ingestion baseline

- Docling as the primary structured academic-document parser
- Add specialized parsers/OCR only when the evaluation corpus proves they are needed
- Keep page/section/table/formula provenance through the chunking pipeline

## Authentication/security baseline

- An established Argon2/bcrypt-compatible password hashing package
- A maintained JWT/session library if JWTs are used
- Do not implement crypto, password hashing, token signing, or CSRF primitives manually

## RAG/evaluation baseline

- Qdrant for vector/hybrid retrieval storage
- A reranker abstraction (provider/model selected by configuration)
- Ragas or an equivalent reproducible RAG evaluation framework for offline quality regression tests
- A versioned evaluation dataset checked into or referenced by the repository without including private user documents

## Infrastructure services

Development Compose currently provides:

- PostgreSQL
- Redis
- RabbitMQ
- Qdrant
- MinIO

Before production release, replace floating image tags with pinned, reviewed image versions or digests and maintain an upgrade policy.

## Observability baseline

Instrument services using OpenTelemetry-compatible APIs. A production deployment may use Prometheus/Grafana plus a trace/log backend, but the application should not hard-code one vendor throughout domain logic.

## Dependency change rules

When Codex adds a dependency:

1. Add it only to the service/package that owns the need.
2. Explain why an existing dependency/standard library is insufficient.
3. Update and commit the lockfile.
4. Run the owning service's tests and vulnerability/license checks configured by the repo.
5. Avoid unmaintained packages for security/auth/parsing boundaries.
6. For major infrastructure dependencies, update `docs/architecture.md` or `docs/service-boundaries.md` if ownership or operations change.

The opt-in multi-paper workflow uses `langgraph==1.2.24` in Agent Orchestrator
only. Its explicit branches coordinate per-paper retrieval and evidence checks;
existing Pydantic/HTTPX calls continue to own model/API validation. Graph state,
leases and approval remain in the Orchestrator's PostgreSQL schema, using JSON
snapshots rather than a second checkpoint authority. No LangSmith credentials
or tracing endpoint are configured. See the [workflow API](https://docs.langchain.com/oss/python/langgraph/workflows-agents).

Adaptive flashcards use `fsrs==6.3.3` only in Artifact Service. The library
implements FSRS scheduling; the service owns UTC clocks, user scoping, replay
keys and concurrency versions. No optimizer extras or ML runtime are installed.
