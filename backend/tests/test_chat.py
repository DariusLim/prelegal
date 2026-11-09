import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.documents import load_library
from app.drafting_chat import ChatRequest, describe_library
from app.llm import OpenRouterClient
from app.routes import get_llm
from tests.conftest import make_client

LIBRARY = load_library(Settings().document_types_path)
PARTY = {"name": "", "title": "", "company": "", "noticeAddress": ""}
GREETING = "Hi! What document do you need?"


def chat_request(*user_messages: str, document_id: Optional[str] = None, fields: Optional[Dict[str, str]] = None):
    messages = [{"role": "assistant", "content": GREETING}]
    messages += [{"role": "user", "content": m} for m in user_messages]
    draft = {"documentId": document_id, "fields": fields or {}, "party1": PARTY, "party2": PARTY}
    return {"messages": messages, "draft": draft, "today": "2026-11-09"}


def tool_call_response(arguments: Any, name: str = "respond") -> httpx.Response:
    raw = arguments if isinstance(arguments, str) else json.dumps(arguments)
    return httpx.Response(
        200,
        json={"choices": [{"message": {"tool_calls": [{"function": {"name": name, "arguments": raw}}]}}]},
    )


Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def chat_client(tmp_path: Path):
    """Yields (client, set_handler, requests): the LLM is backed by a mock OpenRouter transport."""
    requests: List[Dict[str, Any]] = []
    state: Dict[str, Handler] = {}

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return state["handler"](request)

    llm = OpenRouterClient("test-key", ["test/model"], transport=httpx.MockTransport(transport))
    with make_client(tmp_path) as client:
        client.app.dependency_overrides[get_llm] = lambda: llm
        yield client, lambda handler: state.update(handler=handler), requests
    llm.close()


def respond_with(chat_client, arguments: Any) -> TestClient:
    client, set_handler, _ = chat_client
    set_handler(lambda _: tool_call_response(arguments))
    return client


def test_selecting_a_document_returns_its_fields_and_parties(chat_client):
    turn = {
        "reply": "A Cloud Service Agreement it is. Who signs for Globex?",
        "documentId": "cloud-service-agreement",
        "fields": {"subscriptionPeriod": "12 months", "effectiveDate": "2026-12-01"},
        "party1": {"company": "Acme Inc"},
        "party2": {"company": "Globex"},
    }
    client = respond_with(chat_client, turn)

    response = client.post("/api/chat", json=chat_request("We sell SaaS to Globex"))

    assert response.status_code == 200
    assert response.json() == turn


def test_answers_are_sanitised_against_the_document(chat_client):
    client = respond_with(
        chat_client,
        {
            "reply": "Noted **Delaware**.",
            "documentId": "pilot-agreement",  # unchanged: dropped
            "fields": {
                "governingLaw": " Delaware ",
                "pilotPeriod": 90,  # number: kept as text
                "effectiveDate": "next week",  # not ISO: dropped
                "mndaTerm": "1 year",  # another document's field: dropped
                "chosenCourts": None,  # null: dropped
            },
        },
    )

    response = client.post("/api/chat", json=chat_request("Delaware, 90 days", document_id="pilot-agreement"))

    assert response.status_code == 200
    assert response.json() == {"reply": "Noted Delaware.", "fields": {"governingLaw": "Delaware", "pilotPeriod": "90"}}


def test_unknown_document_ids_and_fields_without_a_document_are_dropped(chat_client):
    client = respond_with(
        chat_client,
        {"reply": "We can't do leases.", "documentId": "lease", "fields": {"rent": "$2,000"}, "party1": {"name": "Ann"}},
    )

    response = client.post("/api/chat", json=chat_request("I need a lease"))

    assert response.json() == {"reply": "We can't do leases.", "fields": {}, "party1": {"name": "Ann"}}


