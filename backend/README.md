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

| Method | Path                   | Auth | Purpose                                                    |
| ------ | ---------------------- | ---- | ---------------------------------------------------------- |
| GET    | `/api/health`          |      | Liveness, including a database round-trip                  |
| GET    | `/api/templates`       |      | Legal templates catalogue (from `catalog.json`)            |
| POST   | `/api/auth/signup`     |      | Create an account `{email, password}` and sign in (201)    |
| POST   | `/api/auth/login`      |      | Sign in `{email, password}`                                |
| POST   | `/api/auth/logout`     |      | Sign out (revokes the session) (204)                       |
| GET    | `/api/auth/me`         | yes  | The signed-in user                                         |
| POST   | `/api/chat`            | yes  | One turn of the document drafting chat, streamed (NDJSON)  |
| GET    | `/api/documents`       | yes  | The user's documents, most recently updated first          |
| POST   | `/api/documents`       | yes  | Save a new document `{title?, draft, messages}` (201)      |
| GET    | `/api/documents/{id}`  | yes  | One document, with its conversation                        |
| PATCH  | `/api/documents/{id}`  | yes  | Change any of `title` (null = derived), `draft`, `messages` |
| DELETE | `/api/documents/{id}`  | yes  | Delete a document (204)                                    |

"Auth: yes" routes respond 401 without a valid session. Another user's document responds 404.

## Accounts (`app/auth.py`, `app/saved_documents.py`)

- Email + password accounts. Emails are stored lower-cased; passwords are 8–128 characters and hashed with
  Argon2 (`argon2-cffi`). A wrong password and an unknown email get the same 401 and take as long.
- Signing in creates a random session token, sent in the `prelegal_session` cookie (HttpOnly,
  SameSite=Lax, 30 days; `Secure` when `COOKIE_SECURE=true`, which you should set behind HTTPS). Only the
  token's SHA-256 is stored, in `sessions`, so signing out revokes it server-side.
- CSRF: the cookie is SameSite=Lax and every write takes a JSON body, which other sites can't send
  without a CORS preflight (and the API has no CORS), so cross-site requests can't act as the user.
- Documents store the draft and the conversation as JSON; the frontend autosaves after each chat turn.

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
- Streaming: the model's answer is streamed from OpenRouter (SSE), and `/api/chat` streams
  newline-delimited JSON: `{"type":"delta","text":…}` pieces of the reply (`"reset"` replaces the text so
  far, e.g. when the model wrote plain text before calling the tool), then `{"type":"done","turn":{reply,
  documentId?, fields, party1?, party2?}}`, the sanitised turn, which is authoritative. The reply is read
  incrementally out of the tool call's partial JSON arguments (`partial_reply`). How smoothly it streams
  depends on the provider: some (including the default Nemotron 3.5 Super) send a tool call's arguments in
  one piece, so the reply appears at once; plain-text answers and e.g. Claude stream word by word.
- Errors: 401 if not signed in, 503 if no key is configured, 422 for a malformed request. Once streaming
  has started, an OpenRouter failure or an invalid answer ends the stream with
  `{"type":"error","detail":…}`.
- Why the tool isn't forced: current Claude models reject a forced `tool_choice`, and strict structured
  outputs took minutes to compile for this schema. The prompt asks for the tool instead.
- The chat itself is stateless: the browser sends the full history and draft each turn, then saves them.

## Database

SQLite at `backend/data/prelegal.db` (override with `DATABASE_URL`), git-ignored. The schema is managed by
Alembic (`alembic.ini`, `migrations/`); the app runs `upgrade head` on startup, then syncs the `templates`
table with the repo's `catalog.json` (`CATALOG_PATH`). Users, sessions and documents are durable.

After changing `app/models.py`, add a migration and check it in:

```bash
.venv/bin/alembic revision --autogenerate -m "describe the change"   # review the generated file
.venv/bin/alembic check                                              # models and migrations agree
```

Migration `0001` replaces the `templates` table of pre-migration (PL-4 to PL-6) databases, which held
nothing else.

## Layout

```
app/
  main.py     create_app(): lifespan migrates + seeds, mounts routes
  config.py   Settings from environment variables
  db.py       engine, Base, migrate(), get_session dependency
  models.py   SQLAlchemy models (change together with a migration)
  schemas.py  shared Pydantic models (CamelModel, responses)
  routes.py   /api health, templates, chat (streaming)
  auth.py     /api/auth: accounts, cookie sessions, current_user dependency
  saved_documents.py  /api/documents: each user's saved documents
  documents.py      document-types.json models and loader
  drafting_chat.py  chat request/response models, system prompt, sanitising, stream_turn()
  llm.py      OpenRouter streaming client (single model or fallback list)
  seed.py     catalog.json -> templates table
migrations/   Alembic environment and versions
tests/        pytest (each test uses its own temporary database; OpenRouter is mocked)
```
