"""Record durable indexing and DOCX preview jobs."""

from alembic import op

revision = "ingestion_001"
down_revision = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE ingestion.jobs (
            job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id uuid NOT NULL,
            document_id uuid NOT NULL,
            request_id uuid NOT NULL,
            kind text NOT NULL CHECK (kind IN ('index', 'preview')),
            status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
            attempts integer NOT NULL DEFAULT 0,
            next_attempt timestamptz NOT NULL DEFAULT now(),
            lease_id uuid,
            lease_until timestamptz,
            error_code text,
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (document_id, kind)
        )
    """)
    op.execute("CREATE INDEX ingestion_preview_jobs ON ingestion.jobs (status, next_attempt) WHERE kind = 'preview'")
    op.execute("CREATE INDEX ingestion_jobs_workspace ON ingestion.jobs (workspace_id)")
    op.execute("CREATE TABLE ingestion.cancelled_workspaces (workspace_id uuid PRIMARY KEY)")
    op.execute("CREATE TABLE ingestion.cancelled_documents (document_id uuid PRIMARY KEY)")
    op.execute("GRANT INSERT, UPDATE ON ingestion.jobs TO rag_ingestion")
    op.execute("GRANT INSERT ON ingestion.cancelled_workspaces, ingestion.cancelled_documents TO rag_ingestion")


def downgrade() -> None:
    raise RuntimeError("Retain job history for rollback.")
