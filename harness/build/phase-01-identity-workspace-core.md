# Phase 01 — Identity and Workspace Core

## Goal

Users can register, sign in, and manage workspaces in the web app. Owners can grant or revoke Viewer and Editor access for existing accounts.

## Requirements

FR-01 and FR-02, server-side User/Admin authorization, tenant isolation, audit records, maintainability, and containerized development.

## Scope

Web, API Gateway, Auth, Workspace, public contracts, PostgreSQL provisioning and migrations, Compose development tooling, and CI verification.

## Non-goals

Account recovery and verification email, ownership transfer, admin management screens, document workflows, and production deployment.

## Current behavior

Phase 00 exposes the web placeholder and operational HTTP endpoints. PostgreSQL and Redis run in Compose. The application services have no persistent data models.

## Proposed design

Use gateway `/v1` routes for auth and workspaces. The browser uses a same-origin web relay. Auth owns Argon2id credentials, opaque revocable database sessions, platform roles, and auth audits. Workspace resolves the live session through a token-authenticated internal Auth API and owns ACLs, workspaces, create receipts, and workspace audits. Use the versioned identity/workspace contract for route names, errors, and permission behavior.

## Security and tenancy impact

Workspace access comes from owner or membership records for the authenticated account. Only owners manage ACLs and delete. Owners and editors rename. Viewers read. Admin carries no implicit membership. Protect browser mutations with exact-origin checks and use Redis throttling on registration and login. Restrict database credentials to each service schema. Record mutations and their audits in one transaction and avoid credentials and private input in logs.

## Migration and rollback

Provision separately credentialed Auth and Workspace schemas against the existing Compose PostgreSQL database. Run service-owned Alembic migrations before startup. Preserve schemas and data if rolling application services back to Phase 00. Verify both fresh initialization and an upgrade on an existing PostgreSQL volume.

## Implementation steps

1. Document the OpenAPI contract and add service schema provisioning and migrations.
2. Implement Auth, Workspace, public gateway routing, and the web client.
3. Integrate Compose health and dependency checks, operator commands, and containerized test runners.
4. Execute API, database, browser, startup, and diff checks.

## Verification

Run `make check`, `make compose-check`, `make infra-up`, `make infra-ps`, `make verify-infra`, `make bootstrap`, `make verify-phase01`, and `git diff --check` when repository metadata is available. Repeat bootstrap using both a fresh volume and a pre-existing infrastructure volume in isolated Compose projects.

## Acceptance criteria

The browser supports signup, login, logout, workspace create, rename, deletion, and owner-managed sharing. Server checks deny outsiders, unauthorized roles, expired or revoked sessions, forged identity headers, and cross-origin writes. Replayed creates return the original result. Successful audit records persist with their mutations. The full environment starts from `make bootstrap` and the suite passes in Compose.

## Open questions

None.
