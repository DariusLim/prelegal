"""Seed the database from the repository's templates catalog."""

import json
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Template


def seed_templates(session: Session, catalog_path: Path) -> None:
    """Make the templates table mirror catalog.json (insert, update and remove rows)."""
    entries = json.loads(catalog_path.read_text(encoding="utf-8"))["templates"]
    existing = {t.filename: t for t in session.scalars(select(Template))}

    for entry in entries:
        template = existing.pop(entry["filename"], None) or Template(filename=entry["filename"])
        template.name = entry["name"]
        template.description = entry["description"]
        session.add(template)

    if existing:
        session.execute(delete(Template).where(Template.filename.in_(existing)))
    session.commit()
