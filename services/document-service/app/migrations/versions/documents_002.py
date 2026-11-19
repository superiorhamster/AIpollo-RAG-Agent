"""Store per-user notes and highlights anchored to a document page."""

from alembic import op

revision = "documents_002"
down_revision = "documents_001"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE documents.annotations (
            annotation_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            document_id uuid NOT NULL REFERENCES documents.items,
            user_id uuid NOT NULL,
            page integer NOT NULL CHECK (page > 0),
            body text NOT NULL,
            region jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX annotations_scope ON documents.annotations (document_id, user_id, page)")
    op.execute("GRANT INSERT, UPDATE, DELETE ON documents.annotations TO rag_documents")


def downgrade() -> None:
    raise RuntimeError("Preserve annotations on rollback.")
