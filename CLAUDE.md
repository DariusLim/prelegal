# prelegal

Platform for drafting common legal agreements from the Common Paper templates dataset.
Work is tracked in Jira (project `PL`, https://yuhaolim.atlassian.net). Branches are named `PL-<n>-<slug>`
and commit messages start with `PL-<n>: `. Changes land on `main` via PRs.

## Layout

- `frontend/`: Next.js 16 (App Router, React 19, Tailwind 4) app. Read `frontend/AGENTS.md` first: this
  Next.js version has breaking changes, and its docs are in `frontend/node_modules/next/dist/docs/`.
- `backend/`: FastAPI + SQLAlchemy 2 on Python 3.9+. Use `typing.Optional`/`List` rather than `X | None`,
  because Pydantic evaluates annotations at runtime.
- `templates/` + `catalog.json`: Common Paper templates dataset (CC BY 4.0), read by both apps.
- `scripts/`: `start.sh` / `stop.sh` for the whole stack.

## Commands

```bash
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
- Never commit secrets. `.env*` is git-ignored. `.codex/` contains a token and is excluded locally.

## Implementation status (2026-11-09)

- **PL-2**: Common Paper templates dataset and `catalog.json`.
- **PL-3**: Mutual NDA Creator (`frontend/`). A form drives a live preview and PDF export via `@react-pdf`.
  The Standard Terms are read from `templates/` at build time. Vitest and Playwright tests are included.
- **PL-4** (PR #5): v1 technical foundation, with no product changes.
  - FastAPI backend with a temporary SQLite DB at `backend/data/prelegal.db`. The DB is disposable: the
    tables are created and the `templates` table is re-synced from `catalog.json` on every startup.
  - Endpoints: `GET /api/health` and `GET /api/templates`.
  - Frontend `/api` proxy and a typed client in `frontend/src/lib/api.ts`. The NDA page doesn't use it yet.
  - `scripts/start.sh` / `scripts/stop.sh`.
- **Not yet done**: no migrations (add Alembic before storing durable data), no auth, no CI, and the
  frontend doesn't consume the backend yet.
