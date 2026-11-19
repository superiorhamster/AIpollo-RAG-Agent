# Phase 00 — Repository Foundation

## Goal

Developers can build, start, inspect, and verify the complete development stack from the repository root using Docker Compose and Make.

## Requirements

Phase 00 of the [execution plans](../../.codex/PLANS.md) and the Maintainability, Deployment, and health/readiness requirements in the [repository instructions](../../.codex/AGENTS.md) and [requirements baseline](../../.codex/docs/requirements-baseline.md). The baseline gives these non-functional requirements names without numeric IDs. FR-01 through FR-10 remain scheduled for later phases.

## Scope

- `apps/web` for the Next.js web client and `services/` for the ten FastAPI services listed in [service boundaries](../../.codex/docs/service-boundaries.md).
- Root Docker Compose, Make targets, environment example, verification scripts, CI, and developer documentation.
- `packages/contracts` for shared transport conventions and the health/readiness response schema.

## Non-goals

Identity, RBAC, tenant persistence, upload, ingestion, retrieval, orchestration, artifacts, provider integrations, and production deployment.

## Current behavior

The starter kit under `.codex/` supplies infrastructure-only Compose and Make commands for PostgreSQL, Redis, RabbitMQ, Qdrant, and MinIO. The workspace has no application source or CI workflow.

## Proposed design

Use one default Compose project with a build for each application. Containers discover services by Compose DNS. Publish the web client, gateway, and existing infrastructure developer ports on loopback. Give each Python service its own manifest and lockfile and reuse a Docker build recipe. HTTP services expose `/healthz` for liveness and `/readyz` for readiness. Startup requires no domain data stores or provider credentials. Smoke checks exercise both endpoints through Compose DNS and load the web home page. Build MinIO from its pinned upstream source release because Docker Hub denies access to the starter image. GitHub Actions runs the same bootstrap and verification commands as developers, checks both published application ports, and reports image vulnerabilities.

## Security and tenancy impact

The skeleton exposes operational status and the web home page. It handles no user data, and infra credentials are local placeholders. Internal application services have no published host ports. Keep `.env` and generated files out of Git and build contexts.

## Migration and rollback

Preserve the starter kit's Compose project name and infrastructure volume keys. `make down` stops and removes the local containers while retaining volumes. The skeleton introduces no schema or data migrations.

## Implementation steps

1. Scaffold the web client and independently locked Python services.
2. Wire application builds and health checks into Compose. Preserve the existing infrastructure commands at the root.
3. Document the operational contract and local workflow. Add smoke verification and CI.
4. Validate the resolved Compose model, application builds, health/readiness contracts, and diff hygiene.

## Verification

- `make check`, `make env`, and `make compose-check`.
- `make infra-up`, `make infra-ps`, and `make verify-infra`.
- `make bootstrap`, `make ps`, and `make verify`. Bootstrap builds and starts the full stack, waits for readiness, and runs smoke checks.
- `git diff --check` when repository metadata is available.

## Acceptance criteria

- `make bootstrap` starts five healthy infrastructure services, the web client, and all ten backend skeletons.
- The home page renders and each application returns the expected identity and status at both operational endpoints.
- Application images build from checked-in lockfiles. The same checks run in CI.
- Internal application services are reachable by Compose service name. The web and gateway are reachable through the documented development ports.

## Open questions

None.
