"""HTTP API. Every route lives under /api, which the frontend proxies to."""

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Template
from app.schemas import Health, TemplateOut

router = APIRouter(prefix="/api")


@router.get("/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    session.execute(text("SELECT 1"))
    return Health(status="ok", database="ok")


@router.get("/templates", response_model=List[TemplateOut])
def list_templates(session: Session = Depends(get_session)) -> List[Template]:
    return list(session.scalars(select(Template).order_by(Template.id)))
