"""AI chat that drafts a Common Paper Mutual NDA.

Each turn the frontend sends the conversation plus the current Cover Page
fields; the model answers by calling a `respond` tool that carries both its
chat reply and any field updates, which are validated here before they reach
the document.
"""

import json
from datetime import date
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.llm import LLMError, OpenRouterClient

# YYYY-MM-DD, or empty for "today" (as in the frontend's NdaFormData).
ISO_DATE_OR_EMPTY = r"^(\d{4}-\d{2}-\d{2})?$"


class _CamelModel(BaseModel):
    """Serialises as camelCase to match the frontend's NdaFormData."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- Current document state (mirrors frontend/src/lib/nda/types.ts) ----------


class Party(_CamelModel):
    name: str = Field(max_length=500)
    title: str = Field(max_length=500)
    company: str = Field(max_length=500)
    notice_address: str = Field(max_length=500)


class NdaFields(_CamelModel):
    purpose: str = Field(max_length=5000)
    effective_date: str = Field(pattern=ISO_DATE_OR_EMPTY)
    mnda_term_type: Literal["expires", "untilTerminated"]
    mnda_term_years: int = Field(ge=1, le=99)
    confidentiality_type: Literal["years", "perpetual"]
    confidentiality_years: int = Field(ge=1, le=99)
    governing_law: str = Field(max_length=500)
    jurisdiction: str = Field(max_length=500)
    modifications: str = Field(max_length=5000)
    party1: Party
    party2: Party


# --- Updates proposed by the model (every field optional) -------------------


class PartyUpdate(_CamelModel):
    name: Optional[str] = Field(None, max_length=500, description="Full name of the person signing")
    title: Optional[str] = Field(None, max_length=500, description="Signatory's job title")
    company: Optional[str] = Field(None, max_length=500, description="Legal name of the company")
    notice_address: Optional[str] = Field(
        None, max_length=500, description="Email or postal address for legal notices"
    )


class NdaUpdates(_CamelModel):
    purpose: Optional[str] = Field(
        None, max_length=5000, description="How Confidential Information may be used, as one sentence"
    )
    effective_date: Optional[str] = Field(
        None, pattern=ISO_DATE_OR_EMPTY, description="Effective Date as YYYY-MM-DD; empty string for today"
    )
    mnda_term_type: Optional[Literal["expires", "untilTerminated"]] = Field(
        None, description="'expires' after mndaTermYears, or 'untilTerminated'"
    )
    mnda_term_years: Optional[int] = Field(None, ge=1, le=99, description="MNDA term in whole years")
    confidentiality_type: Optional[Literal["years", "perpetual"]] = Field(
        None, description="'years' for a fixed term of confidentialityYears, or 'perpetual'"
    )
    confidentiality_years: Optional[int] = Field(None, ge=1, le=99, description="Confidentiality term in whole years")
    governing_law: Optional[str] = Field(None, max_length=500, description="US state whose law governs, e.g. 'Delaware'")
    jurisdiction: Optional[str] = Field(
        None, max_length=500, description="Courts with jurisdiction, e.g. 'courts located in New Castle, DE'"
    )
    modifications: Optional[str] = Field(
        None, max_length=5000, description="Changes to the Standard Terms; empty string for none"
    )
    party1: Optional[PartyUpdate] = None
    party2: Optional[PartyUpdate] = None


class AssistantTurn(_CamelModel):
    reply: str = Field(min_length=1, max_length=4000, description="Your next chat message to the user")
    updates: NdaUpdates = Field(
        default_factory=NdaUpdates,
        description="Only the fields to change this turn; omit everything else",
    )


# --- API request/response ----------------------------------------------------


class ChatMessage(_CamelModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(_CamelModel):
    messages: List[ChatMessage] = Field(min_length=1, max_length=100)
    fields: NdaFields
    today: date

    @model_validator(mode="after")
    def _ends_with_user_message(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return self


ChatResponse = AssistantTurn


# --- Prompt ------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the drafting assistant in prelegal, helping the user complete a Mutual Non-Disclosure \
Agreement based on the Common Paper Mutual NDA Standard Terms (Version 1.0). The Standard Terms \
are fixed; you only fill in the Cover Page. The user sees the completed agreement update live \
next to this chat and can download it as a PDF at any time.

Cover Page fields:
- purpose: how Confidential Information may be used. Default: evaluating a possible business relationship.
- effectiveDate: when the MNDA starts (YYYY-MM-DD). Empty means today.
- MNDA term: expires after a number of years (mndaTermType "expires" + mndaTermYears) or \
continues until terminated ("untilTerminated").
- Term of confidentiality: a number of years ("years" + confidentialityYears; trade secrets stay \
protected while they remain trade secrets) or in perpetuity ("perpetual").
- governingLaw: the US state whose law governs. jurisdiction: the courts, e.g. "courts located in \
New Castle, DE".
- modifications: optional changes to the Standard Terms.
- party1 / party2: company, signatory name, title and notice address (email or postal).

How to run the conversation:
- Be friendly, concise and conversational. Ask about one topic at a time (at most two related \
questions), starting with who the parties are and what the NDA is for, then the terms.
- Whenever the user gives information, record it in `updates` in the same turn. Only include \
fields that change; never invent values the user has not given or clearly agreed to. When the \
user accepts a suggested value or default, record it.
- Resolve relative dates ("today", "next Monday") using today's date.
- Briefly explain a term when the user is unsure, mention the common choice, but do not give \
legal advice; suggest consulting a lawyer for specific legal questions.
- Look at the current field values to see what is still missing. Defaults (1-year terms, the \
default purpose) count as set but may be worth confirming once. When everything is filled in, \
summarise the key terms and tell the user they can download the PDF.
- If the user asks for a different kind of document, explain that only the Mutual NDA is \
supported for now.
- Always answer by calling the `respond` tool.

Today's date: {today}

Current Cover Page fields (JSON):
{fields}
"""

TOOL_DESCRIPTION = "Send your next chat message to the user and record any Cover Page field changes."


def _inline_refs(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Inlines Pydantic's `$defs` so the tool schema is self-contained."""
    defs = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].rsplit("/", 1)[-1]])
            return {key: resolve(value) for key, value in node.items()}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


RESPOND_TOOL_SCHEMA = _inline_refs(AssistantTurn.model_json_schema(by_alias=True))


def next_turn(llm: OpenRouterClient, request: ChatRequest) -> AssistantTurn:
    """Asks the model for its next message and field updates.

    Raises LLMError if the model can't be reached or gives no answer, or
    pydantic.ValidationError if its tool call doesn't fit AssistantTurn.
    """
    system = SYSTEM_PROMPT.format(
        today=request.today.isoformat(),
        fields=json.dumps(request.fields.model_dump(by_alias=True), indent=2),
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
        parameters=RESPOND_TOOL_SCHEMA,
    )
    if answer.tool_arguments is not None:
        return AssistantTurn.model_validate(answer.tool_arguments)
    if answer.text:
        # The model skipped the tool: keep the conversation going without field updates.
        return AssistantTurn(reply=answer.text[:4000])
    raise LLMError("model returned neither a tool call nor text")
