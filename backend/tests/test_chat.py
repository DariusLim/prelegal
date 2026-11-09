import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.documents import load_library
from app.drafting_chat import ChatRequest, describe_library, partial_reply
from app.llm import OpenRouterClient
from app.routes import get_llm
from tests.conftest import make_client, ndjson, sign_up

LIBRARY = load_library(Settings().document_types_path)
PARTY = {"name": "", "title": "", "company": "", "noticeAddress": ""}
GREETING = "Hi! What document do you need?"


def chat_request(*user_messages: str, document_id: Optional[str] = None, fields: Optional[Dict[str, str]] = None):
    messages = [{"role": "assistant", "content": GREETING}]
    messages += [{"role": "user", "content": m} for m in user_messages]
    draft = {"documentId": document_id, "fields": fields or {}, "party1": PARTY, "party2": PARTY}
    return {"messages": messages, "draft": draft, "today": "2026-11-09"}


def sse(*events: Dict[str, Any]) -> httpx.Response:
    """A streamed OpenRouter answer, with a keep-alive comment as OpenRouter sends."""
    lines = [": OPENROUTER PROCESSING"] + [f"data: {json.dumps(e)}" for e in events] + ["data: [DONE]"]
    return httpx.Response(200, text="\n\n".join(lines) + "\n\n", headers={"Content-Type": "text/event-stream"})


def content_events(text: str, chunk: int = 5) -> List[Dict[str, Any]]:
    return [{"choices": [{"delta": {"content": text[i : i + chunk]}}]} for i in range(0, len(text), chunk)]


def tool_events(arguments: Any, name: str = "respond", chunk: int = 7) -> List[Dict[str, Any]]:
    raw = arguments if isinstance(arguments, str) else json.dumps(arguments)
    events = [{"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": name, "arguments": ""}}]}}]}]
    events += [
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": raw[i : i + chunk]}}]}}]}
        for i in range(0, len(raw), chunk)
    ]
    return events


def tool_call_response(arguments: Any, name: str = "respond") -> httpx.Response:
    return sse(*tool_events(arguments, name))


Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def chat_client(tmp_path: Path):
    """Yields (client, set_handler, requests): a signed-in client whose LLM is a mock OpenRouter transport."""
    requests: List[Dict[str, Any]] = []
    state: Dict[str, Handler] = {}

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return state["handler"](request)

    llm = OpenRouterClient("test-key", ["test/model"], transport=httpx.MockTransport(transport))
    with make_client(tmp_path) as client:
        client.app.dependency_overrides[get_llm] = lambda: llm
        sign_up(client)
        yield client, lambda handler: state.update(handler=handler), requests
    llm.close()


def respond_with(chat_client, arguments: Any) -> TestClient:
    client, set_handler, _ = chat_client
    set_handler(lambda _: tool_call_response(arguments))
    return client


def chat_events(client: TestClient, body: Dict[str, Any]) -> List[Dict[str, Any]]:
    response = client.post("/api/chat", json=body)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/x-ndjson")
    return ndjson(response.text)


def final_turn(client: TestClient, body: Dict[str, Any]) -> Dict[str, Any]:
    *_, last = chat_events(client, body)
    assert last["type"] == "done", last
    return last["turn"]


def streamed_text(events: List[Dict[str, Any]]) -> str:
    text = ""
    for event in events:
        if event["type"] == "delta":
            text += event["text"]
        elif event["type"] == "reset":
            text = event["text"]
    return text


def test_selecting_a_document_returns_its_fields_and_parties(chat_client):
    turn = {
        "reply": "A Cloud Service Agreement it is. Who signs for Globex?",
        "documentId": "cloud-service-agreement",
        "fields": {"subscriptionPeriod": "12 months", "effectiveDate": "2026-12-01"},
        "party1": {"company": "Acme Inc"},
        "party2": {"company": "Globex"},
    }
    client = respond_with(chat_client, turn)

    assert final_turn(client, chat_request("We sell SaaS to Globex")) == turn


def test_the_reply_streams_before_the_turn_completes(chat_client):
    reply = 'Got it: "Acme"\nWhich state\'s law?'
    client = respond_with(chat_client, {"documentId": "mutual-nda", "reply": reply, "fields": {"purpose": "Deal"}})

    events = chat_events(client, chat_request("An NDA with Acme"))

    deltas = [e for e in events if e["type"] == "delta"]
    assert len(deltas) > 3  # several pieces, not one block
    assert streamed_text(events) == reply
    assert events[-1] == {
        "type": "done",
        "turn": {"reply": reply, "documentId": "mutual-nda", "fields": {"purpose": "Deal"}},
    }


def test_text_before_a_tool_call_is_replaced_by_the_tool_reply(chat_client):
    client, set_handler, _ = chat_client
    set_handler(lambda _: sse(*content_events("Let me record that."), *tool_events({"reply": "Recorded."})))

    events = chat_events(client, chat_request("Acme"))

    assert any(e["type"] == "reset" for e in events)
    assert streamed_text(events) == "Recorded."
    assert events[-1]["turn"]["reply"] == "Recorded."


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

    turn = final_turn(client, chat_request("Delaware, 90 days", document_id="pilot-agreement"))

    assert turn == {"reply": "Noted Delaware.", "fields": {"governingLaw": "Delaware", "pilotPeriod": "90"}}


