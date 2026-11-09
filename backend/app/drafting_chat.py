"""AI chat that drafts any supported Common Paper document.

Each turn the frontend sends the conversation plus the current draft (the
selected document type, its Cover Page fields and both parties). The model
answers by calling a `respond` tool carrying its chat reply and any changes:
a document type to select or switch to, field values and party details. The
answer is validated and then sanitised against the document library, so the
document only ever receives known fields in the expected format.
"""

import json
import re
from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.documents import DocumentLibrary, DocumentType
from app.llm import LLMError, OpenRouterClient

ISO_DATE_OR_EMPTY = re.compile(r"(\d{4}-\d{2}-\d{2})?")
MAX_VALUE_LENGTH = 5000
MAX_REPLY_LENGTH = 4000


class _CamelModel(BaseModel):
    """Serialises as camelCase to match the frontend's types."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Draft state (mirrors frontend/src/lib/documents/types.ts) ---------------


class Party(_CamelModel):
    name: str = Field(max_length=500)
    title: str = Field(max_length=500)
    company: str = Field(max_length=500)
    notice_address: str = Field(max_length=500)


class Draft(_CamelModel):
    document_id: Optional[str] = None
    fields: Dict[str, str] = Field(default_factory=dict)
    party1: Party
    party2: Party

    @field_validator("fields")
    @classmethod
    def _bounded(cls, fields: Dict[str, str]) -> Dict[str, str]:
        if len(fields) > 50 or any(len(v) > MAX_VALUE_LENGTH for v in fields.values()):
            raise ValueError("too many or too long field values")
        return fields


# --- The model's answer ------------------------------------------------------


class PartyUpdate(_CamelModel):
    name: Optional[str] = Field(None, max_length=500, description="Full name of the person signing")
    title: Optional[str] = Field(None, max_length=500, description="Signatory's job title")
    company: Optional[str] = Field(None, max_length=500, description="Legal name of the company")
    notice_address: Optional[str] = Field(
        None, max_length=500, description="Email or postal address for legal notices"
    )


class AssistantTurn(_CamelModel):
    reply: str = Field(min_length=1, description="Your next chat message to the user, in plain text")
    document_id: Optional[str] = Field(
        None, description="Set only to select or switch the document type: one of the supported document ids"
    )
    fields: Dict[str, str] = Field(
        default_factory=dict,
        description="Cover Page values to set this turn, keyed by the selected document's field keys",
    )
    party1: Optional[PartyUpdate] = Field(None, description="Changes to the first party (first role listed)")
    party2: Optional[PartyUpdate] = Field(None, description="Changes to the second party (second role listed)")

    @field_validator("fields", mode="before")
    @classmethod
    def _stringify(cls, fields: Any) -> Any:
        # Weaker models sometimes send numbers (e.g. years) or nulls: keep scalars as text, drop the rest.
        if not isinstance(fields, dict):
            return fields
        return {
            key: str(value)
            for key, value in fields.items()
            if isinstance(value, (str, int, float)) and not isinstance(value, bool)
        }


# --- API request -------------------------------------------------------------


class ChatMessage(_CamelModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(_CamelModel):
    messages: List[ChatMessage] = Field(min_length=1, max_length=100)
    draft: Draft
    today: date

    @model_validator(mode="after")
    def _ends_with_user_message(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return self


ChatResponse = AssistantTurn


# --- Prompt ------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the drafting assistant in prelegal. You help the user create one legal agreement from the \
Common Paper standard templates listed below by chatting with them and filling in the agreement's \
Cover Page. Each document's Standard Terms are fixed. The user sees the document update live next \
to this chat and can download it as a PDF at any time.

Supported documents:
{catalog}

How to run the conversation:
- First find out what the user needs. If it clearly matches a supported document, select it by \
setting `documentId`. If it is unclear, ask a short question or suggest the most likely documents.
- If they ask for a document that is not supported (for example an employment contract, a lease, \
a will or a one-way NDA), say plainly that prelegal can't generate it yet and offer the closest \
supported document, with one sentence on how it differs. Only select it once they agree.
- To switch documents, set the new `documentId`. Party details carry over; the other fields reset \
to the new document's defaults.
- Then guide the user through the selected document's fields. Ask about one topic at a time (at \
most two related questions), starting with the parties, then the key terms. Briefly explain \
unfamiliar terms and mention a common choice, but do not give legal advice; suggest a lawyer for \
specific legal questions.
- Whenever the user gives information, record every value they stated in the same turn, including \
the turn in which you select the document: `fields` (only keys of the selected document) and \
`party1`/`party2` (in the order of the document's parties). Include only what changes and never \
invent values the user hasn't given or agreed to. When the user accepts a \
suggestion or default, record it.
- Dates are YYYY-MM-DD. Resolve relative dates ("today", "next Monday") using today's date.
- When every field is filled, summarise the key terms and tell the user they can download the PDF.
- Refer to documents by their names, never by their ids.
- Write plain conversational text without Markdown (no **bold**, headings or tables). Short lists \
starting with "-" are fine.
- Always answer by calling the `respond` tool.

Today's date: {today}

Current draft (JSON):
{draft}
"""

