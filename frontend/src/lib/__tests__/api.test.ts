import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "../api";

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
    expect(fetchMock).toHaveBeenCalledWith("/api/templates", expect.objectContaining({
      headers: expect.objectContaining({ Accept: "application/json" }),
    }));
  });

  it("throws ApiError on a non-2xx response", async () => {
    stubFetch(new Response("down", { status: 502 }));

    const error = await api.health().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502 });
  });
});
