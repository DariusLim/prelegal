"""Alembic environment.

The app passes its own connection in `config.attributes["connection"]` (see
app/db.py: migrate). From the CLI, the database comes from Settings
(DATABASE_URL or the default SQLite file).
"""

from logging.config import fileConfig

from alembic import context

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import Settings
from app.db import Base, create_db_engine

config = context.config
target_metadata = Base.metadata


def run_migrations(connection) -> None:
    # render_as_batch: SQLite can only ALTER tables by copying them.
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


connection = config.attributes.get("connection")
if connection is not None:
    run_migrations(connection)
else:
    if config.config_file_name is not None:
        fileConfig(config.config_file_name)
    engine = create_db_engine(Settings().database_url)
    with engine.connect() as conn:
        run_migrations(conn)
    engine.dispose()
