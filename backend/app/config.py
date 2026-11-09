"""Runtime settings, read from environment variables with local-dev defaults."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Secrets such as OPENROUTER_API_KEY live in the git-ignored repo-root .env.
# Variables already set in the environment take precedence.
load_dotenv(REPO_ROOT / ".env")


def _default_database_url() -> str:
    return f"sqlite:///{BACKEND_DIR / 'data' / 'prelegal.db'}"


@dataclass(frozen=True)
class Settings:
    # SQLite file used as the temporary v1 database. It is disposable: the
    # schema is created and the catalog re-seeded on every startup.
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", _default_database_url()))
    # The templates dataset (catalog.json + templates/) lives at the repo root.
    catalog_path: Path = field(
        default_factory=lambda: Path(os.environ.get("CATALOG_PATH", REPO_ROOT / "catalog.json"))
    )
    # LLM used by the NDA chat. Without a key, /api/chat responds 503.
    openrouter_api_key: Optional[str] = field(default_factory=lambda: os.environ.get("OPENROUTER_API_KEY") or None)
    openrouter_model: str = field(
        default_factory=lambda: os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-5.5")
    )
