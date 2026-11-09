# prelegal

Platform for drafting common legal agreements from the Common Paper templates dataset.
Work is tracked in Jira (project `PL`, https://yuhaolim.atlassian.net). Branches are named `PL-<n>-<slug>`
and commit messages start with `PL-<n>: `. Changes land on `main` via PRs.

## Layout

- `frontend/`: Next.js 16 (App Router, React 19, Tailwind 4) app. Read `frontend/AGENTS.md` first: this
  Next.js version has breaking changes, and its docs are in `frontend/node_modules/next/dist/docs/`.
  The document engine (parse, build, apply changes) is in `src/lib/documents/`, chat state in
  `src/lib/useDocumentChat.ts`, autosave in `src/lib/useAutosave.ts`, and the UI in `src/components/`
  (`App` = auth gate + views). Standard Terms are served per document by `src/app/standard-terms/[id]`.
- `backend/`: FastAPI + SQLAlchemy 2 on Python 3.9+. Use `typing.Optional`/`List` rather than `X | None`,
  because Pydantic evaluates annotations at runtime. The chat is `app/drafting_chat.py` (prompt,
  sanitising, streaming), `app/documents.py` (library) and `app/llm.py` (OpenRouter). Accounts are
  `app/auth.py`, saved documents `app/saved_documents.py`. Schema changes need an Alembic migration
  (`backend/migrations`, applied on startup; `alembic check` must pass).
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
cd backend && .venv/bin/alembic check     # models and migrations agree (needs `alembic upgrade head` first)
cd frontend && npm test                  # unit tests (Vitest)
cd frontend && npm run test:e2e          # Playwright, against a production build on :3100
cd frontend && npm run lint && npx next typegen && npx tsc --noEmit  # typegen: RouteContext types
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
- Frontend e2e tests mock the backend with `page.route` (`e2e/mock-backend.ts`). Never call the real LLM
  from tests.
- Every `/api` route except health, templates and the sign-up/in/out endpoints requires a session (`Depends(current_user)`),
  and document queries must filter by the user. `/api/chat` streams NDJSON events (see backend README).
- `next.config.ts` rewrites are fixed at build time: set `BACKEND_URL` before `next build`.

## Implementation status (2026-11-09)

Done: PL-2 to PL-7. To Do: PL-1 (company website).

- **PL-2** (PR #3): Common Paper templates dataset and `catalog.json`.
- **PL-3** (PR #4): Mutual NDA Creator (`frontend/`). A live preview and PDF export via `@react-pdf`, driven
  by a form (replaced by the chat in PL-5). The Standard Terms are read from `templates/` at build time.
- **PL-4** (PR #5): v1 technical foundation, with no product changes.
  - FastAPI backend with a temporary SQLite DB at `backend/data/prelegal.db`. The DB is disposable: the
    tables are created and the `templates` table is re-synced from `catalog.json` on every startup
    (superseded by PL-7: Alembic migrations, durable data).
  - Endpoints: `GET /api/health` and `GET /api/templates`.
  - Frontend `/api` proxy and a typed client in `frontend/src/lib/api.ts`.
  - `scripts/start.sh` / `scripts/stop.sh`.
- **PL-5** (PR #6): AI chat replaces the NDA form (still Mutual NDA only).
  - `POST /api/chat` via OpenRouter (Claude Sonnet 5.5 at first; free models since PL-6). Each turn
    returns the reply plus validated changes.
  - Frontend chat + update merging. The conversation lives in page state only (not persisted).
- **PL-6** (PR #7): all 11 Common Paper documents, with one generic engine driven by `document-types.json`.
  - The AI picks or switches the document (switching keeps the parties). For unsupported requests it
    suggests the closest document. Before a choice, a clickable picker lists the documents.
  - Generic Cover Page + nested Standard Terms parser. The Mutual NDA's bespoke form model is gone.
  - Free OpenRouter models by default (Nemotron 3.5 Super with fallbacks), at about 10–30s per turn.
- **PL-7** (PR #8): multiple users and final polish.
  - Email/password accounts (Argon2), cookie sessions stored as token hashes. Alembic migrations; the DB
    is now durable.
  - Each user's documents (draft + conversation) autosave after every turn; a list to resume, rename and
    delete them.
  - Streamed chat replies (NDJSON). The default Nemotron model sends tool calls in one piece, so replies
    often still appear at once.
  - Standard Terms lazy-loaded per document (the page went from shipping ~316 KB of terms to 28 KB HTML).
  - Disclaimer footer, phone layout, empty/error/saving states. GitHub Actions CI.
- **Not yet done**: no password reset or email verification, no rate limiting on sign-in, no sharing
  between users.
