#!/usr/bin/env bash
# Stop the services started by scripts/start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"

stop_service() {
  local service="$1" pid_file="$RUN_DIR/$1.pid" pid
  if [[ ! -f "$pid_file" ]]; then
    echo "$service: not running"
    return
  fi
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    # start.sh runs each service as its own process group (leader = $pid);
    # signal the whole group so child processes stop too.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    echo "$service: stopped (pid $pid)"
  else
    echo "$service: not running (removed stale pid file)"
  fi
  rm -f "$pid_file"
}

stop_service frontend
stop_service backend
