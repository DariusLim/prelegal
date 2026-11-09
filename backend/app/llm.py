"""Minimal OpenRouter client (OpenAI-compatible chat completions API, streamed)."""

import json
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Literal, Optional, Sequence

import httpx

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# Room for a chat turn (plus any reasoning tokens); an explicit cap also stops
# OpenRouter reserving credit for the model maximum.
MAX_TOKENS = 4000


class LLMError(Exception):
    """The model could not be reached or returned an unusable answer."""


@dataclass(frozen=True)
class Delta:
    """A streamed piece of the answer: plain-text content, or the offered tool's JSON arguments."""

    kind: Literal["content", "arguments"]
    text: str


class OpenRouterClient:
    def __init__(self, api_key: str, models: Sequence[str], transport: Optional[httpx.BaseTransport] = None):
        if not models:
            raise ValueError("at least one model is required")
        self.models = list(models)
        self._http = httpx.Client(
            base_url=OPENROUTER_BASE_URL,
            headers={"Authorization": f"Bearer {api_key}", "X-Title": "prelegal"},
            # Free models can take 20s+ per turn, longer when falling back. The
            # read timeout applies between streamed chunks.
            timeout=httpx.Timeout(90.0, connect=10.0),
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def stream_with_tool(
        self,
        system: str,
        messages: List[Dict[str, str]],
        tool_name: str,
        tool_description: str,
        parameters: Dict[str, Any],
    ) -> Iterator[Delta]:
        """Streams one completion offering a single tool.

        Yields content deltas and the deltas of the arguments of the model's
        call to `tool_name` (calls to anything else are ignored). The tool
        can't be forced: current Claude models reject a forced tool_choice,
        and strict structured outputs are too slow to compile for this schema.
        The system prompt asks for the tool instead, and callers handle a
        plain-text answer.
        """
        # Several models: OpenRouter tries them in order when one errors or is rate-limited.
        model_choice = {"model": self.models[0]} if len(self.models) == 1 else {"models": self.models}
        payload = {
            **model_choice,
            "max_tokens": MAX_TOKENS,
            "stream": True,
            "messages": [{"role": "system", "content": system}, *messages],
            "tools": [
                {
                    "type": "function",
                    "function": {"name": tool_name, "description": tool_description, "parameters": parameters},
                }
            ],
            "tool_choice": "auto",
        }
        try:
            with self._http.stream("POST", "/chat/completions", json=payload) as response:
                if response.status_code != 200:
                    raise LLMError(f"OpenRouter returned {response.status_code}: {response.read()[:500]!r}")
                yield from _parse_events(response.iter_lines(), tool_name)
        except httpx.HTTPError as exc:
            raise LLMError(f"request to OpenRouter failed: {exc!r}") from exc


def _parse_events(lines: Iterator[str], tool_name: str) -> Iterator[Delta]:
    """Turns server-sent events into deltas. Lines starting with ':' are keep-alive comments."""
    # Tool calls stream in pieces keyed by index; the name arrives with the first piece.
    call_names: Dict[int, str] = {}
    for line in lines:
        if not line.startswith("data:"):
            continue
        data = line[len("data:") :].strip()
        if data == "[DONE]":
            return
        try:
            event = json.loads(data)
            if "error" in event:
                raise LLMError(f"OpenRouter error mid-stream: {data[:500]}")
            choices = event.get("choices") or []
            delta = (choices[0].get("delta") or {}) if choices else {}
            if delta.get("content"):
                yield Delta("content", delta["content"])
            for call in delta.get("tool_calls") or []:
                index = call.get("index", 0)
                function = call.get("function") or {}
                if function.get("name"):
                    call_names[index] = function["name"]
                if call_names.get(index) == tool_name and function.get("arguments"):
                    yield Delta("arguments", function["arguments"])
        except (AttributeError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError(f"unexpected OpenRouter event: {data[:500]}") from exc
