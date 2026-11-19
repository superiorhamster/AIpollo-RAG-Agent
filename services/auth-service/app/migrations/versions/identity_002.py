"""Replace opaque sessions with revocable JWT sessions and refresh history."""

from alembic import op

revision = "identity_002"
down_revision = "identity_001"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE identity.auth_sessions (
            session_id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES identity.accounts (user_id) ON DELETE CASCADE,
            expires_at timestamptz NOT NULL,
            revoked_at timestamptz
        )
    """)
    op.execute("CREATE INDEX auth_sessions_user ON identity.auth_sessions (user_id)")
    op.execute("CREATE INDEX auth_sessions_expiry ON identity.auth_sessions (expires_at)")
    op.execute("""
        CREATE TABLE identity.refresh_tokens (
            token_digest text PRIMARY KEY,
            session_id uuid NOT NULL REFERENCES identity.auth_sessions (session_id) ON DELETE CASCADE,
            consumed_at timestamptz
        )
    """)
    op.execute("CREATE INDEX refresh_tokens_session ON identity.refresh_tokens (session_id)")
    op.execute("""
        CREATE UNIQUE INDEX refresh_tokens_active ON identity.refresh_tokens (session_id)
        WHERE consumed_at IS NULL
    """)
    op.execute("GRANT INSERT, UPDATE, DELETE ON identity.auth_sessions TO rag_auth")
    op.execute("GRANT INSERT, UPDATE ON identity.refresh_tokens TO rag_auth")
    op.execute("DELETE FROM identity.sessions")


def downgrade() -> None:
    op.execute("DROP TABLE identity.refresh_tokens")
    op.execute("DROP TABLE identity.auth_sessions")
