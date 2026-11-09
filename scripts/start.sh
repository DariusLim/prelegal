#!/usr/bin/env bash
# Start the prelegal stack in the background:
#   backend  - FastAPI + SQLite on http://127.0.0.1:$BACKEND_PORT  (default 8000)
#   frontend - Next.js dev server on http://localhost:$FRONTEND_PORT (default 3000),
#              proxying /api/* to the backend
# Installs dependencies on first run (or when they change). PIDs and logs go to
# .run/; stop everything with scripts/stop.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
PYTHON="${PYTHON:-python3}"

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
is_running() { [[ -f "$RUN_DIR/$1.pid" ]] && kill -0 "$(cat "$RUN_DIR/$1.pid")" 2>/dev/null; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

for service in backend frontend; do
  is_running "$service" && die "$service is already running (pid $(cat "$RUN_DIR/$service.pid")); run scripts/stop.sh first"
done
# Fail fast: otherwise the readiness checks could be answered by whatever else owns the port.
port_in_use "$BACKEND_PORT" && die "port $BACKEND_PORT is in use; free it or set BACKEND_PORT"
port_in_use "$FRONTEND_PORT" && die "port $FRONTEND_PORT is in use; free it or set FRONTEND_PORT"
command -v "$PYTHON" >/dev/null || die "$PYTHON not found (Python 3.9+ required)"
command -v npm >/dev/null || die "npm not found (Node.js required)"
mkdir -p "$RUN_DIR"

# --- Dependencies -------------------------------------------------------------
VENV="$ROOT/backend/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  log "Creating Python virtualenv in backend/.venv"
  "$PYTHON" -m venv "$VENV"
fi
requirements_hash="$(cat "$ROOT"/backend/requirements*.txt | shasum | cut -d' ' -f1)"
if [[ "$(cat "$VENV/.requirements.sha" 2>/dev/null)" != "$requirements_hash" ]]; then
  log "Installing backend dependencies"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$ROOT/backend/requirements-dev.txt"
  echo "$requirements_hash" >"$VENV/.requirements.sha"
fi

# npm records the installed tree in node_modules/.package-lock.json.
if [[ ! -f "$ROOT/frontend/node_modules/.package-lock.json" ||
      "$ROOT/frontend/package-lock.json" -nt "$ROOT/frontend/node_modules/.package-lock.json" ]]; then
  log "Installing frontend dependencies"
  (cd "$ROOT/frontend" && npm ci --no-audit --no-fund)
fi

# --- Launch -------------------------------------------------------------------
# Job control puts each background job in its own process group, so stop.sh
# can stop a service together with its children (npm -> next -> workers).
set -m

log "Starting backend on http://127.0.0.1:$BACKEND_PORT"
(cd "$ROOT/backend" && exec nohup "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$BACKEND_PORT") \
  >"$RUN_DIR/backend.log" 2>&1 &
echo $! >"$RUN_DIR/backend.pid"

log "Starting frontend on http://localhost:$FRONTEND_PORT"
(cd "$ROOT/frontend" && BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" exec nohup npm run dev -- --port "$FRONTEND_PORT") \
  >"$RUN_DIR/frontend.log" 2>&1 &
echo $! >"$RUN_DIR/frontend.pid"

# wait_for <service> <url> <timeout-seconds>
wait_for() {
  local service="$1" url="$2" deadline=$((SECONDS + $3))
  # Check liveness before each probe so a response only counts while our process is up.
  until is_running "$service" && curl -fsS -o /dev/null "$url" 2>/dev/null; do
    if ! is_running "$service"; then
      tail -n 20 "$RUN_DIR/$service.log" >&2
      "$ROOT/scripts/stop.sh" >/dev/null
      die "$service exited during startup (full log: .run/$service.log)"
    fi
    if ((SECONDS >= deadline)); then
      "$ROOT/scripts/stop.sh" >/dev/null
      die "$service did not become ready at $url within $3s (log: .run/$service.log)"
    fi
    sleep 1
  done
}

wait_for backend "http://127.0.0.1:$BACKEND_PORT/api/health" 30
# Checking the API through the frontend also verifies the /api proxy.
wait_for frontend "http://localhost:$FRONTEND_PORT/api/health" 120

log "prelegal is running"
echo "    App:      http://localhost:$FRONTEND_PORT"
echo "    API:      http://127.0.0.1:$BACKEND_PORT/api  (docs: /docs)"
echo "    Logs:     .run/backend.log, .run/frontend.log"
echo "    Stop:     scripts/stop.sh"
