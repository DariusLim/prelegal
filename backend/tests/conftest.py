from pathlib import Path
from typing import Optional

from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.main import create_app


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
