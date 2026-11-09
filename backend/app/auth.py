"""Email/password accounts with cookie sessions.

Passwords are hashed with Argon2. Signing in creates a random session token,
sent to the browser in an HttpOnly, SameSite=Lax cookie; the database keeps
only the token's SHA-256, so a leaked database can't be used to sign in.
SameSite=Lax plus JSON-only request bodies keep other sites from making
authenticated requests (the API has no CORS, so cross-site JSON is blocked).
"""

import hashlib
import re
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User, UserSession, utcnow
from app.schemas import CamelModel

SESSION_COOKIE = "prelegal_session"
SESSION_LIFETIME = timedelta(days=30)
EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

_hasher = PasswordHasher()
# Verified against when the email is unknown, so sign-in takes as long either way.
_DUMMY_HASH = _hasher.hash("prelegal-dummy-password")

router = APIRouter(prefix="/api/auth")


class Credentials(CamelModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, email: str) -> str:
        email = email.strip().lower()
        if not EMAIL_PATTERN.fullmatch(email):
            raise ValueError("enter a valid email address")
        return email


class UserOut(CamelModel):
    id: int
    email: str


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _start_session(session: Session, user: User, request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    session.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at <= utcnow()))
    session.add(UserSession(token_hash=_token_hash(token), user=user, expires_at=utcnow() + SESSION_LIFETIME))
    session.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.cookie_secure,
        path="/",
    )


def current_user(request: Request, session: Session = Depends(get_session)) -> User:
    """FastAPI dependency: the signed-in user, or 401."""
    token = request.cookies.get(SESSION_COOKIE)
    user = None
    if token:
        user = session.scalar(
            select(User)
            .join(UserSession)
            .where(UserSession.token_hash == _token_hash(token), UserSession.expires_at > utcnow())
        )
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


EMAIL_TAKEN = "An account with this email already exists. Sign in instead."


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(body: Credentials, request: Request, response: Response, session: Session = Depends(get_session)) -> User:
    if session.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise HTTPException(409, EMAIL_TAKEN)
    user = User(email=body.email, password_hash=_hasher.hash(body.password))
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        # Another sign-up for the same email won the race between the check and the insert.
        session.rollback()
        raise HTTPException(409, EMAIL_TAKEN)
    _start_session(session, user, request, response)
    return user


@router.post("/login", response_model=UserOut)
def login(body: Credentials, request: Request, response: Response, session: Session = Depends(get_session)) -> User:
    user = session.scalar(select(User).where(User.email == body.email))
    try:
        _hasher.verify(user.password_hash if user else _DUMMY_HASH, body.password)
    except (VerifyMismatchError, InvalidHashError):
        user = None
    if user is None:
        raise HTTPException(401, "Incorrect email or password.")
    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = _hasher.hash(body.password)
    _start_session(session, user, request, response)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, session: Session = Depends(get_session)) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        session.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> User:
    return user
