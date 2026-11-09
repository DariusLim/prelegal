/**
 * Typed client for the FastAPI backend. Requests go to same-origin `/api/*`,
 * which next.config.ts rewrites to the backend, so no CORS setup is needed.
 * The session lives in an HttpOnly cookie that the browser sends by itself.
 */

import type { Draft, DraftChanges } from "@/lib/documents/types";

export interface Health {
  status: string;
  database: string;
}

export interface TemplateSummary {
  id: number;
  name: string;
  description: string;
  /** Path relative to the repo root, e.g. "templates/Mutual-NDA.md". */
  filename: string;
}

export interface User {
  id: number;
  email: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  draft: Draft;
  /** The user's local date (YYYY-MM-DD), for resolving "today" or "next Monday". */
  today: string;
}

/** The assistant's reply plus the draft changes it made this turn. */
export interface ChatResponse extends DraftChanges {
  reply: string;
}

/** A saved document as listed; `title` is null unless the user renamed it. */
export interface DocumentSummary {
  id: number;
  title: string | null;
  draft: Draft;
  createdAt: string;
  updatedAt: string;
}

export interface SavedDocument extends DocumentSummary {
  messages: ChatMessage[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The backend's `detail` message, when it sent one. */
    readonly detail: string | undefined,
    method: string,
    path: string,
  ) {
    super(detail ?? `${method} /api${path} failed with status ${status}`);
    this.name = "ApiError";
  }
}

/** Dispatched on `window` when a request is rejected because the session ended. */
export const UNAUTHORIZED_EVENT = "prelegal:unauthorized";

/** Per-request options; `signal` lets callers cancel (e.g. on unmount). */
export interface RequestOptions {
  signal?: AbortSignal;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const { detail } = (await response.json()) as { detail?: unknown };
    if (typeof detail === "string") return detail;
    // FastAPI validation errors: [{msg: "Value error, enter a valid email address", ...}, ...]
    const first = Array.isArray(detail) ? (detail[0] as { msg?: unknown } | undefined) : undefined;
    return typeof first?.msg === "string" ? first.msg.replace(/^Value error, /, "") : undefined;
  } catch {
    return undefined;
  }
}

async function send(method: Method, path: string, body: unknown, { signal }: RequestOptions = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: { Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // An expired session anywhere but the sign-in calls themselves sends the user back to sign in.
    if (response.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(response.status, await errorDetail(response), method, path);
  }
  return response;
}

async function request<T>(method: Method, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const response = await send(method, path, body, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** One event of the streamed chat (newline-delimited JSON, see backend/app/routes.py). */
type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "reset"; text: string }
  | { type: "done"; turn: ChatResponse }
  | { type: "error"; detail: string };

export interface ChatOptions extends RequestOptions {
  /** Called with the reply as streamed so far. */
  onText?: (text: string) => void;
}

/** Splits a byte stream into lines. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop()!;
    yield* parts;
  }
  if (buffer) yield buffer;
}

/** One streamed turn of the drafting chat; resolves with the final reply and draft changes. */
async function chat(body: ChatRequest, { onText, ...options }: ChatOptions = {}): Promise<ChatResponse> {
  const response = await send("POST", "/chat", body, options);
  let text = "";
  for await (const line of lines(response.body!)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as ChatEvent;
    switch (event.type) {
      case "delta":
      case "reset":
        text = event.type === "delta" ? text + event.text : event.text;
        onText?.(text);
        break;
      case "done":
        return event.turn;
      case "error":
        throw new ApiError(502, event.detail, "POST", "/chat");
    }
  }
  throw new ApiError(502, undefined, "POST", "/chat");
}

export const api = {
  health: (options?: RequestOptions) => request<Health>("GET", "/health", undefined, options),
  listTemplates: (options?: RequestOptions) => request<TemplateSummary[]>("GET", "/templates", undefined, options),

  me: (options?: RequestOptions) => request<User>("GET", "/auth/me", undefined, options),
  signUp: (credentials: Credentials) => request<User>("POST", "/auth/signup", credentials),
  logIn: (credentials: Credentials) => request<User>("POST", "/auth/login", credentials),
  logOut: () => request<void>("POST", "/auth/logout"),

  listDocuments: (options?: RequestOptions) => request<DocumentSummary[]>("GET", "/documents", undefined, options),
  getDocument: (id: number, options?: RequestOptions) =>
    request<SavedDocument>("GET", `/documents/${id}`, undefined, options),
  createDocument: (body: { title?: string | null; draft: Draft; messages: ChatMessage[] }) =>
    request<SavedDocument>("POST", "/documents", body),
  /** Changes only the fields given; `title: null` goes back to the derived title. */
  updateDocument: (id: number, body: { title?: string | null; draft?: Draft; messages?: ChatMessage[] }) =>
    request<SavedDocument>("PATCH", `/documents/${id}`, body),
  deleteDocument: (id: number) => request<void>("DELETE", `/documents/${id}`),

  /** One turn of the drafting chat, streamed. */
  chat,
};
