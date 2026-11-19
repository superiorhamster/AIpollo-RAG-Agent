"""Create workspace, membership, create receipt, and audit tables."""

from alembic import op

revision = "workspace_001"
down_revision = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE workspace.workspaces (
            workspace_id uuid PRIMARY KEY,
            owner_id uuid NOT NULL,
            name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120)
        )
    """)
    op.execute("CREATE INDEX workspaces_owner ON workspace.workspaces (owner_id)")
    op.execute("""
        CREATE TABLE workspace.memberships (
            workspace_id uuid NOT NULL REFERENCES workspace.workspaces (workspace_id) ON DELETE CASCADE,
            user_id uuid NOT NULL,
            role text NOT NULL CHECK (role IN ('VIEWER', 'EDITOR')),
            PRIMARY KEY (workspace_id, user_id)
        )
    """)
    op.execute("CREATE INDEX memberships_user ON workspace.memberships (user_id, workspace_id)")
    op.execute("""
        CREATE TABLE workspace.create_receipts (
            actor_id uuid NOT NULL,
            idempotency_key uuid NOT NULL,
            workspace_id uuid NOT NULL,
            name text NOT NULL,
            PRIMARY KEY (actor_id, idempotency_key)
        )
    """)
    op.execute("""
        CREATE TABLE workspace.audit (
            event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            occurred_at timestamptz NOT NULL DEFAULT now(),
            request_id uuid NOT NULL,
            actor_id uuid NOT NULL,
            action text NOT NULL,
            outcome text NOT NULL,
            workspace_id uuid NOT NULL,
            target_user_id uuid
        )
    """)
    op.execute("GRANT INSERT, UPDATE, DELETE ON workspace.workspaces, workspace.memberships TO rag_workspace")
    op.execute("GRANT INSERT ON workspace.create_receipts, workspace.audit TO rag_workspace")


def downgrade() -> None:
    raise RuntimeError("Preserve workspace records and use a forward migration.")
