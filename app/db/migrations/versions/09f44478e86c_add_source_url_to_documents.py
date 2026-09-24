"""add source_url to documents

Revision ID: 09f44478e86c
Revises: c00dbf8cee75
Create Date: 2026-09-20 01:30:41.196166

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '09f44478e86c'
down_revision: Union[str, Sequence[str], None] = 'c00dbf8cee75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('documents', sa.Column('source_url', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('documents', 'source_url')
