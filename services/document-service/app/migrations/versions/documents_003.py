"""Preserve multi-region highlights and versioned EmbedPDF geometry."""
from alembic import op
revision = "documents_003"
down_revision = "documents_002"

def upgrade() -> None:
    op.execute("ALTER TABLE documents.annotations ADD COLUMN regions jsonb NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE documents.annotations ADD COLUMN embedpdf jsonb")

def downgrade() -> None:
    raise RuntimeError("Preserve personal annotations on rollback.")
