# Phase 09 — Administration and operations

Implement FR-10 and configured password recovery for FR-01. Admin routes aggregate account, audit, job, model and service views via service APIs. Auth owns account state and changes, revokes sessions on role or availability transitions, and issues single-use reset tokens over configured SMTP. Ingestion owns retry decisions and protects deleted jobs from restart.

Route browser actions through the gateway and require the current Admin session on every operation. Keep model secrets in environment configuration and expose operational settings without secret values. Verify ordinary users and disabled sessions are rejected, administrative changes are audited, retry cannot resurrect deleted data, and a password reset consumes a token once.
