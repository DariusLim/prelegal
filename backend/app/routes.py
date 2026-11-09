"""HTTP API. Every route lives under /api, which the frontend proxies to."""

import json
import logging
from typing import Any, Dict, Iterator, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.documents import DocumentLibrary
from app.drafting_chat import ChatRequest, ReplyText, stream_turn
from app.llm import LLMError, OpenRouterClient
from app.models import Template, User
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


def _ndjson(event: Dict[str, Any]) -> bytes:
    return (json.dumps(event) + "\n").encode()


@router.post("/chat")
def chat(
    body: ChatRequest,
    _user: User = Depends(current_user),
    llm: Optional[OpenRouterClient] = Depends(get_llm),
    library: DocumentLibrary = Depends(get_library),
) -> StreamingResponse:
    """One turn of the drafting chat, streamed as newline-delimited JSON events:

    - `{"type": "delta", "text": ...}` appends to the reply shown so far,
    - `{"type": "reset", "text": ...}` replaces it,
    - then `{"type": "done", "turn": {reply, documentId?, fields, party1?, party2?}}`
      with the final reply and the document changes,
    - or `{"type": "error", "detail": ...}` if the turn failed after streaming began.
    """
    if llm is None:
        raise HTTPException(503, "The AI assistant isn't configured: set OPENROUTER_API_KEY in .env.")

    def events() -> Iterator[bytes]:
        try:
            for item in stream_turn(llm, library, body):
                if isinstance(item, ReplyText):
                    yield _ndjson({"type": "reset" if item.reset else "delta", "text": item.text})
                else:
                    turn = item.model_dump(by_alias=True, exclude_none=True)
                    yield _ndjson({"type": "done", "turn": turn})
        except (LLMError, ValidationError):
            logger.exception("Drafting chat turn failed")
            yield _ndjson({"type": "error", "detail": "The AI assistant couldn't respond. Please try again."})

    # X-Accel-Buffering: proxies (nginx) shouldn't hold the stream back.
    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
