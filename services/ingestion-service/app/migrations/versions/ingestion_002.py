"""Publish active chunk generations and persist vector cleanup requests."""

from alembic import op

revision = "ingestion_002"
down_revision = "ingestion_001"


def upgrade() -> None:
    op.execute("""
        ALTER TABLE ingestion.jobs
            ADD COLUMN index_generation uuid,
            ADD COLUMN embedding_fingerprint text
    """)
    op.execute("CREATE INDEX ingestion_index_jobs ON ingestion.jobs (status, next_attempt) WHERE kind = 'index'")
    op.execute("""
        CREATE TABLE ingestion.index_cleanup (
            cleanup_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            document_id uuid,
            request_id uuid NOT NULL,
            attempts integer NOT NULL DEFAULT 0,
            next_attempt timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("GRANT INSERT, UPDATE, DELETE ON ingestion.index_cleanup TO rag_ingestion")


def downgrade() -> None:
    raise RuntimeError("Retain published generations and cleanup history for rollback.")
