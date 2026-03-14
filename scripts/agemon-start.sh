#!/usr/bin/env bash
# Wrapper script for launchd/systemd — sources env file then starts Agemon
set -euo pipefail

# Self-locate: resolve the install directory from this script's location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Ensure common binary locations are on PATH
# (launchd/systemd don't source shell profiles)
export PATH="${HOME}/.bun/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

# Source environment variables (always ~/.agemon/env)
ENV_FILE="${HOME}/.agemon/env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Find bun
if ! command -v bun &>/dev/null; then
  echo "[agemon] ERROR: bun not found on PATH ($PATH)" >&2
  exit 1
fi

exec bun run "${INSTALL_DIR}/backend/src/server.ts"
