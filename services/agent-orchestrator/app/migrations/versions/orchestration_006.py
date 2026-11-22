"""Lease-fenced research graph progress, kept with the accepted run snapshot."""
from alembic import op
revision = "orchestration_006"
down_revision = "orchestration_005"


def upgrade() -> None:
    op.execute("ALTER TABLE orchestration.runs ADD COLUMN output_tokens_reserved integer NOT NULL DEFAULT 0, ADD COLUMN model_calls integer NOT NULL DEFAULT 0, ADD COLUMN research_searches integer NOT NULL DEFAULT 0, ADD COLUMN research_gap_searches integer NOT NULL DEFAULT 0")
    op.execute("""
        CREATE TABLE orchestration.research_progress (
            run_id uuid NOT NULL REFERENCES orchestration.runs (run_id),
            scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
            state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (run_id, scope)
        )
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE ON orchestration.research_progress TO rag_orchestration")


def downgrade() -> None:
    raise RuntimeError("Preserve research evidence and run progress.")
