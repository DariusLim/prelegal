import { useEffect, useRef, useState } from "react";

import { api, ApiError, type ChatMessage } from "@/lib/api";
import type { Draft, DraftChanges } from "@/lib/documents/types";

/** Shown before the user types; sent with the history so the AI knows what it asked. */
export const GREETING =
  "Hi! I can help you create a standard business agreement, such as an NDA, a cloud service or " +
  "software license agreement, a pilot, a partnership or a data processing agreement, and fill " +
  "it in as we talk. What would you like to create?";

const FALLBACK_ERROR = "Couldn’t reach the assistant. Please try again.";

interface Options {
  /** The saved conversation to continue; a new one starts with the greeting. */
  initialMessages?: ChatMessage[];
  draft: Draft;
  /** The user's local date; "" until hydrated, which keeps sending disabled. */
  today: string;
  /** Called after each successful turn with its draft changes and the whole conversation. */
  onTurn: (changes: DraftChanges, messages: ChatMessage[]) => void;
}

/**
 * Conversation state for the drafting chat. Each turn sends the whole
 * conversation with the current draft and streams the reply (`streaming`
 * holds it until the turn completes); the assistant's draft changes are
 * passed to `onTurn`. A turn still running when the chat unmounts is aborted.
 */
export function useDocumentChat({ initialMessages, draft, today, onTurn }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? [{ role: "assistant", content: GREETING }],
  );
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ready = today !== "";

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Sends a user message; resolves false (with the conversation rolled back) if the turn failed. */
  async function send(content: string): Promise<boolean> {
    const text = content.trim();
    if (!text || sending || !ready) return false;

    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    const abort = new AbortController();
    abortRef.current = abort;
    setMessages(history);
    setError(null);
    setStreaming("");
    setSending(true);
    try {
      const { reply, ...changes } = await api.chat(
        { messages: history, draft, today },
        { signal: abort.signal, onText: setStreaming },
      );
      const next: ChatMessage[] = [...history, { role: "assistant", content: reply }];
      setMessages(next);
      onTurn(changes, next);
      return true;
    } catch (err) {
      if (abort.signal.aborted) return false;
      console.error("Chat request failed", err);
      setMessages(messages);
      setError(err instanceof ApiError && err.detail ? err.detail : FALLBACK_ERROR);
      return false;
    } finally {
      if (!abort.signal.aborted) {
        setSending(false);
        setStreaming("");
      }
    }
  }

  return { messages, sending, streaming, error, ready, send };
}
