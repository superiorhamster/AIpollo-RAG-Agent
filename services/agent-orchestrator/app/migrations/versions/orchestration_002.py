"""Retain the context and parent of retried Ask turns."""

from alembic import op

revision = "orchestration_002"
down_revision = "orchestration_001"


def upgrade() -> None:
    op.execute("""
        ALTER TABLE orchestration.runs
          ADD COLUMN retry_of_run_id uuid REFERENCES orchestration.runs (run_id),
          ADD COLUMN history_snapshot jsonb,
          ADD CONSTRAINT ask_retry_parent CHECK (retry_of_run_id IS NULL OR interaction = 'ASK'),
          ADD CONSTRAINT ask_history_array CHECK (
            history_snapshot IS NULL OR (
              interaction = 'ASK' AND jsonb_typeof(history_snapshot) = 'array'
              AND jsonb_array_length(history_snapshot) <= 6
            )
          )
    """)


def downgrade() -> None:
    raise RuntimeError("Retain retry relationships and history snapshots for audit.")
