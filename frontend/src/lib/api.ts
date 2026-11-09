/**
 * Typed client for the FastAPI backend. Requests go to same-origin `/api/*`,
 * which next.config.ts rewrites to the backend, so no CORS setup is needed.
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

/** Per-request options; `signal` lets callers cancel (e.g. on unmount). */
export interface RequestOptions {
  signal?: AbortSignal;
}

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const detail = (body as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(method: "GET" | "POST", path: string, body: unknown, { signal }: RequestOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: { Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response), method, path);
  return (await response.json()) as T;
}

export const api = {
  health: (options?: RequestOptions) => request<Health>("GET", "/health", undefined, options),
  listTemplates: (options?: RequestOptions) => request<TemplateSummary[]>("GET", "/templates", undefined, options),
  /** One turn of the drafting chat. */
  chat: (body: ChatRequest, options?: RequestOptions) => request<ChatResponse>("POST", "/chat", body, options),
};
