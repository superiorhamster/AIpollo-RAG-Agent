"""Add durable workspace deletion requests."""

from alembic import op

revision = "workspace_002"
down_revision = "workspace_001"


def upgrade() -> None:
    op.execute("ALTER TABLE workspace.workspaces ADD COLUMN deleting_at timestamptz")
    op.execute("""
        CREATE TABLE workspace.outbox (
            event_id uuid PRIMARY KEY,
            event_type text NOT NULL,
            payload jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("GRANT INSERT, UPDATE, DELETE ON workspace.outbox TO rag_workspace")


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM workspace.workspaces WHERE deleting_at IS NOT NULL) THEN
                RAISE EXCEPTION 'Finish workspace deletions before downgrading';
            END IF;
        END $$
    """)
    op.execute("DROP TABLE workspace.outbox")
    op.execute("ALTER TABLE workspace.workspaces DROP COLUMN deleting_at")
