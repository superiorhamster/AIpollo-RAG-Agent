"""Personal FSRS state and replay-safe review history; shared artifacts stay unchanged."""
from alembic import op
revision = 'artifacts_002'
down_revision = 'artifacts_001'


def upgrade() -> None:
    op.execute('''
        CREATE TABLE artifacts.card_states (
            artifact_id uuid NOT NULL REFERENCES artifacts.items (artifact_id) ON DELETE CASCADE,
            user_id uuid NOT NULL,
            card_id uuid NOT NULL,
            version integer NOT NULL CHECK (version>=1),
            schedule jsonb NOT NULL,
            due timestamptz NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (artifact_id,user_id,card_id)
        )
    ''')
    op.execute('''
        CREATE TABLE artifacts.card_reviews (
            artifact_id uuid NOT NULL REFERENCES artifacts.items (artifact_id) ON DELETE CASCADE,
            user_id uuid NOT NULL,
            request_key uuid NOT NULL,
            card_id uuid NOT NULL,
            request_hash text NOT NULL,
            rating integer NOT NULL CHECK (rating BETWEEN 1 AND 4),
            reviewed_at timestamptz NOT NULL,
            result jsonb NOT NULL,
            PRIMARY KEY (user_id,request_key)
        )
    ''')
    op.execute('CREATE INDEX card_states_due ON artifacts.card_states (user_id,due)')
    op.execute('GRANT SELECT, INSERT, UPDATE ON artifacts.card_states TO rag_artifacts')
    op.execute('GRANT SELECT, INSERT ON artifacts.card_reviews TO rag_artifacts')


def downgrade() -> None:
    raise RuntimeError('Preserve private learning progress and review history.')
