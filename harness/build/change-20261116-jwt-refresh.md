# Access JWT and rotating refresh sessions

## Goal and requirements

Update FR-01 to issue five-minute access JWTs and rotating refresh tokens with a twelve-hour absolute session lifetime. Keep Argon2id and the current platform roles and workspace ACLs.

## Scope and current behavior

Auth stores hashed opaque sessions in PostgreSQL. Update Auth storage, gateway and Workspace credential forwarding, browser renewal, the public contract, and Compose verification.

## Design and security

Auth alone signs and verifies HS256 tokens with a generated secret. Protected requests check current session and account state in PostgreSQL. Refresh tokens are random and only their digests persist. Rotate under a session lock and revoke the session on reuse. Cookies are HttpOnly and refresh is scoped to the Auth routes with the gateway's existing Origin check. The browser serializes renewal and retries protected requests at most once.

## Migration and rollback

Apply identity_002 before starting the updated Auth service. Existing opaque sessions are invalidated. Keep accounts and workspace data. Rollback returns to identity_001 and requires a fresh login.

## Implementation and verification

1. Add Auth migration, signing configuration, and session handling.
2. Update routing, browser renewal, and the contract.
3. Run make check, make compose-check, make verify-phase01, make bootstrap, and git diff --check when Git metadata is available.

## Acceptance

Verify token expiry and claim checks, concurrent refresh, reuse, revocation, authorization, automatic browser renewal, and an upgrade preserving a pre-existing account.
