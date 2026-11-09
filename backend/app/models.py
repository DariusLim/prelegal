"""Database models."""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Template(Base):
    """A legal template from the repository's catalog.json."""

    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Path relative to the repo root, e.g. "templates/Mutual-NDA.md"; the natural key.
    filename: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
