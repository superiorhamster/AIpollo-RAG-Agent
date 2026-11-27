"""Store immutable proposal payloads and revision-bound terminal outcomes."""

from alembic import op

revision = "orchestration_009"
down_revision = "orchestration_008"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE orchestration.learning_plan_cards (
            workspace_id uuid NOT NULL,
            owner_id uuid NOT NULL,
            plan_id uuid NOT NULL,
            card_id uuid NOT NULL,
            kind text NOT NULL CHECK (kind IN ('edit', 'completion')),
            base_revision bigint NOT NULL CHECK (base_revision > 0),
            payload jsonb NOT NULL,
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'invalidated')),
            PRIMARY KEY (workspace_id, owner_id, card_id),
            FOREIGN KEY (workspace_id, owner_id, plan_id)
                REFERENCES orchestration.learning_plans(workspace_id, owner_id, plan_id)
        )
    """)
    op.execute("""
        CREATE INDEX learning_plan_pending_cards
        ON orchestration.learning_plan_cards(workspace_id, owner_id, plan_id) WHERE status='pending'
    """)
    op.execute("""
        GRANT SELECT, INSERT ON orchestration.learning_plan_cards TO rag_orchestration;
        GRANT UPDATE (status) ON orchestration.learning_plan_cards TO rag_orchestration
    """)


def downgrade() -> None:
    raise RuntimeError("Retain Learning Plan card history during rollback.")
