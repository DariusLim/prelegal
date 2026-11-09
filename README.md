# prelegal

> **🚧 Status: In progress.** This project is under active development and is expected to be completed within 1 week (target: **15 November 2026**).

## Overview

`prelegal` is an early-stage project. More details on its purpose and features will be added here as development progresses.

## Getting Started

Requirements: Python 3.9+ and Node.js (with npm).

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
browser ──▶ frontend (Next.js, :3000) ──/api/*──▶ backend (FastAPI, :8000) ──▶ SQLite (backend/data/prelegal.db)
```

- **Frontend** (`frontend/`): Next.js app, currently the Mutual NDA Creator, which fills in the Common Paper Mutual NDA from a form and exports it as a PDF. The browser calls the backend same-origin through `/api/*`, which Next.js proxies, so no CORS setup is needed. See [frontend/README.md](frontend/README.md).
- **Backend** (`backend/`): FastAPI + SQLAlchemy with a temporary SQLite database that is seeded from `catalog.json` on startup. See [backend/README.md](backend/README.md).
- **Templates** (`templates/`, `catalog.json`): Common Paper legal templates dataset.

## Tests

```bash
cd backend && .venv/bin/python -m pytest      # backend
cd frontend && npm test && npm run test:e2e   # frontend unit + end-to-end
```

## Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a PR.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
