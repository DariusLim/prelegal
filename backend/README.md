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
  seed.py     catalog.json -> templates table
tests/        pytest (each test uses its own temporary database)
```
