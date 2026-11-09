import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, UNAUTHORIZED_EVENT } from "../api";
import { createDraft } from "../documents/buildDocument";

const chatBody = { messages: [{ role: "user" as const, content: "hi" }], draft: createDraft(null), today: "2026-11-09" };

/** An NDJSON response delivered in chunks of `chunkSize` bytes. */
function streamedResponse(events: object[], chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(events.map((e) => JSON.stringify(e) + "\n").join(""));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api client", () => {
  it("requests same-origin /api paths and returns parsed JSON", async () => {
    const templates = [{ id: 1, name: "Mutual NDA", description: "d", filename: "templates/Mutual-NDA.md" }];
    const fetchMock = stubFetch(Response.json(templates));

    await expect(api.listTemplates()).resolves.toEqual(templates);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/templates",
      expect.objectContaining({ method: "GET", body: undefined, headers: { Accept: "application/json" } }),
    );
  });

  it("streams chat turns: reply text as it arrives, then the final turn", async () => {
    const turn = { reply: "Which state?", documentId: "mutual-nda", fields: { governingLaw: "Delaware" } };
    // Events split across chunks at arbitrary points, including inside a multi-byte character.
    const fetchMock = stubFetch(
      streamedResponse([
        { type: "delta", text: "Which " },
        { type: "reset", text: "Wh" },
        { type: "delta", text: "ich state?" },
        { type: "done", turn },
      ]),
    );
    const body = {
      messages: [{ role: "user" as const, content: "Delaware law" }],
      draft: createDraft(null),
      today: "2026-11-09",
    };
    const texts: string[] = [];

    await expect(api.chat(body, { onText: (t) => texts.push(t) })).resolves.toEqual(turn);
    expect(texts).toEqual(["Which ", "Wh", "Which state?"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("keeps multi-byte characters split across chunks intact", async () => {
    stubFetch(streamedResponse([{ type: "done", turn: { reply: "Café ☕" } }], 3));
    await expect(api.chat(chatBody)).resolves.toEqual({ reply: "Café ☕" });
  });

  it("rejects with the detail of an error event or a stream that ends early", async () => {
    stubFetch(streamedResponse([{ type: "delta", text: "Hm" }, { type: "error", detail: "The AI assistant couldn't respond." }]));
    await expect(api.chat(chatBody)).rejects.toMatchObject({ status: 502, detail: "The AI assistant couldn't respond." });

    stubFetch(streamedResponse([{ type: "delta", text: "Hm" }]));
    await expect(api.chat(chatBody)).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError carrying the backend's detail message", async () => {
    stubFetch(Response.json({ detail: "The AI assistant isn't configured" }, { status: 503 }));

    const error = await api.chat(chatBody).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, detail: "The AI assistant isn't configured" });
  });

  it("uses the first validation message as the detail", async () => {
    const detail = [{ loc: ["body", "email"], msg: "Value error, enter a valid email address", type: "value_error" }];
    stubFetch(Response.json({ detail }, { status: 422 }));

    await expect(api.signUp({ email: "x", password: "y" })).rejects.toMatchObject({
      status: 422,
      detail: "enter a valid email address",
    });
  });

  it("announces an expired session, except from the sign-in calls", async () => {
    const listener = vi.fn();
    vi.stubGlobal("window", new EventTarget());
    window.addEventListener(UNAUTHORIZED_EVENT, listener);

    stubFetch(Response.json({ detail: "Please sign in." }, { status: 401 }));
    await expect(api.listDocuments()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);

    stubFetch(Response.json({ detail: "Incorrect email or password." }, { status: 401 }));
    await expect(api.logIn({ email: "a@b.co", password: "wrong pass" })).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sends partial document updates and handles empty responses", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await expect(api.deleteDocument(7)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/7", expect.objectContaining({ method: "DELETE" }));

    stubFetch(Response.json({ id: 7, title: null }));
    await api.updateDocument(7, { title: null });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/documents/7");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(init!.body as string)).toEqual({ title: null });
  });

  it("throws ApiError without detail on a non-JSON error", async () => {
    stubFetch(new Response("down", { status: 502 }));

    const error = await api.health().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, detail: undefined, message: "GET /api/health failed with status 502" });
  });
});
