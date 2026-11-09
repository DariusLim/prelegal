# prelegal — backend

FastAPI service with a SQLite database. The frontend calls it through same-origin `/api/*`, which
`frontend/next.config.ts` rewrites to this service (`BACKEND_URL`, default `http://127.0.0.1:8000`).

## Running

The usual way is `scripts/start.sh` from the repo root (see the root README). To run it on its own:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload       # http://127.0.0.1:8000, docs at /docs
.venv/bin/python -m pytest                    # tests
```

Requires Python 3.9+.

## Endpoints

| Method | Path             | Purpose                                         |
| ------ | ---------------- | ----------------------------------------------- |
| GET    | `/api/health`    | Liveness, including a database round-trip       |
| GET    | `/api/templates` | Legal templates catalogue (from `catalog.json`) |
| POST   | `/api/chat`      | One turn of the Mutual NDA drafting chat        |

## NDA chat (`app/nda_chat.py`, `app/llm.py`)

The request carries the conversation, the current Cover Page fields and the user's local date. The model,
called through OpenRouter, answers by calling a `respond` tool with `{reply, updates}`. `updates` holds only
the fields that changed, and Pydantic validates it (types, enums, 1–99 years, ISO dates) before it is
returned. If the model answers in plain text instead, that text becomes the reply with no updates.

- Configuration: `OPENROUTER_API_KEY` (required for chat) and `OPENROUTER_MODEL` (default
  `anthropic/claude-sonnet-5.5`). Both are read from the environment or the repo-root `.env` (see
  `.env.example`).
- Errors: 503 if no key is configured, 502 if OpenRouter fails or returns an invalid answer, 422 for a
  malformed request.
- Why the tool isn't forced: current Claude models reject a forced `tool_choice`, and strict structured
  outputs took minutes to compile for this schema. The prompt asks for the tool instead.
- Conversations aren't stored; the browser sends the full history each turn.

## Database

SQLite at `backend/data/prelegal.db` (override with `DATABASE_URL`). This is the temporary v1 database:
on every startup the schema is created and the `templates` table is synced with the repo's `catalog.json`
(`CATALOG_PATH`). The file is git-ignored and disposable. Delete it to reset. There are no migrations yet,
so add Alembic before storing data that has to survive schema changes.

## Layout

```
app/
  main.py     create_app(): lifespan creates tables + seeds, mounts routes
  config.py   Settings from environment variables
  db.py       engine, Base, get_session dependency
  models.py   SQLAlchemy models
  schemas.py  Pydantic response models
  routes.py   /api routes
  nda_chat.py NDA chat: request/response models, system prompt, next_turn()
  llm.py      OpenRouter client
  seed.py     catalog.json -> templates table
tests/        pytest (each test uses its own temporary database; OpenRouter is mocked)
```
