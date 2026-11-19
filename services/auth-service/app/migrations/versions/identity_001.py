"""Create account, session, and audit tables."""

from alembic import op

revision = "identity_001"
down_revision = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE identity.accounts (
            user_id uuid PRIMARY KEY,
            email text NOT NULL UNIQUE,
            password_hash text NOT NULL,
            role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN'))
        )
    """)
    op.execute("""
        CREATE TABLE identity.sessions (
            token_digest text PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES identity.accounts (user_id) ON DELETE CASCADE,
            expires_at timestamptz NOT NULL
        )
    """)
    op.execute("CREATE INDEX identity_sessions_user ON identity.sessions (user_id)")
    op.execute("CREATE INDEX identity_sessions_expiry ON identity.sessions (expires_at)")
    op.execute("""
        CREATE TABLE identity.audit (
            event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            occurred_at timestamptz NOT NULL DEFAULT now(),
            request_id uuid NOT NULL,
            actor_id uuid,
            action text NOT NULL,
            outcome text NOT NULL,
            target_id uuid
        )
    """)
    op.execute("GRANT INSERT, UPDATE ON identity.accounts TO rag_auth")
    op.execute("GRANT INSERT, DELETE ON identity.sessions TO rag_auth")
    op.execute("GRANT INSERT ON identity.audit TO rag_auth")


def downgrade() -> None:
    raise RuntimeError("Preserve identity records and use a forward migration.")
