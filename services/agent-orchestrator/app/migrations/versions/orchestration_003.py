"""Persist the reviewed workflow and recoverable per-run progress."""
from alembic import op

revision = "orchestration_003"
down_revision = "orchestration_002"


def upgrade() -> None:
    op.execute("ALTER TABLE orchestration.runs ADD COLUMN cost_reserved bigint NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE orchestration.plan_versions ADD COLUMN workflow jsonb")
    op.execute("""
        CREATE TABLE orchestration.run_steps (
            run_id uuid NOT NULL REFERENCES orchestration.runs,
            step_id uuid NOT NULL,
            position integer NOT NULL CHECK (position BETWEEN 0 AND 5),
            status text NOT NULL CHECK (status IN ('running','succeeded')),
            result jsonb,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (run_id, step_id),
            UNIQUE (run_id, position)
        )
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE ON orchestration.run_steps TO rag_orchestration")


def downgrade() -> None:
    raise RuntimeError("Preserve approved workflows and completed step records.")
