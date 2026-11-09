import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.main import create_app


def make_client(tmp_path: Path, catalog_path: Path = REPO_ROOT / "catalog.json") -> TestClient:
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}", catalog_path=catalog_path)
    return TestClient(create_app(settings))


@pytest.fixture
def client(tmp_path: Path):
    with make_client(tmp_path) as c:
        yield c


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_templates_mirror_catalog(client: TestClient):
    catalog = json.loads((REPO_ROOT / "catalog.json").read_text())["templates"]
    response = client.get("/api/templates")
    assert response.status_code == 200
    assert [(t["name"], t["filename"]) for t in response.json()] == [
        (t["name"], t["filename"]) for t in catalog
    ]


def test_reseeding_tracks_catalog_changes(tmp_path: Path):
    catalog_path = tmp_path / "catalog.json"

    def write(templates):
        catalog_path.write_text(json.dumps({"templates": templates}))

    a ={"name": "A", "description": "a", "filename": "templates/A.md"}
    b = {"name": "B", "description": "b", "filename": "templates/B.md"}

    write([a, b])
    with make_client(tmp_path, catalog_path) as c:
        assert [t["name"] for t in c.get("/api/templates").json()] == ["A", "B"]

    # Restart against the same database with B removed and A renamed.
    write([{**a, "name": "A2"}])
    with make_client(tmp_path, catalog_path) as c:
        assert [t["name"] for t in c.get("/api/templates").json()] == ["A2"]
