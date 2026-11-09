"""Shared API models."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Serialises as camelCase to match the frontend's types."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Health(BaseModel):
    status: str
    database: str


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    filename: str
