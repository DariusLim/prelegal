# prelegal

> **🚧 Status: In progress.** This project is under active development and is expected to be completed within 1 week (target: **15 November 2026**).

## Overview

`prelegal` is an early-stage project. More details on its purpose and features will be added here as development progresses.

## Getting Started

Requirements: Python 3.9+ and Node.js (with npm). For the AI chat, copy `.env.example` to `.env` and set
`OPENROUTER_API_KEY`.

```bash
scripts/start.sh   # installs dependencies on first run, then starts everything in the background
scripts/stop.sh    # stops it
```

- App: http://localhost:3000
- API: http://127.0.0.1:8000/api (interactive docs at http://127.0.0.1:8000/docs)
- Logs: `.run/backend.log` and `.run/frontend.log`

Override ports with `BACKEND_PORT=8001 FRONTEND_PORT=3001 scripts/start.sh`. The script refuses to start if a port is already in use.

## Architecture

```
browser ──▶ frontend (Next.js, :3000) ──/api/*──▶ backend (FastAPI, :8000) ──┬─▶ SQLite (backend/data/prelegal.db)
                                                                            └─▶ OpenRouter (free models), for /api/chat
```

- **Frontend** (`frontend/`): Next.js app, the Legal Document Creator. Users sign up or sign in, then see their saved documents. An AI chat finds out which agreement the user needs, from 11 Common Paper standard documents (NDA, cloud service, SLA, DPA, pilot, partnership and more), fills it in from their answers (autosaved to the user's account), and exports it as a PDF. The browser calls the backend same-origin through `/api/*`, which Next.js proxies, so no CORS setup is needed. See [frontend/README.md](frontend/README.md).
- **Backend** (`backend/`): FastAPI + SQLAlchemy with a SQLite database (Alembic migrations) holding accounts, cookie sessions and saved documents. It also runs the drafting chat through OpenRouter (free models by default) and streams the replies, so the API key never reaches the browser. See [backend/README.md](backend/README.md).
- **Templates** (`templates/`, `catalog.json`): Common Paper legal templates dataset.
- **Document types** (`document-types.json`): the documents the assistant can create, with each one's Cover Page fields, party roles and Standard Terms template. Both apps read it, so adding a document is a data change.

## Tests

```bash
cd backend && .venv/bin/python -m pytest      # backend
cd frontend && npm test && npm run test:e2e   # frontend unit + end-to-end
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of these, plus lint, type checks and an Alembic
drift check, on every pull request and push to `main`.

## Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a PR.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
