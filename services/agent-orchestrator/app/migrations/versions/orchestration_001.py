"""Persist private conversations, approved plan versions, and bounded runs."""

from alembic import op

revision = "orchestration_001"
down_revision = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE orchestration.conversations (
            conversation_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            user_id uuid NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE orchestration.plans (
            plan_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            user_id uuid NOT NULL,
            current_version integer NOT NULL DEFAULT 1,
            cancelled boolean NOT NULL DEFAULT false,
            request_id uuid NOT NULL,
            request_key uuid NOT NULL,
            request_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (workspace_id, user_id, request_key)
        )
    """)
    op.execute("""
        CREATE TABLE orchestration.plan_versions (
            plan_id uuid NOT NULL REFERENCES orchestration.plans,
            version integer NOT NULL,
            input jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (plan_id, version)
        )
    """)
    op.execute("""
        CREATE TABLE orchestration.acceptances (
            plan_id uuid NOT NULL,
            version integer NOT NULL,
            user_id uuid NOT NULL,
            request_key uuid NOT NULL,
            accepted_at timestamptz NOT NULL DEFAULT now(),
            FOREIGN KEY (plan_id, version) REFERENCES orchestration.plan_versions,
            PRIMARY KEY (plan_id, version),
            UNIQUE (plan_id, request_key)
        )
    """)
    op.execute("""
        CREATE TABLE orchestration.runs (
            run_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            user_id uuid NOT NULL,
            interaction text NOT NULL CHECK (interaction IN ('ASK', 'AGENT', 'PLAN')),
            input jsonb NOT NULL,
            conversation_id uuid REFERENCES orchestration.conversations,
            plan_id uuid,
            plan_version integer,
            request_id uuid NOT NULL,
            request_key uuid NOT NULL,
            request_hash text NOT NULL,
            status text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
            step text,
            result jsonb,
            error_code text,
            attempts integer NOT NULL DEFAULT 0,
            lease_id uuid,
            lease_until timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            FOREIGN KEY (plan_id, plan_version) REFERENCES orchestration.acceptances (plan_id, version),
            CHECK ((plan_id IS NULL) = (plan_version IS NULL)),
            UNIQUE (workspace_id, user_id, request_key)
        )
    """)
    op.execute("CREATE INDEX orchestration_runnable ON orchestration.runs (status, created_at)")
    op.execute("CREATE INDEX orchestration_conversation_runs ON orchestration.runs (conversation_id, created_at)")
    op.execute("""
        GRANT INSERT ON orchestration.conversations, orchestration.plan_versions, orchestration.acceptances
        TO rag_orchestration
    """)
    op.execute("GRANT INSERT, UPDATE ON orchestration.plans, orchestration.runs TO rag_orchestration")


def downgrade() -> None:
    raise RuntimeError("Preserve approved plan revisions and run audit records on rollback.")
