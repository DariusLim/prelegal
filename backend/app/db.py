"""SQLAlchemy engine/session setup and migrations."""

from pathlib import Path
from typing import Iterator

from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Base(DeclarativeBase):
    pass


def create_db_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    connect_args = {}
    sqlite = url.get_backend_name() == "sqlite"
    if sqlite:
        # FastAPI may serve a request's dependencies and handler on different threads.
        connect_args["check_same_thread"] = False
        if url.database and url.database != ":memory:":
            Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url, connect_args=connect_args)
    if sqlite:
        # SQLite ignores foreign keys (and ON DELETE CASCADE) unless asked per connection.
        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record) -> None:
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

    return engine


def migrate(engine: Engine) -> None:
    """Brings the database schema up to date (backend/migrations)."""
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def get_session(request: Request) -> Iterator[Session]:
    """FastAPI dependency yielding a session bound to the app's engine."""
    session_factory: sessionmaker[Session] = request.app.state.session_factory
    with session_factory() as session:
        yield session
