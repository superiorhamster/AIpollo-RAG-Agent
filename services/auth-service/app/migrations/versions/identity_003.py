"""Add account suspension and single-use password recovery."""

from alembic import op

revision = "identity_003"
down_revision = "identity_002"


def upgrade() -> None:
    op.execute("ALTER TABLE identity.accounts ADD COLUMN disabled_at timestamptz")
    op.execute("""
        CREATE TABLE identity.password_resets (
            user_id uuid PRIMARY KEY REFERENCES identity.accounts ON DELETE CASCADE,
            token_digest text NOT NULL UNIQUE,
            expires_at timestamptz NOT NULL
        )
    """)
    op.execute("GRANT UPDATE (disabled_at, password_hash) ON identity.accounts TO rag_auth")
    op.execute("GRANT INSERT, UPDATE, DELETE ON identity.password_resets TO rag_auth")


def downgrade() -> None:
    raise RuntimeError("Preserve account suspension and credential state on rollback.")
