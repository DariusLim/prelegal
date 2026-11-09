"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { api, ApiError, type ChatMessage } from "@/lib/api";
import type { NdaFormData, NdaUpdates } from "@/lib/nda/types";

/** Shown before the user types; sent with the history so the AI knows what it asked. */
export const GREETING =
  "Hi! I'll help you put together a Mutual Non-Disclosure Agreement and fill it in as we talk. " +
  "To start: who are the two parties, and what will you be sharing confidential information for?";

const FALLBACK_ERROR = "Couldn’t reach the assistant. Please try again.";
const MAX_MESSAGE_LENGTH = 4000;

function MessageBubble({ message }: { message: ChatMessage }) {
  const fromUser = message.role === "user";
  return (
    <div className={fromUser ? "flex justify-end" : "flex justify-start"}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          fromUser ? "rounded-br-sm bg-stone-900 text-white" : "rounded-bl-sm bg-stone-100 text-stone-900"
        }`}
      >
        <span className="sr-only">{fromUser ? "You: " : "Assistant: "}</span>
        {message.content}
      </p>
    </div>
  );
}

interface NdaChatProps {
  data: NdaFormData;
  /** The user's local date; "" until hydrated, which keeps the input disabled. */
  today: string;
  onUpdate: (updates: NdaUpdates) => void;
}

/** Free-form chat with the AI assistant, which fills in the NDA as the user answers. */
export function NdaChat({ data, today, onUpdate }: NdaChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: GREETING }]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ready = today !== "";
  const canSend = ready && !sending && draft.trim() !== "";

  // Keep the newest message in view.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const content = draft.trim();
    if (!canSend) return;

    const history: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(history);
    setDraft("");
    setError(null);
    setSending(true);
    try {
      const { reply, updates } = await api.chat({ messages: history, fields: data, today });
      onUpdate(updates);
      setMessages([...history, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error("Chat request failed", err);
      // Roll back so the user can retry the same message.
      setMessages(messages);
      setDraft(content);
      setError(err instanceof ApiError && err.detail ? err.detail : FALLBACK_ERROR);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a new line. Ignore Enter while an IME is composing.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-[70vh] min-h-[28rem] flex-col rounded-lg border border-stone-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div ref={logRef} role="log" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message, i) => (
          <MessageBubble key={i} message={message} />
        ))}
        {sending && (
          <p role="status" className="text-sm text-stone-500">
            Assistant is typing…
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-stone-200 p-3">
        <textarea
          ref={inputRef}
          aria-label="Message"
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          value={draft}
          disabled={!ready}
          placeholder="Type your answer…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          className="block w-full resize-none rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200 disabled:bg-stone-100"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
