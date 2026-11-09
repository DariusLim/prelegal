"""Runtime settings, read from environment variables with local-dev defaults."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Tuple

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Secrets such as OPENROUTER_API_KEY live in the git-ignored repo-root .env.
# Variables already set in the environment take precedence.
load_dotenv(REPO_ROOT / ".env")


# Free models by default, in order of preference. Specific capable models, not
# `openrouter/free`, which can route to tiny models that skip the tool call.
DEFAULT_MODELS = "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free"


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
    # Document types the drafting assistant can create.
    document_types_path: Path = field(
        default_factory=lambda: Path(os.environ.get("DOCUMENT_TYPES_PATH", REPO_ROOT / "document-types.json"))
    )
    # LLM used by the drafting chat. Without a key, /api/chat responds 503.
    openrouter_api_key: Optional[str] = field(default_factory=lambda: os.environ.get("OPENROUTER_API_KEY") or None)
    # Comma-separated OpenRouter model ids, tried in order (OpenRouter falls back on errors and rate limits).
    openrouter_models: Tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip() for m in os.environ.get("OPENROUTER_MODEL", DEFAULT_MODELS).split(",") if m.strip()
        )
    )
