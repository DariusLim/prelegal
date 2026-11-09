import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app import auth
from app.auth import SESSION_COOKIE
from app.models import User, UserSession
from tests.conftest import PASSWORD, make_client, sign_up

PARTY = {"name": "", "title": "", "company": "", "noticeAddress": ""}


def draft(document_id=None, **fields):
    return {"documentId": document_id, "fields": fields, "party1": PARTY, "party2": {**PARTY, "company": "Globex"}}


MESSAGES = [{"role": "assistant", "content": "Hi!"}, {"role": "user", "content": "An NDA"}]


@pytest.fixture
def client(tmp_path: Path):
    with make_client(tmp_path) as c:
        yield c


# --- Accounts and sessions ------------------------------------------------------


def test_sign_up_signs_in_with_an_http_only_cookie(client: TestClient):
    response = client.post("/api/auth/signup", json={"email": " Ada@Example.com ", "password": PASSWORD})

    assert response.status_code == 201
    assert response.json() == {"id": 1, "email": "ada@example.com"}
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Max-Age=2592000" in cookie
    assert "Secure" not in cookie
    assert client.get("/api/auth/me").json() == {"id": 1, "email": "ada@example.com"}


def test_secure_cookie_when_configured(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("COOKIE_SECURE", "true")
    with make_client(tmp_path) as client:
        response = client.post("/api/auth/signup", json={"email": "a@b.co", "password": PASSWORD})
    assert "Secure" in response.headers["set-cookie"]


def test_duplicate_email_is_409(client: TestClient):
    sign_up(client)
    response = client.post("/api/auth/signup", json={"email": "ADA@example.com", "password": PASSWORD})
    assert response.status_code == 409


def test_duplicate_email_racing_past_the_check_is_409(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    # The competing sign-up lands while this one hashes its password, i.e. after the existence check.
    real_hasher = auth._hasher

    class RacingHasher:
        def hash(self, password: str) -> str:
            with client.app.state.session_factory() as other:
                other.add(User(email="ada@example.com", password_hash="x"))
                other.commit()
            return real_hasher.hash(password)

    monkeypatch.setattr(auth, "_hasher", RacingHasher())
    response = client.post("/api/auth/signup", json={"email": "ada@example.com", "password": PASSWORD})
    assert response.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email", "password": PASSWORD},
        {"email": "ada@example.com", "password": "short"},
        {"email": "ada@example.com", "password": "x" * 129},
        {"email": "ada@example.com"},
    ],
)
def test_invalid_sign_up_is_422(client: TestClient, body):
    assert client.post("/api/auth/signup", json=body).status_code == 422


