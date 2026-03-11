#!/usr/bin/env bash
#
# Agemon VM Setup Script
# ──────────────────────────────────────────────────────────────────────
# Reproduces the full agemon dev environment on a fresh VM.
# Points to the 'develop' branch.
#
# Usage:
#   chmod +x scripts/setup-vm.sh && ./scripts/setup-vm.sh
#
# Prerequisites: VM with git, node (v22+).
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_URL="git@github.com:sdrdh/agemon.git"
BRANCH="develop"

echo "══════════════════════════════════════════════════════════"
echo "  Agemon VM Setup — targeting branch: $BRANCH"
echo "══════════════════════════════════════════════════════════"

# ── 0. Prompt for configuration ──────────────────────────────────────

# Git user
DEFAULT_GIT_NAME="$(git config --global user.name 2>/dev/null || echo "")"
DEFAULT_GIT_EMAIL="$(git config --global user.email 2>/dev/null || echo "")"

read -rp "Git name [${DEFAULT_GIT_NAME:-your name}]: " GIT_NAME
GIT_NAME="${GIT_NAME:-$DEFAULT_GIT_NAME}"

read -rp "Git email [${DEFAULT_GIT_EMAIL:-you@example.com}]: " GIT_EMAIL
GIT_EMAIL="${GIT_EMAIL:-$DEFAULT_GIT_EMAIL}"

if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
  echo "ERROR: Git name and email are required."
  exit 1
fi

# Agemon auth key
DEFAULT_AGEMON_KEY="${AGEMON_KEY:-test}"
read -rp "Agemon auth key [$DEFAULT_AGEMON_KEY]: " AGEMON_KEY_INPUT
AGEMON_KEY="${AGEMON_KEY_INPUT:-$DEFAULT_AGEMON_KEY}"

# GitHub PAT
DEFAULT_GITHUB_PAT="${GITHUB_PAT:-}"
read -rp "GitHub PAT (for PR creation, optional) [${DEFAULT_GITHUB_PAT:+****${DEFAULT_GITHUB_PAT: -4}}]: " GITHUB_PAT_INPUT
GITHUB_PAT="${GITHUB_PAT_INPUT:-$DEFAULT_GITHUB_PAT}"

# Host
DEFAULT_HOST="${EXE_HOST:-localhost}"
read -rp "Hostname (for VITE_ALLOWED_HOSTS) [$DEFAULT_HOST]: " EXE_HOST_INPUT
EXE_HOST="${EXE_HOST_INPUT:-$DEFAULT_HOST}"

echo ""
echo "── Configuration ──"
echo "  Git:       $GIT_NAME <$GIT_EMAIL>"
echo "  Auth key:  $AGEMON_KEY"
echo "  GitHub PAT:${GITHUB_PAT:+ ****${GITHUB_PAT: -4}}"
echo "  Hostname:  $EXE_HOST"
echo ""
read -rp "Continue? [Y/n] " CONFIRM
if [[ "${CONFIRM,,}" == "n" ]]; then
  echo "Aborted."
  exit 0
fi

# ── 1. Git config ──────────────────────────────────────────────────────
echo -e "\n→ Configuring git..."
git config --global user.email "$GIT_EMAIL"
git config --global user.name "$GIT_NAME"
git config --global init.defaultBranch main

# ── 1b. SSH key ────────────────────────────────────────────────
if [ ! -f ~/.ssh/id_ed25519 ]; then
  echo -e "\n→ Generating SSH key..."
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  ssh-keygen -t ed25519 -C "$GIT_EMAIL" -f ~/.ssh/id_ed25519 -N ""
  # Add GitHub to known_hosts to avoid interactive prompt
  ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  WARNING: Add this SSH key to GitHub before continuing!"
  echo "════════════════════════════════════════════════════════════"
  echo ""
  cat ~/.ssh/id_ed25519.pub
  echo ""
  read -rp "Press Enter after adding the key to GitHub..."
else
  echo -e "\n→ SSH key already exists at ~/.ssh/id_ed25519"
  # Ensure GitHub is in known_hosts
  if ! grep -q 'github.com' ~/.ssh/known_hosts 2>/dev/null; then
    ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
  fi
fi

# ── 2. Install Bun ────────────────────────────────────────────────────
if ! command -v bun &>/dev/null && [ ! -f "$HOME/.bun/bin/bun" ]; then
  echo -e "\n→ Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
else
  echo -e "\n→ Bun already installed: $(${HOME}/.bun/bin/bun --version 2>/dev/null || bun --version)"
fi

