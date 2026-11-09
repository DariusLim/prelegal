"""Each user's saved documents: the draft and the chat that built it.

The frontend autosaves after every chat turn. A user only ever sees their own
documents: anyone else's id responds 404, as if it didn't exist.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.documents import DocumentLibrary
from app.drafting_chat import ChatMessage, Draft
from app.models import SavedDocument, User
from app.schemas import CamelModel

MAX_MESSAGES = 200

router = APIRouter(prefix="/api/documents")


def _clean_title(title: Optional[str]) -> Optional[str]:
    # A blank title means "derive it from the draft" again.
    return (title or "").strip() or None


class DocumentSummary(CamelModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: Optional[str]
    draft: Draft
    created_at: datetime
    updated_at: datetime


class DocumentOut(DocumentSummary):
    messages: List[ChatMessage]


class DocumentCreate(CamelModel):
    title: Optional[str] = Field(None, max_length=200)
    draft: Draft
    messages: List[ChatMessage] = Field(max_length=MAX_MESSAGES)

    _title = field_validator("title")(_clean_title)


class DocumentUpdate(CamelModel):
    """Only the fields sent are changed; `title: null` resets to the derived title."""

    title: Optional[str] = Field(None, max_length=200)
    draft: Optional[Draft] = None
    messages: Optional[List[ChatMessage]] = Field(None, max_length=MAX_MESSAGES)

    _title = field_validator("title")(_clean_title)


def _check_document_type(draft: Optional[Draft], request: Request) -> None:
    library: DocumentLibrary = request.app.state.library
    if draft is not None and draft.document_id is not None and draft.document_id not in library.by_id:
        raise HTTPException(422, "Unknown document type.")


def _owned(document_id: int, user: User, session: Session) -> SavedDocument:
    document = session.scalar(
        select(SavedDocument).where(SavedDocument.id == document_id, SavedDocument.user_id == user.id)
    )
    if document is None:
        raise HTTPException(404, "Document not found.")
    return document


def _dump(model: CamelModel):
    return model.model_dump(by_alias=True)


@router.get("", response_model=List[DocumentSummary])
def list_documents(user: User = Depends(current_user), session: Session = Depends(get_session)):
    return list(
        session.scalars(
            select(SavedDocument)
            .where(SavedDocument.user_id == user.id)
            .order_by(SavedDocument.updated_at.desc(), SavedDocument.id.desc())
        )
    )


@router.post("", response_model=DocumentOut, status_code=201)
def create_document(
    body: DocumentCreate,
    request: Request,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
):
    _check_document_type(body.draft, request)
    document = SavedDocument(
        user=user,
        title=body.title,
        draft=_dump(body.draft),
        messages=[_dump(m) for m in body.messages],
    )
    session.add(document)
    session.commit()
    return document


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    return _owned(document_id, user, session)


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: int,
    body: DocumentUpdate,
    request: Request,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
):
    document = _owned(document_id, user, session)
    _check_document_type(body.draft, request)
    if "title" in body.model_fields_set:
        document.title = body.title
    if body.draft is not None:
        document.draft = _dump(body.draft)
    if body.messages is not None:
        document.messages = [_dump(m) for m in body.messages]
    session.commit()
    return document


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    session.delete(_owned(document_id, user, session))
    session.commit()
