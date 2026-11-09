import type { Page, Route } from "@playwright/test";

/**
 * In-memory stand-ins for the backend's /api routes (the real backend and LLM
 * are never involved). Playwright tries the most recently added route first.
 */

export interface ChatTurn {
  reply: string;
  documentId?: string;
  fields?: Record<string, string>;
  party1?: Record<string, string>;
  party2?: Record<string, string>;
}

export type ChatAnswer = ChatTurn | { status: number; detail: string } | { streamError: string };

export interface ChatRequestBody {
  messages: { role: string; content: string }[];
  draft: Record<string, unknown>;
  today: string;
}

/** Answers /api/chat with the given answers in order, as NDJSON streams, and records each request body. */
export async function mockChat(page: Page, answers: ChatAnswer[]) {
  const requests: ChatRequestBody[] = [];
  await page.route("**/api/chat", async (route: Route) => {
    requests.push(route.request().postDataJSON());
    const answer = answers.shift();
    if (!answer) throw new Error("unexpected chat request");
    if ("status" in answer) {
      await route.fulfill({ status: answer.status, json: { detail: answer.detail } });
      return;
    }
    const events =
      "streamError" in answer
        ? [{ type: "delta", text: "Let me" }, { type: "error", detail: answer.streamError }]
        : [
            { type: "delta", text: answer.reply.slice(0, 4) },
            { type: "delta", text: answer.reply.slice(4) },
            { type: "done", turn: { fields: {}, ...answer } },
          ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: events.map((e) => JSON.stringify(e) + "\n").join(""),
    });
  });
  return requests;
}

export interface StoredDocument {
  id: number;
  title: string | null;
  draft: Record<string, unknown>;
  messages: { role: string; content: string }[];
  createdAt: string;
  updatedAt: string;
}

const PARTY = { name: "", title: "", company: "", noticeAddress: "" };

export function storedDocument(id: number, overrides: Partial<StoredDocument> = {}): StoredDocument {
  return {
    id,
    title: null,
    draft: { documentId: null, fields: {}, party1: PARTY, party2: PARTY },
    messages: [{ role: "assistant", content: "Hi!" }],
    createdAt: "2026-03-14T09:00:00Z",
    updatedAt: "2026-03-14T09:00:00Z",
    ...overrides,
  };
}

interface BackendOptions {
  /** The signed-in user, or null for a signed-out visitor. */
  user?: { id: number; email: string } | null;
  documents?: StoredDocument[];
}

/** Mocks accounts and documents; returns the live state for assertions. */
export async function mockBackend(page: Page, { user = { id: 1, email: "ada@example.com" }, documents = [] }: BackendOptions = {}) {
  const state = {
    user,
    documents: [...documents],
    saves: [] as { method: string; id?: number; body: Record<string, unknown> }[],
    /** Answer every request with 401, as after the session expired. */
    sessionExpired: false,
  };
  const unauthorized = (route: Route) => route.fulfill({ status: 401, json: { detail: "Please sign in." } });
  let nextId = Math.max(0, ...documents.map((d) => d.id)) + 1;

  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as { email?: string; password?: string } | null;
    if (path.endsWith("/me")) {
      return state.user && !state.sessionExpired ? route.fulfill({ json: state.user }) : unauthorized(route);
    }
    if (path.endsWith("/logout")) {
      state.user = null;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/login") && body?.password !== "correct horse battery") {
      return route.fulfill({ status: 401, json: { detail: "Incorrect email or password." } });
    }
    state.user = { id: 1, email: body!.email! };
    state.sessionExpired = false;
    return route.fulfill({ status: path.endsWith("/signup") ? 201 : 200, json: state.user });
  });

  await page.route(/\/api\/documents(\/\d+)?$/, async (route) => {
    if (!state.user || state.sessionExpired) return unauthorized(route);
    const request = route.request();
    const id = Number(new URL(request.url()).pathname.split("/")[3]) || undefined;
    const method = request.method();
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const doc = state.documents.find((d) => d.id === id);
    const now = new Date().toISOString().replace("Z", "000Z");

    if (method === "GET" && id === undefined) {
      const listing = [...state.documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return route.fulfill({ json: listing.map((d) => ({ ...d, messages: undefined })) });
    }
    if (method === "POST") {
      state.saves.push({ method, body });
      const created = storedDocument(nextId++, { ...body, createdAt: now, updatedAt: now } as Partial<StoredDocument>);
      state.documents.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (!doc) return route.fulfill({ status: 404, json: { detail: "Document not found." } });
    if (method === "GET") return route.fulfill({ json: doc });
    if (method === "PATCH") {
      state.saves.push({ method, id, body });
      Object.assign(doc, body, { updatedAt: now });
      return route.fulfill({ json: doc });
    }
    if (method === "DELETE") {
      state.documents = state.documents.filter((d) => d !== doc);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 405 });
  });

  return state;
}
