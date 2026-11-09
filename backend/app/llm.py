"""Minimal OpenRouter client (OpenAI-compatible chat completions API)."""

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

import httpx

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# Room for a chat turn (plus any reasoning tokens); an explicit cap also stops
# OpenRouter reserving credit for the model maximum.
MAX_TOKENS = 4000


class LLMError(Exception):
    """The model could not be reached or returned an unusable answer."""


@dataclass(frozen=True)
class LLMReply:
    text: str
    # Arguments of the model's call to the offered tool, or None if it answered in plain text.
    tool_arguments: Optional[Dict[str, Any]]


class OpenRouterClient:
    def __init__(self, api_key: str, models: Sequence[str], transport: Optional[httpx.BaseTransport] = None):
        if not models:
            raise ValueError("at least one model is required")
        self.models = list(models)
        self._http = httpx.Client(
            base_url=OPENROUTER_BASE_URL,
            headers={"Authorization": f"Bearer {api_key}", "X-Title": "prelegal"},
            # Free models can take 20s+ per turn, longer when falling back.
            timeout=httpx.Timeout(90.0, connect=10.0),
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def chat_with_tool(
        self,
        system: str,
        messages: List[Dict[str, str]],
        tool_name: str,
        tool_description: str,
        parameters: Dict[str, Any],
    ) -> LLMReply:
        """Runs one completion offering a single tool.

        The tool can't be forced: current Claude models reject a forced
        tool_choice, and strict structured outputs are too slow to compile for
        this schema. The system prompt asks for the tool instead, and callers
        handle a plain-text answer.
        """
        # Several models: OpenRouter tries them in order when one errors or is rate-limited.
        model_choice = {"model": self.models[0]} if len(self.models) == 1 else {"models": self.models}
        payload = {
            **model_choice,
            "max_tokens": MAX_TOKENS,
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
            response = self._http.post("/chat/completions", json=payload)
        except httpx.HTTPError as exc:
            raise LLMError(f"request to OpenRouter failed: {exc!r}") from exc
        if response.status_code != 200:
            raise LLMError(f"OpenRouter returned {response.status_code}: {response.text[:500]}")

        try:
            message = response.json()["choices"][0]["message"]
            calls = [c["function"] for c in message.get("tool_calls") or [] if c["function"]["name"] == tool_name]
            arguments = json.loads(calls[0]["arguments"]) if calls else None
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError(f"unexpected OpenRouter response: {response.text[:500]}") from exc
        return LLMReply(text=(message.get("content") or "").strip(), tool_arguments=arguments)