# Ensure bun is on PATH for this script
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Add to .bashrc if not already there
if ! grep -q 'BUN_INSTALL' ~/.bashrc 2>/dev/null; then
  echo '' >> ~/.bashrc
  echo '# bun' >> ~/.bashrc
  echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
  echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
fi

echo "  Bun version: $(bun --version)"

# ── 3. Clone repo & checkout branch ──────────────────────────────────
PROJECT_DIR="$HOME/agemon"

if [ -d "$PROJECT_DIR/.git" ]; then
  echo -e "\n→ Repo already cloned at $PROJECT_DIR"
  cd "$PROJECT_DIR"
  git fetch origin
else
  echo -e "\n→ Cloning $REPO_URL..."
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# Checkout develop branch
if git show-ref --verify --quiet refs/heads/$BRANCH; then
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git checkout -b "$BRANCH" "origin/$BRANCH"
fi

echo "  On branch: $(git branch --show-current)"
echo "  HEAD: $(git log --oneline -1)"

# ── 4. Install dependencies ──────────────────────────────────────────
echo -e "\n→ Installing dependencies (bun install)..."
bun install

# ── 5. Create .env files ─────────────────────────────────────────────
echo -e "\n→ Writing .env files..."

# Root .env (also used by backend)
cat > "$PROJECT_DIR/.env" <<EOF
# Required — static auth token for API access
AGEMON_KEY=$AGEMON_KEY

# Required for PR creation
GITHUB_PAT=$GITHUB_PAT

# Optional — server port (default: 3000)
PORT=3000
HOST=0.0.0.0

# Optional — SQLite database path (default: ~/.agemon/agemon.db)
# DB_PATH=./agemon.db

# Vite frontend
VITE_ALLOWED_HOSTS=$EXE_HOST
EOF

# Backend .env (same as root)
cp "$PROJECT_DIR/.env" "$PROJECT_DIR/backend/.env"

# Frontend .env
cat > "$PROJECT_DIR/frontend/.env" <<EOF
VITE_ALLOWED_HOSTS=$EXE_HOST
EOF

# ── 6. Create ~/.agemon runtime directory ────────────────────────────
echo -e "\n→ Setting up ~/.agemon runtime directory..."
mkdir -p ~/.agemon/{plugins,skills,repos,tasks}

# ── 7. Set up global symlinks (plugins + skills) ────────────────────
echo -e "\n→ Wiring global plugin/skill symlinks..."

# ~/.claude/plugins/agemon -> ~/.agemon/plugins
mkdir -p ~/.claude/plugins
ln -sfn ~/.agemon/plugins ~/.claude/plugins/agemon

# ~/.claude/skills/agemon -> ~/.agemon/skills
mkdir -p ~/.claude/skills
ln -sfn ~/.agemon/skills ~/.claude/skills/agemon

# ~/.agents/skills/agemon -> ~/.agemon/skills (Agent Skills spec)
mkdir -p ~/.agents/skills
ln -sfn ~/.agemon/skills ~/.agents/skills/agemon

# ── 8. Start dev servers in tmux ─────────────────────────────────────
echo -e "\n→ Starting dev servers in tmux session 'agemon'..."

# Kill existing session if any
tmux kill-session -t agemon 2>/dev/null || true

# Create tmux session with backend in first window
tmux new-session -d -s agemon -n backend -c "$PROJECT_DIR/backend"
tmux send-keys -t agemon:backend "cd $PROJECT_DIR && bun run --filter @agemon/backend dev" Enter

# Create frontend window
tmux new-window -t agemon -n frontend -c "$PROJECT_DIR/frontend"
tmux send-keys -t agemon:frontend "cd $PROJECT_DIR/frontend && bun run dev" Enter

# ── 9. Summary ───────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Agemon dev environment ready!"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  Branch:    $BRANCH"
echo "  Backend:   http://$EXE_HOST:3000/"
echo "  Frontend:  http://$EXE_HOST:5173/"
echo "  Auth key:  $AGEMON_KEY"
echo ""
echo "  tmux session: agemon (2 windows: backend, frontend)"
echo "    tmux attach -t agemon     # attach"
echo "    tmux select-window -t 0   # backend logs"
echo "    tmux select-window -t 1   # frontend logs"
echo ""
echo "  Smoke tests:"
echo "    ./scripts/test-api.sh"
echo ""
if [ "$EXE_HOST" != "localhost" ]; then
  echo "  Don't forget to expose ports 3000 and 5173 on your VM."
fi
echo "══════════════════════════════════════════════════════════"
