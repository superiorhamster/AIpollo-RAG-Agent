"""Add private Learning Plan storage without changing legacy tables."""

from alembic import op

revision = "orchestration_007"
down_revision = "orchestration_006"


def upgrade() -> None:
    op.execute("""
        CREATE TABLE orchestration.learning_plans (
            workspace_id uuid NOT NULL,
            owner_id uuid NOT NULL,
            plan_id uuid NOT NULL,
            content_version bigint NOT NULL DEFAULT 1 CHECK (content_version > 0),
            state_revision bigint NOT NULL DEFAULT 1 CHECK (state_revision > 0),
            create_key uuid NOT NULL,
            create_hash text NOT NULL,
            blueprint jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            deleted_at timestamptz,
            PRIMARY KEY (workspace_id, owner_id, plan_id),
            UNIQUE (workspace_id, owner_id, create_key)
        )
    """)
    op.execute("""
        CREATE TABLE orchestration.learning_plan_versions (
            workspace_id uuid NOT NULL,
            owner_id uuid NOT NULL,
            plan_id uuid NOT NULL,
            content_version bigint NOT NULL CHECK (content_version > 0),
            content jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (workspace_id, owner_id, plan_id, content_version),
            FOREIGN KEY (workspace_id, owner_id, plan_id)
                REFERENCES orchestration.learning_plans (workspace_id, owner_id, plan_id)
        )
    """)
    op.execute("""
        CREATE TABLE orchestration.learning_plan_events (
            workspace_id uuid NOT NULL,
            owner_id uuid NOT NULL,
            event_id uuid NOT NULL,
            plan_id uuid NOT NULL,
            kind text NOT NULL,
            state_revision bigint NOT NULL CHECK (state_revision > 0),
            metadata jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (workspace_id, owner_id, event_id),
            FOREIGN KEY (workspace_id, owner_id, plan_id)
                REFERENCES orchestration.learning_plans (workspace_id, owner_id, plan_id)
        )
    """)
    op.execute("""
        CREATE INDEX learning_plan_events_recent
        ON orchestration.learning_plan_events (workspace_id, owner_id, created_at DESC, event_id DESC)
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE ON orchestration.learning_plans TO rag_orchestration")
    op.execute("""
        GRANT SELECT, INSERT ON orchestration.learning_plan_versions, orchestration.learning_plan_events
        TO rag_orchestration
    """)


def downgrade() -> None:
    raise RuntimeError("Learning Plan data is retained. Roll back by disabling the feature.")
