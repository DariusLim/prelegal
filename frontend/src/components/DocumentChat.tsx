"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { ChatMessage } from "@/lib/api";

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

interface DocumentChatProps {
  messages: ChatMessage[];
  sending: boolean;
  /** The assistant's reply as streamed so far, while `sending`. */
  streaming: string;
  error: string | null;
  /** False until hydrated; keeps the input disabled. */
  ready: boolean;
  /** Resolves false if the message failed, in which case it is put back in the input. */
  onSend: (text: string) => Promise<boolean>;
}

/** The chat panel: conversation log and message input. State lives in useDocumentChat. */
export function DocumentChat({ messages, sending, streaming, error, ready, onSend }: DocumentChatProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = ready && !sending && draft.trim() !== "";

  // Keep the newest message in view.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending, streaming]);

  async function send() {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    const sent = await onSend(text);
    if (!sent) setDraft(text.trim());
    inputRef.current?.focus();
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
    <div className="flex h-[60vh] min-h-[24rem] flex-col sm:h-[70vh] sm:min-h-[28rem] rounded-lg border border-stone-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div ref={logRef} role="log" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message, i) => (
          <MessageBubble key={i} message={message} />
        ))}
        {sending && streaming && (
          // Hidden from screen readers, which would re-read the log on every streamed piece;
          // the complete reply is announced once it arrives.
          <div aria-hidden="true">
            <MessageBubble message={{ role: "assistant", content: streaming }} />
          </div>
        )}
        {sending && (
          <p role="status" className={streaming ? "sr-only" : "text-sm text-stone-500"}>
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
