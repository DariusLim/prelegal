import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "../api";
import { createDefaultFormData } from "../nda/buildDocument";

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

  it("POSTs chat turns as JSON", async () => {
    const reply = { reply: "Which state?", updates: { governingLaw: "Delaware" } };
    const fetchMock = stubFetch(Response.json(reply));
    const body = {
      messages: [{ role: "user" as const, content: "Delaware law" }],
      fields: createDefaultFormData(),
      today: "2026-11-09",
    };

    await expect(api.chat(body)).resolves.toEqual(reply);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("throws ApiError carrying the backend's detail message", async () => {
    stubFetch(Response.json({ detail: "The AI assistant isn't configured" }, { status: 503 }));

    const error = await api.chat({ messages: [], fields: createDefaultFormData(), today: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, detail: "The AI assistant isn't configured" });
  });

  it("throws ApiError without detail on a non-JSON error", async () => {
    stubFetch(new Response("down", { status: 502 }));

    const error = await api.health().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, detail: undefined, message: "GET /api/health failed with status 502" });
  });
});