def test_switching_documents_validates_fields_against_the_new_document(chat_client):
    client = respond_with(
        chat_client,
        {
            "reply": "Switching to a Pilot Agreement.",
            "documentId": "pilot-agreement",
            "fields": {"pilotPeriod": "60 days", "purpose": "Testing"},
        },
    )

    response = client.post("/api/chat", json=chat_request("Make it a pilot instead", document_id="mutual-nda"))

    assert response.json()["documentId"] == "pilot-agreement"
    assert response.json()["fields"] == {"pilotPeriod": "60 days"}


def test_chat_sends_catalogue_draft_and_tool(chat_client):
    client, set_handler, requests = chat_client
    set_handler(lambda _: tool_call_response({"reply": "Noted."}))

    client.post("/api/chat", json=chat_request("Acme and Globex", document_id="mutual-nda", fields={"purpose": "Deal"}))

    (payload,) = requests
    assert payload["model"] == "test/model"
    assert payload["max_tokens"] > 0
    tool = payload["tools"][0]["function"]
    assert tool["name"] == "respond"
    assert tool["parameters"]["properties"]["documentId"]["enum"] == [d.id for d in LIBRARY.documents]
    assert "anyOf" not in json.dumps(tool["parameters"]) and "$ref" not in json.dumps(tool["parameters"])

    system, *messages = payload["messages"]
    assert describe_library(LIBRARY) in system["content"]
    assert "2026-11-09" in system["content"]
    assert '"documentId": "mutual-nda"' in system["content"]
    assert GREETING in system["content"]
    assert messages == [{"role": "user", "content": "Acme and Globex"}]


def test_several_models_are_sent_as_a_fallback_list(tmp_path: Path):
    requests: List[Dict[str, Any]] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return tool_call_response({"reply": "Hi."})

    llm = OpenRouterClient("k", ["a/free", "b/free"], transport=httpx.MockTransport(transport))
    with make_client(tmp_path) as client:
        client.app.dependency_overrides[get_llm] = lambda: llm
        client.post("/api/chat", json=chat_request("hello"))
    llm.close()

    assert requests[0]["models"] == ["a/free", "b/free"]
    assert "model" not in requests[0]


def test_library_entries_match_the_templates():
    catalog = {t["filename"] for t in json.loads((REPO_ROOT / "catalog.json").read_text())["templates"]}
    for doc in LIBRARY.documents:
        assert doc.standard_terms in catalog
        assert (REPO_ROOT / doc.standard_terms).is_file()


@pytest.mark.parametrize(
    "upstream",
    [
        httpx.Response(500, text="boom"),
        httpx.Response(429, json={"error": {"message": "rate limited"}}),
        tool_call_response("not json"),
        tool_call_response({"reply": ""}),
        tool_call_response({"fields": {}}),
        httpx.Response(200, json={"choices": [{"message": {"content": ""}}]}),
        httpx.Response(200, json={"error": {"message": "provider error"}}),
    ],
)
def test_bad_upstream_answers_become_502(chat_client, upstream):
    client, set_handler, _ = chat_client
    set_handler(lambda _: upstream)

    response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 502
    assert "couldn't respond" in response.json()["detail"]


def test_plain_text_answer_becomes_reply_without_changes(chat_client):
    client, set_handler, _ = chat_client
    set_handler(lambda _: httpx.Response(200, json={"choices": [{"message": {"content": " Which document? "}}]}))

    response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 200
    assert response.json() == {"reply": "Which document?", "fields": {}}


def test_request_validation(chat_client):
    client, _, requests = chat_client

    assert client.post("/api/chat", json=chat_request()).status_code == 422  # greeting only
    too_long = chat_request("hi", fields={"purpose": "x" * 5001})
    assert client.post("/api/chat", json=too_long).status_code == 422
    assert requests == []


def test_chat_without_api_key_is_503(tmp_path: Path):
    with make_client(tmp_path) as client:
        response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_request_model_reads_camel_case():
    request = ChatRequest.model_validate(chat_request("hi", document_id="mutual-nda"))
    assert request.draft.document_id == "mutual-nda"
    assert request.draft.model_dump(by_alias=True)["party1"] == PARTY
