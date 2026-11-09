"""FastAPI application entry point (`uvicorn app.main:app`)."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import Settings
from app.db import Base, create_db_engine
from app.documents import load_library
from app.llm import OpenRouterClient
from app.routes import router
from app.seed import seed_templates

logger = logging.getLogger(__name__)


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings.database_url)
        Base.metadata.create_all(engine)
        app.state.session_factory = sessionmaker(engine, expire_on_commit=False)
        with app.state.session_factory() as session:
            seed_templates(session, settings.catalog_path)

        app.state.library = load_library(settings.document_types_path)

        if settings.openrouter_api_key:
            app.state.llm = OpenRouterClient(settings.openrouter_api_key, settings.openrouter_models)
        else:
            app.state.llm = None
            logger.warning("OPENROUTER_API_KEY is not set; /api/chat will respond 503")

        yield

        if app.state.llm is not None:
            app.state.llm.close()
        engine.dispose()

    app = FastAPI(title="prelegal API", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()
