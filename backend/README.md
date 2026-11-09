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
| POST   | `/api/chat`      | One turn of the document drafting chat          |

## Drafting chat (`app/drafting_chat.py`, `app/documents.py`, `app/llm.py`)

The supported document types (fields, party roles, Standard Terms template) are declared in the repo-root
`document-types.json` (`DOCUMENT_TYPES_PATH`) and loaded at startup. The frontend reads the same file.

The request carries the conversation, the current draft (`documentId`, `fields`, `party1`, `party2`) and the
user's local date. The system prompt lists every document type with its fields and hints, so the model can
pick one, suggest the closest one for an unsupported request, and fill in fields in the same turn. The model
answers by calling a `respond` tool with `{reply, documentId?, fields, party1?, party2?}`, and the backend
cleans the answer up before returning it:

- unknown or unchanged `documentId`s are dropped;
- fields the resulting document doesn't have, and dates not in `YYYY-MM-DD` form, are dropped;
- numbers are turned into text, and Markdown emphasis is stripped from the reply.

If the model answers in plain text instead, that text becomes the reply with no changes.

- Configuration: `OPENROUTER_API_KEY` (required for chat) and `OPENROUTER_MODEL`, a comma-separated
  fallback list that OpenRouter tries in order. The default is free models:
  `nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free`.
  Set it to e.g. `anthropic/claude-sonnet-5.5` for faster (about 3–6s vs 10–30s per turn), paid answers.
  Both are read from the environment or the repo-root `.env` (see `.env.example`).
- Free models are rate-limited by OpenRouter, and free providers may log prompts. Avoid
  `openrouter/free` as a fallback: it can route to tiny models that don't call the tool.
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
  documents.py      document-types.json models and loader
  drafting_chat.py  chat request/response models, system prompt, sanitising, next_turn()
  llm.py      OpenRouter client (single model or fallback list)
  seed.py     catalog.json -> templates table
tests/        pytest (each test uses its own temporary database; OpenRouter is mocked)
```
