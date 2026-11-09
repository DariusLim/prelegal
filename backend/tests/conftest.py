import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.main import create_app

PASSWORD = "correct horse battery"


def make_client(
    tmp_path: Path,
    catalog_path: Path = REPO_ROOT / "catalog.json",
    openrouter_api_key: Optional[str] = None,
) -> TestClient:
    """A test client on a temporary database. No real API key, so tests never call OpenRouter."""
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        catalog_path=catalog_path,
        openrouter_api_key=openrouter_api_key,
    )
    return TestClient(create_app(settings))


def sign_up(client: TestClient, email: str = "ada@example.com") -> Dict[str, Any]:
    """Creates an account; the client keeps its session cookie."""
    response = client.post("/api/auth/signup", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response.json()


def ndjson(text: str) -> List[Dict[str, Any]]:
    return [json.loads(line) for line in text.splitlines() if line]
