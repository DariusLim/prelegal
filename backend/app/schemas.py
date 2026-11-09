"""API response models."""

from pydantic import BaseModel, ConfigDict


class Health(BaseModel):
    status: str
    database: str


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    filename: str
