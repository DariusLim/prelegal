"""HTTP API. Every route lives under /api, which the frontend proxies to."""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import get_session
from app.documents import DocumentLibrary
from app.drafting_chat import ChatRequest, ChatResponse, next_turn
from app.llm import LLMError, OpenRouterClient
from app.models import Template
from app.schemas import Health, TemplateOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def get_llm(request: Request) -> Optional[OpenRouterClient]:
    """FastAPI dependency: the app's LLM client, or None when no API key is configured."""
    return request.app.state.llm


def get_library(request: Request) -> DocumentLibrary:
    """FastAPI dependency: the document types loaded at startup."""
    return request.app.state.library


@router.get("/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    session.execute(text("SELECT 1"))
    return Health(status="ok", database="ok")


@router.get("/templates", response_model=List[TemplateOut])
def list_templates(session: Session = Depends(get_session)) -> List[Template]:
    return list(session.scalars(select(Template).order_by(Template.id)))


@router.post("/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(
    body: ChatRequest,
    llm: Optional[OpenRouterClient] = Depends(get_llm),
    library: DocumentLibrary = Depends(get_library),
) -> ChatResponse:
    """One turn of the drafting chat: the assistant's reply plus any document changes."""
    if llm is None:
        raise HTTPException(503, "The AI assistant isn't configured: set OPENROUTER_API_KEY in .env.")
    try:
        return next_turn(llm, library, body)
    except (LLMError, ValidationError):
        logger.exception("Drafting chat turn failed")
        raise HTTPException(502, "The AI assistant couldn't respond. Please try again.")
