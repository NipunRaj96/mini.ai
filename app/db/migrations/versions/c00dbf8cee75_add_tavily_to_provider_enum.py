"""add tavily to provider enum

Revision ID: c00dbf8cee75
Revises: 8e9e151aa93f
Create Date: 2026-09-20 01:25:50.000233

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c00dbf8cee75'
down_revision: Union[str, Sequence[str], None] = '8e9e151aa93f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ponytail: ADD VALUE, not drop/recreate the enum type — recreating would
    # fail (type in use by provider_keys.provider) or lose data.
    # Label must be the Python enum MEMBER NAME ('TAVILY'), not .value
    # ('tavily') — SQLAlchemy's Enum(PyEnum, ...) stores .name by default,
    # as every existing label in this type already does (GROQ, ANTHROPIC, ...).
    op.execute("ALTER TYPE provider_enum ADD VALUE IF NOT EXISTS 'TAVILY'")


def downgrade() -> None:
    """Downgrade schema."""
    # ponytail: Postgres can't drop a single enum value. Leaving 'tavily' in
    # place on downgrade is a known, accepted no-op (same tradeoff as other
    # enum-add migrations in this repo).
    pass
