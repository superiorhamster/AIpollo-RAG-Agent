"""Persist private selection independently for each conversation."""

from alembic import op

revision = "orchestration_008"
down_revision = "orchestration_007"


def upgrade() -> None:
    op.execute("""
        ALTER TABLE orchestration.conversations
            ADD COLUMN selected_learning_plan_id uuid,
            ADD COLUMN selection_revision bigint NOT NULL DEFAULT 0 CHECK (selection_revision >= 0),
            ADD CONSTRAINT conversation_learning_plan_owner
                FOREIGN KEY (workspace_id, user_id, selected_learning_plan_id)
                REFERENCES orchestration.learning_plans(workspace_id, owner_id, plan_id)
    """)
    op.execute("""
        GRANT UPDATE (selected_learning_plan_id, selection_revision)
        ON orchestration.conversations TO rag_orchestration
    """)


def downgrade() -> None:
    raise RuntimeError("Retain Learning Plan selections during rollback.")
