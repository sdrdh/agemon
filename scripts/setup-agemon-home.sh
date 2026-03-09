#!/usr/bin/env bash
# scripts/setup-agemon-home.sh
# Run once after installation to wire ~/.agemon global plugins into each agent's discovery path.
set -euo pipefail

AGEMON_DIR="${AGEMON_DIR:-$HOME/.agemon}"
CLAUDE_PLUGINS_DIR="$HOME/.claude/plugins"

echo "[setup] Agemon home: $AGEMON_DIR"

# Ensure dirs exist
mkdir -p "$AGEMON_DIR/plugins" "$AGEMON_DIR/skills"
mkdir -p "$CLAUDE_PLUGINS_DIR"

# Wire global agemon plugins into Claude Code's discovery path
LINK="$CLAUDE_PLUGINS_DIR/agemon"
if [ -L "$LINK" ]; then
  echo "[setup] $LINK already linked — skipping"
elif [ -e "$LINK" ]; then
  echo "[setup] WARNING: $LINK exists but is not a symlink — skipping"
else
  ln -s "$AGEMON_DIR/plugins" "$LINK"
  echo "[setup] linked $LINK -> $AGEMON_DIR/plugins"
fi

echo "[setup] Done. Add more agent links here as new agents are supported."
