/**
 * Typed client for the FastAPI backend. Requests go to same-origin `/api/*`,
 * which next.config.ts rewrites to the backend, so no CORS setup is needed.
 */

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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`GET /api${path} failed with status ${status}`);
    this.name = "ApiError";
  }
}

/** Per-request options; `signal` lets callers cancel (e.g. on unmount). */
export interface RequestOptions {
  signal?: AbortSignal;
}

async function getJson<T>(path: string, { signal }: RequestOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new ApiError(response.status, path);
  return (await response.json()) as T;
}

export const api = {
  health: (options?: RequestOptions) => getJson<Health>("/health", options),
  listTemplates: (options?: RequestOptions) => getJson<TemplateSummary[]>("/templates", options),
};
