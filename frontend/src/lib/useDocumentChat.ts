import { useState } from "react";

import { api, ApiError, type ChatMessage } from "@/lib/api";
import type { Draft, DraftChanges } from "@/lib/documents/types";

/** Shown before the user types; sent with the history so the AI knows what it asked. */
export const GREETING =
  "Hi! I can help you create a standard business agreement, such as an NDA, a cloud service or " +
  "software license agreement, a pilot, a partnership or a data processing agreement, and fill " +
  "it in as we talk. What would you like to create?";

const FALLBACK_ERROR = "Couldn’t reach the assistant. Please try again.";

interface Options {
  draft: Draft;
  /** The user's local date; "" until hydrated, which keeps sending disabled. */
  today: string;
  onChanges: (changes: DraftChanges) => void;
}

/**
 * Conversation state for the drafting chat. Each turn sends the whole
 * conversation with the current draft; the assistant's draft changes are
 * passed to `onChanges`. Kept in page state only: a refresh starts over.
 */
export function useDocumentChat({ draft, today, onChanges }: Options) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: GREETING }]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = today !== "";

  /** Sends a user message; resolves false (with the conversation rolled back) if the turn failed. */
  async function send(content: string): Promise<boolean> {
    const text = content.trim();
    if (!text || sending || !ready) return false;

    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setError(null);
    setSending(true);
    try {
      const { reply, ...changes } = await api.chat({ messages: history, draft, today });
      onChanges(changes);
      setMessages([...history, { role: "assistant", content: reply }]);
      return true;
    } catch (err) {
      console.error("Chat request failed", err);
      setMessages(messages);
      setError(err instanceof ApiError && err.detail ? err.detail : FALLBACK_ERROR);
      return false;
    } finally {
      setSending(false);
    }
  }

  return { messages, sending, error, ready, send };
}
