"""FastAPI application entry point (`uvicorn app.main:app`)."""

from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import Settings
from app.db import Base, create_db_engine
from app.routes import router
from app.seed import seed_templates


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings.database_url)
        Base.metadata.create_all(engine)
        app.state.session_factory = sessionmaker(engine, expire_on_commit=False)
        with app.state.session_factory() as session:
            seed_templates(session, settings.catalog_path)
        yield
        engine.dispose()

    app = FastAPI(title="prelegal API", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()