TOOL_DESCRIPTION = "Send your next chat message to the user and record any document choice, field values or party details."


def describe_library(library: DocumentLibrary) -> str:
    """The document catalogue as prompt text: ids, parties and every field with its hint and default."""
    lines = []
    for doc in library.documents:
        lines.append(
            f"- {doc.id}: {doc.name}. {doc.description} "
            f"Parties: party1 = {doc.parties[0]}, party2 = {doc.parties[1]}."
        )
        for spec in doc.fields:
            extra = " (YYYY-MM-DD)" if spec.type == "date" else ""
            default = f' Default: "{spec.default}"' if spec.default else ""
            lines.append(f"    - {spec.key}: {spec.label}{extra}. {spec.hint}.{default}")
    return "\n".join(lines)


def _tool_schema(library: DocumentLibrary) -> Dict[str, Any]:
    """AssistantTurn's JSON schema, flattened for the model.

    `$defs` are inlined and optional fields are plain types (not
    `anyOf [type, null]`), which smaller models handle more reliably. The
    document id is constrained to the library's ids.
    """
    schema = AssistantTurn.model_json_schema(by_alias=True)
    defs = schema.pop("$defs", {})

    def simplify(node: Any) -> Any:
        if isinstance(node, list):
            return [simplify(item) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return simplify(defs[node["$ref"].rsplit("/", 1)[-1]])
        variants = node.get("anyOf")
        if variants and len(variants) == 2 and {"type": "null"} in variants:
            inner = next(v for v in variants if v != {"type": "null"})
            rest = {k: v for k, v in node.items() if k not in ("anyOf", "default")}
            return {**simplify(inner), **rest}
        return {k: simplify(v) for k, v in node.items() if not (k == "default" and v is None)}

    schema = simplify(schema)
    schema["properties"]["documentId"]["enum"] = [d.id for d in library.documents]
    return schema


def _plain_text(reply: str) -> str:
    """Removes Markdown emphasis that models add despite the prompt."""
    return re.sub(r"(\*\*|__)(.+?)\1", r"\2", reply).strip()[:MAX_REPLY_LENGTH]


def sanitize(turn: AssistantTurn, draft: Draft, library: DocumentLibrary) -> AssistantTurn:
    """Keeps only changes the document can take.

    Unknown or unchanged document ids are dropped, as are fields the
    resulting document doesn't have and dates not in YYYY-MM-DD form.
    """
    by_id = library.by_id
    document_id = turn.document_id if turn.document_id in by_id and turn.document_id != draft.document_id else None
    target: Optional[DocumentType] = by_id.get(document_id or draft.document_id or "")

    fields: Dict[str, str] = {}
    for key, value in turn.fields.items():
        spec = target.field(key) if target else None
        value = value.strip()[:MAX_VALUE_LENGTH]
        if spec is None or (spec.type == "date" and not ISO_DATE_OR_EMPTY.fullmatch(value)):
            continue
        fields[key] = value

    return turn.model_copy(update={"reply": _plain_text(turn.reply), "document_id": document_id, "fields": fields})


def next_turn(llm: OpenRouterClient, library: DocumentLibrary, request: ChatRequest) -> AssistantTurn:
    """Asks the model for its next message and document changes.

    Raises LLMError if the model can't be reached or gives no answer, or
    pydantic.ValidationError if its tool call doesn't fit AssistantTurn.
    """
    system = SYSTEM_PROMPT.format(
        catalog=describe_library(library),
        today=request.today.isoformat(),
        draft=json.dumps(request.draft.model_dump(by_alias=True), indent=2),
    )

    # The UI opens with a canned greeting. Conversations sent to the model
    # should start with a user turn, so leading assistant messages are moved
    # into the system prompt instead.
    messages = list(request.messages)
    opening = []
    while messages and messages[0].role == "assistant":
        opening.append(messages.pop(0).content)
    if opening:
        system += "\nYou opened the conversation by saying:\n" + "\n".join(opening) + "\n"

    answer = llm.chat_with_tool(
        system=system,
        messages=[{"role": m.role, "content": m.content} for m in messages],
        tool_name="respond",
        tool_description=TOOL_DESCRIPTION,
        parameters=_tool_schema(library),
    )
    if answer.tool_arguments is not None:
        turn = AssistantTurn.model_validate(answer.tool_arguments)
    elif answer.text:
        # The model skipped the tool: keep the conversation going without changes.
        turn = AssistantTurn(reply=answer.text)
    else:
        raise LLMError("model returned neither a tool call nor text")
    return sanitize(turn, request.draft, library)
