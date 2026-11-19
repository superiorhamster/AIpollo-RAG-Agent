"""Store curated bibliographic references in each workspace."""

from alembic import op

revision = "workspace_003"
down_revision = "workspace_002"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE workspace.reference_items (
            workspace_id uuid NOT NULL REFERENCES workspace.workspaces ON DELETE CASCADE,
            doi text NOT NULL,
            title text NOT NULL,
            authors jsonb NOT NULL,
            publication_year integer,
            tags jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (workspace_id, doi)
        )
    """)
    op.execute("GRANT INSERT, UPDATE, DELETE ON workspace.reference_items TO rag_workspace")


def downgrade() -> None:
    raise RuntimeError("Preserve curated bibliography data on rollback.")
