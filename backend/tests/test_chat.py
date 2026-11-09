import json
from pathlib import Path
from typing import Any, Callable, Dict, List

import httpx
import pytest
from fastapi.testclient import TestClient

from app.llm import OpenRouterClient
from app.nda_chat import RESPOND_TOOL_SCHEMA
from app.routes import get_llm
from tests.conftest import make_client

PARTY = {"name": "", "title": "", "company": "", "noticeAddress": ""}
FIELDS = {
    "purpose": "Evaluating whether to enter into a business relationship with the other party.",
    "effectiveDate": "",
    "mndaTermType": "expires",
    "mndaTermYears": 1,
    "confidentialityType": "years",
    "confidentialityYears": 1,
    "governingLaw": "",
    "jurisdiction": "",
    "modifications": "",
    "party1": PARTY,
    "party2": PARTY,
}
GREETING = "Hi! Who are the two parties to this NDA?"


def chat_request(*user_messages: str) -> Dict[str, Any]:
    messages = [{"role": "assistant", "content": GREETING}]
    messages += [{"role": "user", "content": m} for m in user_messages]
    return {"messages": messages, "fields": FIELDS, "today": "2026-11-09"}


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

    llm = OpenRouterClient("test-key", "test/model", transport=httpx.MockTransport(transport))
    with make_client(tmp_path) as client:
        client.app.dependency_overrides[get_llm] = lambda: llm
        yield client, lambda handler: state.update(handler=handler), requests
    llm.close()


def test_chat_returns_reply_and_only_the_updated_fields(chat_client):
    client, set_handler, requests = chat_client
    set_handler(
        lambda _: tool_call_response(
            {
                "reply": "Great. Which state's law should govern?",
                "updates": {"party1": {"company": "Acme, Inc."}, "party2": {"company": "Globex"}, "mndaTermYears": 2},
            }
        )
    )

    response = client.post("/api/chat", json=chat_request("Acme and Globex, for 2 years"))

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Great. Which state's law should govern?",
        "updates": {"party1": {"company": "Acme, Inc."}, "party2": {"company": "Globex"}, "mndaTermYears": 2},
    }


def test_chat_sends_context_and_offers_the_respond_tool(chat_client):
    client, set_handler, requests = chat_client
    set_handler(lambda _: tool_call_response({"reply": "Noted.", "updates": {}}))

    client.post("/api/chat", json=chat_request("Acme and Globex"))

    (payload,) = requests
    assert payload["model"] == "test/model"
    assert payload["max_tokens"] > 0
    assert payload["tools"][0]["function"]["name"] == "respond"
    assert payload["tools"][0]["function"]["parameters"] == RESPOND_TOOL_SCHEMA
    system, *messages = payload["messages"]
    assert system["role"] == "system"
    assert "2026-11-09" in system["content"]
    assert '"mndaTermType": "expires"' in system["content"]
    # The canned greeting moves into the system prompt; the conversation starts with the user.
    assert GREETING in system["content"]
    assert messages == [{"role": "user", "content": "Acme and Globex"}]


def test_tool_schema_is_self_contained():
    assert "$defs" not in RESPOND_TOOL_SCHEMA
    assert "$ref" not in json.dumps(RESPOND_TOOL_SCHEMA)
    party1 = RESPOND_TOOL_SCHEMA["properties"]["updates"]["properties"]["party1"]
    assert "noticeAddress" in json.dumps(party1)


@pytest.mark.parametrize(
    "upstream",
    [
        httpx.Response(500, text="boom"),
        tool_call_response("not json"),
        tool_call_response({"reply": "x", "updates": {}}, name="other_tool"),
        tool_call_response({"reply": "x", "updates": {"mndaTermYears": 0}}),
        tool_call_response({"reply": "x", "updates": {"effectiveDate": "next week"}}),
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


def test_effective_date_can_be_reset_to_today(chat_client):
    client, set_handler, _ = chat_client
    set_handler(lambda _: tool_call_response({"reply": "Today it is.", "updates": {"effectiveDate": ""}}))

    response = client.post("/api/chat", json=chat_request("start today"))

    assert response.status_code == 200
    assert response.json()["updates"] == {"effectiveDate": ""}


def test_plain_text_answer_becomes_reply_without_updates(chat_client):
    client, set_handler, _ = chat_client
    set_handler(lambda _: httpx.Response(200, json={"choices": [{"message": {"content": " Which state? "}}]}))

    response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 200
    assert response.json() == {"reply": "Which state?", "updates": {}}


def test_request_must_end_with_a_user_message(chat_client):
    client, _, requests = chat_client
    body = chat_request()  # greeting only

    assert client.post("/api/chat", json=body).status_code == 422
    assert requests == []


def test_chat_without_api_key_is_503(tmp_path: Path):
    with make_client(tmp_path) as client:
        response = client.post("/api/chat", json=chat_request("hello"))

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]
