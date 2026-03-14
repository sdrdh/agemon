#!/usr/bin/env bash
# Wrapper script for launchd — sources env file then starts Agemon
set -euo pipefail
ENV_FILE="${AGEMON_DIR:-${HOME}/.agemon}/env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
exec /usr/local/bin/bun run /opt/agemon/backend/src/server.ts
