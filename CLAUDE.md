# prelegal

Platform for drafting common legal agreements from the Common Paper templates dataset.
Work is tracked in Jira (project `PL`, https://yuhaolim.atlassian.net). Branches are named `PL-<n>-<slug>`
and commit messages start with `PL-<n>: `. Changes land on `main` via PRs.

## Layout

- `frontend/`: Next.js 16 (App Router, React 19, Tailwind 4) app. Read `frontend/AGENTS.md` first: this
  Next.js version has breaking changes, and its docs are in `frontend/node_modules/next/dist/docs/`.
- `backend/`: FastAPI + SQLAlchemy 2 on Python 3.9+. Use `typing.Optional`/`List` rather than `X | None`,
  because Pydantic evaluates annotations at runtime.
- `templates/` + `catalog.json`: Common Paper templates dataset (CC BY 4.0).
- `document-types.json`: the 11 documents the assistant can create (fields, party roles, Standard Terms
  template). Read by both apps; add or change documents here.
- `scripts/`: `start.sh` / `stop.sh` for the whole stack.

## Commands

```bash
cp .env.example .env                     # once; set OPENROUTER_API_KEY (needed for the AI chat)
scripts/start.sh                         # install deps if needed, start backend :8000 + frontend :3000
scripts/stop.sh                          # stop both (PIDs/logs in .run/)
cd backend && .venv/bin/python -m pytest  # backend tests
cd frontend && npm test                  # unit tests (Vitest)
cd frontend && npm run test:e2e          # Playwright, against a production build on :3100
cd frontend && npm run lint && npx tsc --noEmit
```

Ports can be overridden with `BACKEND_PORT` / `FRONTEND_PORT`. `start.sh` refuses to start if a port is in use.

## Conventions

- The browser calls the backend only through same-origin `/api/*`. `next.config.ts` rewrites these to
  `BACKEND_URL`, so there's no CORS setup. All backend routes live under `/api`.
- Never commit secrets. `.env*` is git-ignored except `.env.example`. `.codex/` contains a token and is
  excluded locally.
- The LLM is called only from the backend (`backend/app/llm.py`, OpenRouter, key `OPENROUTER_API_KEY` in
  the root `.env`). Free models are the default (`OPENROUTER_MODEL` is a comma-separated fallback list).
  Always set `max_tokens`. Use `tool_choice: "auto"`, because Claude via OpenRouter rejects a forced
  tool. Handle plain-text answers, and sanitise model output against `document-types.json`.
- Frontend e2e tests mock `/api/chat` with `page.route`. Never call the real LLM from tests.

## Implementation status (2026-11-09)

Done: PL-2 to PL-6. To Do: PL-1 (company website), PL-7 (multiple users, final polish).

- **PL-2** (PR #3): Common Paper templates dataset and `catalog.json`.
- **PL-3** (PR #4): Mutual NDA Creator (`frontend/`). A live preview and PDF export via `@react-pdf`, driven
  by a form (replaced by the chat in PL-5). The Standard Terms are read from `templates/` at build time.
- **PL-4** (PR #5): v1 technical foundation, with no product changes.
  - FastAPI backend with a temporary SQLite DB at `backend/data/prelegal.db`. The DB is disposable: the
    tables are created and the `templates` table is re-synced from `catalog.json` on every startup.
  - Endpoints: `GET /api/health` and `GET /api/templates`.
  - Frontend `/api` proxy and a typed client in `frontend/src/lib/api.ts`.
  - `scripts/start.sh` / `scripts/stop.sh`.
- **PL-5** (PR #6): AI chat replaces the NDA form (still Mutual NDA only).
  - `POST /api/chat` with Claude Sonnet 5.5 via OpenRouter. Each turn returns `{reply, updates}`, and the
    updates are Pydantic-validated.
  - Frontend chat + update merging. The conversation lives in page state only (not persisted).
- **PL-6**: all 11 Common Paper documents, with one generic engine driven by `document-types.json`.
  - The AI picks or switches the document (switching keeps the parties). For unsupported requests it
    suggests the closest document. Before a choice, a clickable picker lists the documents.
  - Generic Cover Page + nested Standard Terms parser. The Mutual NDA's bespoke form model is gone.
  - Free OpenRouter models by default (Nemotron 3.5 Super with fallbacks), at about 10–30s per turn.
- **Not yet done**: no migrations (add Alembic before storing durable data), no auth, no CI, no streaming
  chat responses, no chat persistence. All Standard Terms are shipped in the page payload, which could
  be lazy-loaded per document.
