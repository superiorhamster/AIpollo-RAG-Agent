"""Durable, bounded read-only curriculum generation before plan acceptance."""
from alembic import op

revision = "orchestration_005"
down_revision = "orchestration_004"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE orchestration.plan_drafts (
            plan_id uuid NOT NULL,
            version integer NOT NULL,
            days integer NOT NULL CHECK (days BETWEEN 1 AND 6),
            status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
            error_code text,
            attempts integer NOT NULL DEFAULT 0,
            lease_id uuid,
            lease_until timestamptz,
            started_at timestamptz,
            cost_reserved bigint NOT NULL DEFAULT 0 CHECK (cost_reserved >= 0),
            next_attempt_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (plan_id, version),
            FOREIGN KEY (plan_id, version) REFERENCES orchestration.plan_versions (plan_id, version)
        )
    """)
    op.execute("CREATE INDEX plan_drafts_pending ON orchestration.plan_drafts (next_attempt_at) WHERE status IN ('queued','running')")
    op.execute("GRANT SELECT, INSERT, UPDATE ON orchestration.plan_drafts TO rag_orchestration")
    op.execute("GRANT UPDATE (workflow) ON orchestration.plan_versions TO rag_orchestration")


def downgrade() -> None:
    raise RuntimeError("Preserve curriculum generation and approval audit data.")
