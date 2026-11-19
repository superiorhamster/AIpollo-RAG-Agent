"""Own reusable workspace artifacts and citation-bearing output."""

from alembic import op

revision = "artifacts_001"
down_revision = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE artifacts.items (
            artifact_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            user_id uuid NOT NULL,
            run_id uuid NOT NULL,
            name text NOT NULL,
            kind text NOT NULL,
            body jsonb NOT NULL,
            source_ids uuid[] NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (workspace_id, run_id)
        )
    """)
    op.execute("CREATE INDEX artifacts_items_workspace ON artifacts.items (workspace_id, created_at DESC)")
    op.execute("GRANT INSERT, UPDATE, DELETE ON artifacts.items TO rag_artifacts")


def downgrade() -> None:
    raise RuntimeError("Preserve shared artifacts on rollback.")
