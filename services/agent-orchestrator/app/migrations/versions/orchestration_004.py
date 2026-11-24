"""Retain the workflow wall-clock deadline across worker restarts."""
from alembic import op

revision = "orchestration_004"
down_revision = "orchestration_003"


def upgrade() -> None:
    op.execute("ALTER TABLE orchestration.runs ADD COLUMN execution_started_at timestamptz")


def downgrade() -> None:
    raise RuntimeError("Preserve execution deadline audit data.")
