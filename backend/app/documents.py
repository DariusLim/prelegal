"""The document types the drafting assistant can create (repo-root document-types.json)."""

import json
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class _Spec(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class FieldSpec(_Spec):
    key: str
    label: str
    hint: str
    type: Literal["text", "longText", "date"] = "text"
    default: str = ""


class DocumentType(_Spec):
    id: str
    name: str
    short_name: str
    description: str
    standard_terms: str
    version: Optional[str] = None
    standard_terms_url: Optional[str] = None
    parties: Tuple[str, str]
    fields: List[FieldSpec] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_field_keys(self) -> "DocumentType":
        keys = [f.key for f in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError(f"{self.id}: duplicate field keys")
        return self

    def field(self, key: str) -> Optional[FieldSpec]:
        return next((f for f in self.fields if f.key == key), None)


class DocumentLibrary(BaseModel):
    documents: List[DocumentType] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_ids(self) -> "DocumentLibrary":
        ids = [d.id for d in self.documents]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate document ids")
        return self

    @property
    def by_id(self) -> Dict[str, DocumentType]:
        return {d.id: d for d in self.documents}


def load_library(path: Path) -> DocumentLibrary:
    return DocumentLibrary.model_validate(json.loads(path.read_text(encoding="utf-8")))