def test_log_in_and_out(client: TestClient):
    sign_up(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    wrong = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "wrong password"})
    unknown = client.post("/api/auth/login", json={"email": "bob@example.com", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Incorrect email or password."}

    response = client.post("/api/auth/login", json={"email": "Ada@example.com", "password": PASSWORD})
    assert response.status_code == 200
    assert client.get("/api/auth/me").json()["email"] == "ada@example.com"


def test_logout_revokes_the_session_server_side(client: TestClient):
    sign_up(client)
    token = client.cookies[SESSION_COOKIE]
    client.post("/api/auth/logout")

    client.cookies.set(SESSION_COOKIE, token)  # a copy of the old cookie
    assert client.get("/api/auth/me").status_code == 401


def test_expired_and_forged_sessions_are_rejected(client: TestClient):
    sign_up(client)
    with client.app.state.session_factory() as session:
        session.execute(update(UserSession).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        session.commit()
    assert client.get("/api/auth/me").status_code == 401

    client.cookies.set(SESSION_COOKIE, "forged")
    assert client.get("/api/auth/me").status_code == 401


def test_only_token_hashes_and_password_hashes_are_stored(client: TestClient, tmp_path: Path):
    sign_up(client)
    token = client.cookies[SESSION_COOKIE]
    with sqlite3.connect(tmp_path / "test.db") as db:
        (stored_hash,) = db.execute("SELECT token_hash FROM sessions").fetchone()
        (password_hash,) = db.execute("SELECT password_hash FROM users").fetchone()
    assert stored_hash != token and len(stored_hash) == 64
    assert password_hash.startswith("$argon2") and PASSWORD not in password_hash


# --- Saved documents ------------------------------------------------------------


def test_documents_require_sign_in(client: TestClient):
    assert client.get("/api/documents").status_code == 401
    assert client.post("/api/documents", json={"draft": draft(), "messages": MESSAGES}).status_code == 401


def test_create_list_update_and_delete(client: TestClient):
    sign_up(client)
    assert client.get("/api/documents").json() == []

    created = client.post("/api/documents", json={"draft": draft("mutual-nda", purpose="Deal"), "messages": MESSAGES})
    assert created.status_code == 201
    doc = created.json()
    assert doc["title"] is None
    assert doc["draft"]["fields"] == {"purpose": "Deal"}
    assert doc["messages"] == MESSAGES

    second = client.post("/api/documents", json={"draft": draft(), "messages": MESSAGES}).json()
    listing = client.get("/api/documents").json()
    # Timestamps read back from SQLite still carry their UTC offset, so browsers show local times correctly.
    for timestamp in (listing[0]["createdAt"], listing[0]["updatedAt"], client.get(f"/api/documents/{doc['id']}").json()["updatedAt"]):
        assert timestamp.endswith(("Z", "+00:00")), timestamp
    assert [d["id"] for d in listing] == [second["id"], doc["id"]]  # most recently updated first
    assert "messages" not in listing[0]

    more = MESSAGES + [{"role": "assistant", "content": "Which state?"}]
    updated = client.patch(f"/api/documents/{doc['id']}", json={"draft": draft("pilot-agreement"), "messages": more})
    assert updated.json()["draft"]["documentId"] == "pilot-agreement"
    assert updated.json()["messages"] == more
    assert [d["id"] for d in client.get("/api/documents").json()] == [doc["id"], second["id"]]

    renamed = client.patch(f"/api/documents/{doc['id']}", json={"title": "  Globex pilot "}).json()
    assert renamed["title"] == "Globex pilot"
    assert renamed["messages"] == more  # untouched
    assert client.patch(f"/api/documents/{doc['id']}", json={"title": ""}).json()["title"] is None

    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    assert client.get(f"/api/documents/{doc['id']}").status_code == 404
    assert [d["id"] for d in client.get("/api/documents").json()] == [second["id"]]


def test_documents_are_private_to_their_owner(client: TestClient):
    sign_up(client, "ada@example.com")
    doc = client.post("/api/documents", json={"draft": draft(), "messages": MESSAGES}).json()
    client.post("/api/auth/logout")

    sign_up(client, "bob@example.com")
    assert client.get("/api/documents").json() == []
    assert client.get(f"/api/documents/{doc['id']}").status_code == 404
    assert client.patch(f"/api/documents/{doc['id']}", json={"title": "Mine"}).status_code == 404
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 404


def test_document_validation(client: TestClient):
    sign_up(client)
    assert client.post("/api/documents", json={"draft": draft("lease"), "messages": MESSAGES}).status_code == 422
    too_many = [{"role": "user", "content": "x"}] * 201
    assert client.post("/api/documents", json={"draft": draft(), "messages": too_many}).status_code == 422
    assert client.post("/api/documents", json={"draft": draft(), "messages": [], "title": "x" * 201}).status_code == 422


# --- Database -------------------------------------------------------------------


def test_documents_survive_a_restart(tmp_path: Path):
    with make_client(tmp_path) as client:
        sign_up(client)
        client.post("/api/documents", json={"draft": draft("mutual-nda"), "messages": MESSAGES})

    with make_client(tmp_path) as client:
        client.post("/api/auth/login", json={"email": "ada@example.com", "password": PASSWORD})
        assert len(client.get("/api/documents").json()) == 1


def test_upgrades_a_pre_migration_database(tmp_path: Path):
    # PL-4..PL-6 created only a `templates` table with create_all and no alembic_version.
    with sqlite3.connect(tmp_path / "test.db") as db:
        db.execute("CREATE TABLE templates (id INTEGER PRIMARY KEY, filename TEXT, name TEXT, description TEXT)")
        db.execute("INSERT INTO templates VALUES (1, 'old.md', 'Old', 'old')")

    with make_client(tmp_path) as client:
        assert "Old" not in [t["name"] for t in client.get("/api/templates").json()]
        sign_up(client)
