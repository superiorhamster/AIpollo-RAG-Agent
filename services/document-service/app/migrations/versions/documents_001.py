"""Create document reservations, workspace deletion markers and the outbox."""

from alembic import op

revision = "documents_001"
down_revision = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE documents.items (
            document_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            actor_id uuid NOT NULL,
            idempotency_key uuid NOT NULL,
            filename text NOT NULL,
            name text NOT NULL,
            media_type text NOT NULL,
            size_bytes integer NOT NULL,
            sha256 text NOT NULL,
            state text NOT NULL CHECK (state IN ('uploading', 'ready', 'deleting', 'deleted')),
            preview_ready boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            cleanup_attempts integer NOT NULL DEFAULT 0,
            cleanup_after timestamptz NOT NULL DEFAULT now(),
            UNIQUE (workspace_id, actor_id, idempotency_key)
        )
    """)
    op.execute("CREATE INDEX documents_workspace ON documents.items (workspace_id, state, created_at)")
    op.execute("CREATE INDEX documents_cleanup ON documents.items (cleanup_after) WHERE state = 'deleting'")
    op.execute("""
        CREATE TABLE documents.workspace_deletions (
            workspace_id uuid PRIMARY KEY,
            actor_id uuid NOT NULL,
            request_id uuid NOT NULL,
            confirmed_at timestamptz
        )
    """)
    op.execute("""
        CREATE TABLE documents.outbox (
            event_id uuid PRIMARY KEY,
            event_type text NOT NULL,
            payload jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("GRANT INSERT, UPDATE ON documents.items, documents.workspace_deletions TO rag_documents")
    op.execute("GRANT INSERT, UPDATE, DELETE ON documents.outbox TO rag_documents")


def downgrade() -> None:
    raise RuntimeError("Retain document metadata and the bucket for rollback.")