def test_unknown_document_ids_and_fields_without_a_document_are_dropped(chat_client):
    client = respond_with(
        chat_client,
        {"reply": "We can't do leases.", "documentId": "lease", "fields": {"rent": "$2,000"}, "party1": {"name": "Ann"}},
    )

    turn = final_turn(client, chat_request("I need a lease"))

    assert turn == {"reply": "We can't do leases.", "fields": {}, "party1": {"name": "Ann"}}


def test_switching_documents_validates_fields_against_the_new_document(chat_client):
    client = respond_with(
        chat_client,
        {
            "reply": "Switching to a Pilot Agreement.",
            "documentId": "pilot-agreement",
            "fields": {"pilotPeriod": "60 days", "purpose": "Testing"},
        },
    )

    turn = final_turn(client, chat_request("Make it a pilot instead", document_id="mutual-nda"))

    assert turn["documentId"] == "pilot-agreement"
    assert turn["fields"] == {"pilotPeriod": "60 days"}


def test_chat_sends_catalogue_draft_and_tool(chat_client):
    client, set_handler, requests = chat_client
    set_handler(lambda _: tool_call_response({"reply": "Noted."}))

    final_turn(client, chat_request("Acme and Globex", document_id="mutual-nda", fields={"purpose": "Deal"}))

    (payload,) = requests
    assert payload["model"] == "test/model"
    assert payload["max_tokens"] > 0
    assert payload["stream"] is True
    assert payload["tool_choice"] == "auto"
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
        sign_up(client)
        final_turn(client, chat_request("hello"))
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
        sse({"choices": [{"delta": {"content": ""}}]}),
        sse({"error": {"message": "provider error"}}),
        sse({"choices": "garbage"}),
    ],
)
def test_bad_upstream_answers_end_the_stream_with_an_error(chat_client, upstream):
    client, set_handler, _ = chat_client
    set_handler(lambda _: upstream)

    events = chat_events(client, chat_request("hello"))

    assert events[-1]["type"] == "error"
    assert "couldn't respond" in events[-1]["detail"]
    assert all(e["type"] != "done" for e in events)


def test_unreachable_upstream_is_an_error_event(chat_client):
    client, set_handler, _ = chat_client

    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    set_handler(fail)
    assert chat_events(client, chat_request("hello"))[-1]["type"] == "error"


def test_plain_text_answer_becomes_reply_without_changes(chat_client):
    client, set_handler, _ = chat_client
    set_handler(lambda _: sse(*content_events(" Which document? ")))

    events = chat_events(client, chat_request("hello"))

    assert streamed_text(events) == " Which document? "
    assert events[-1]["turn"] == {"reply": "Which document?", "fields": {}}


def test_tool_calls_to_other_functions_are_ignored(chat_client):
    client, set_handler, _ = chat_client
    set_handler(lambda _: sse(*tool_events({"q": "x"}, name="search"), *content_events("Which document?")))

    assert final_turn(client, chat_request("hello")) == {"reply": "Which document?", "fields": {}}


def test_request_validation(chat_client):
    client, _, requests = chat_client

    assert client.post("/api/chat", json=chat_request()).status_code == 422  # greeting only
    too_long = chat_request("hi", fields={"purpose": "x" * 5001})
    assert client.post("/api/chat", json=too_long).status_code == 422
    assert requests == []


def test_chat_requires_sign_in(tmp_path: Path):
    with make_client(tmp_path) as client:
        response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 401


def test_chat_without_api_key_is_503(tmp_path: Path):
    with make_client(tmp_path) as client:
        sign_up(client)
        response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_request_model_reads_camel_case():
    request = ChatRequest.model_validate(chat_request("hi", document_id="mutual-nda"))
    assert request.draft.document_id == "mutual-nda"
    assert request.draft.model_dump(by_alias=True)["party1"] == PARTY


@pytest.mark.parametrize(
    ("arguments", "expected"),
    [
        ('{"documentId": "x", "rep', None),
        ('{"reply": "', ""),
        ('{"reply": "Hello', "Hello"),
        ('{"reply": "Say \\"hi\\', 'Say "hi'),  # incomplete escape held back
        ('{"reply": "caf\\u00e', "caf"),
        ('{"reply": "caf\\u00e9 \\ud83d', "café "),  # half a surrogate pair held back
        ('{"reply": "line\\nnext", "fields": {}}', "line\nnext"),
        ('{"fields": {"reply": "nested"}, "reply": "top', "top"),  # only the top-level key
        ('{"note": "reply", "reply": "ok"}', "ok"),  # "reply" as a value isn't the key
    ],
)
def test_partial_reply(arguments: str, expected: Optional[str]):
    assert partial_reply(arguments) == expected


def test_partial_reply_only_grows():
    full = json.dumps({"documentId": "x", "reply": 'Hi "there"\né\U0001F600 ok', "party1": {}})
    seen = ""
    for end in range(len(full) + 1):
        current = partial_reply(full[:end]) or ""
        assert current.startswith(seen)
        seen = current
    assert seen == 'Hi "there"\né\U0001F600 ok'
