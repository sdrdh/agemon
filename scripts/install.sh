#!/usr/bin/env bash
# Agemon Installer
# Usage: bash install.sh [--install-method git|binary] [--port 3000] [--no-service] [--non-interactive] [--help]
set -euo pipefail

# ---------------------------------------------------------------------------
# Globals / defaults
# ---------------------------------------------------------------------------
INSTALL_METHOD="git"
PORT="3000"
NO_SERVICE=false
NON_INTERACTIVE=false
AGEMON_REPO="https://github.com/sdrdh/agemon.git"
INSTALL_DIR="/opt/agemon"
AGEMON_DIR="${HOME}/.agemon"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null && [ "$(tput colors)" -ge 8 ]; then
  RED="\033[0;31m"
  GREEN="\033[0;32m"
  YELLOW="\033[1;33m"
  CYAN="\033[0;36m"
  BOLD="\033[1m"
  RESET="\033[0m"
else
  RED="" GREEN="" YELLOW="" CYAN="" BOLD="" RESET=""
fi

info()    { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
error()   { printf "${RED}[✗]${RESET} %s\n" "$*" >&2; }
step()    { printf "\n${BOLD}${CYAN}==> %s${RESET}\n" "$*"; }
success() { printf "${GREEN}[✓]${RESET} %s\n" "$*"; }

die() {
  error "$*"
  exit 1
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install-method)
        INSTALL_METHOD="$2"; shift 2 ;;
      --port)
        PORT="$2"; shift 2 ;;
      --no-service)
        NO_SERVICE=true; shift ;;
      --non-interactive)
        NON_INTERACTIVE=true; shift ;;
      --help|-h)
        print_help; exit 0 ;;
      *)
        die "Unknown argument: $1. Run with --help for usage." ;;
    esac
  done
}

print_help() {
  cat <<EOF
${BOLD}Agemon Installer${RESET}

Usage:
  bash install.sh [options]

Options:
  --install-method git|binary   Installation method (default: git)
  --port PORT                   Port for the Agemon server (default: 3000)
  --no-service                  Skip systemd/launchd service setup
  --non-interactive             Use defaults without prompting
  --help, -h                    Show this help message

Environment:
  AGEMON_KEY=<key>              Pre-set auth key (skip generation)

Examples:
  bash install.sh
  bash install.sh --non-interactive --port 4000
  AGEMON_KEY=mysecret bash install.sh --no-service
EOF
}

# ---------------------------------------------------------------------------
# Step 1: Banner
# ---------------------------------------------------------------------------
print_banner() {
  cat <<'EOF'

   ___
  / _ \  __ _  ___  _ __ ___   ___  _ __
 / /_\ \/ _` |/ _ \| '_ ` _ \ / _ \| '_ \
/ /  \ \ (_| |  __/| | | | | | (_) | | | |
\/    \/\__, |\___||_| |_| |_|\___/|_| |_|
         |___/

   AI Agent Orchestration Platform — Installer
EOF
  echo ""
}

# ---------------------------------------------------------------------------
# Step 2: OS detection
# ---------------------------------------------------------------------------
detect_os() {
  step "Detecting system"

  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) OS_TYPE="macos" ;;
    Linux)  OS_TYPE="linux" ;;
    *) die "Unsupported OS: $OS. Agemon supports macOS and Linux." ;;
  esac

  case "$ARCH" in
    x86_64)  ARCH_TYPE="x86_64" ;;
    arm64|aarch64) ARCH_TYPE="arm64" ;;
    *) warn "Unknown architecture: $ARCH — proceeding anyway." ; ARCH_TYPE="$ARCH" ;;
  esac

  info "OS: $OS_TYPE ($ARCH_TYPE)"
}

# ---------------------------------------------------------------------------
# Step 3: Dependency checks
# ---------------------------------------------------------------------------
check_and_install_bun() {
  if command -v bun &>/dev/null; then
    BUN_VERSION="$(bun --version 2>/dev/null || echo "unknown")"
    success "Bun found: v${BUN_VERSION}"
    return
  fi

  warn "Bun not found."
  if "$NON_INTERACTIVE"; then
    info "Installing Bun automatically..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="${HOME}/.bun/bin:${PATH}"
    if command -v bun &>/dev/null; then
      success "Bun installed: v$(bun --version)"
    else
      die "Bun installation failed. Please install manually: https://bun.sh"
    fi
  else
    read -r -p "  Install Bun now? [Y/n] " answer
    answer="${answer:-Y}"
    if [[ "$answer" =~ ^[Yy] ]]; then
      curl -fsSL https://bun.sh/install | bash
      export PATH="${HOME}/.bun/bin:${PATH}"
      if command -v bun &>/dev/null; then
        success "Bun installed: v$(bun --version)"
      else
        die "Bun installation failed. Please install manually: https://bun.sh"
      fi
    else
      die "Bun is required. Aborting."
    fi
  fi
}

check_and_install_git() {
  if command -v git &>/dev/null; then
    GIT_VERSION="$(git --version | awk '{print $3}')"
    success "Git found: v${GIT_VERSION}"
    return
  fi

  warn "Git not found."
  if "$NON_INTERACTIVE"; then
    info "Attempting to install Git automatically..."
  else
    read -r -p "  Install Git now? [Y/n] " answer
    answer="${answer:-Y}"
    if [[ ! "$answer" =~ ^[Yy] ]]; then
      die "Git is required. Aborting."
    fi
  fi

  if [ "$OS_TYPE" = "macos" ]; then
    if command -v brew &>/dev/null; then
      brew install git
    else
      die "Homebrew not found. Install Git manually: https://git-scm.com"
    fi
  elif [ "$OS_TYPE" = "linux" ]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y git
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y git
    elif command -v yum &>/dev/null; then
      sudo yum install -y git
    else
      die "Could not detect package manager. Install Git manually: https://git-scm.com"
    fi
  fi

  if command -v git &>/dev/null; then
    success "Git installed: v$(git --version | awk '{print $3}')"
  else
    die "Git installation failed."
  fi
}

check_gh_cli() {
  if command -v gh &>/dev/null; then
    GH_VERSION="$(gh --version | head -1 | awk '{print $3}')"
    success "GitHub CLI found: v${GH_VERSION}"
    return
  fi

  warn "GitHub CLI (gh) not found — optional, used for PR creation."
  if "$NON_INTERACTIVE"; then
    warn "Skipping gh installation. Install later: https://cli.github.com"
    return
  fi

  read -r -p "  Install GitHub CLI? [y/N] " answer
  answer="${answer:-N}"
  if [[ ! "$answer" =~ ^[Yy] ]]; then
    warn "Skipping gh installation. Install later: https://cli.github.com"
    return
  fi

  if [ "$OS_TYPE" = "macos" ]; then
    if command -v brew &>/dev/null; then
      brew install gh
    else
      warn "Homebrew not found. Install gh manually: https://cli.github.com"
      return
    fi
  elif [ "$OS_TYPE" = "linux" ]; then
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
      sudo apt-get update -qq && sudo apt-get install -y gh
    else
      warn "Could not detect package manager. Install gh manually: https://cli.github.com"
      return
    fi
  fi

  if command -v gh &>/dev/null; then
    success "GitHub CLI installed: v$(gh --version | head -1 | awk '{print $3}')"
  else
    warn "GitHub CLI installation may have failed. Check https://cli.github.com"
  fi
}

check_dependencies() {
  step "Checking dependencies"
  check_and_install_bun
  check_and_install_git
  check_gh_cli
}

# ---------------------------------------------------------------------------
# Step 4: Install method
# ---------------------------------------------------------------------------
choose_install_method() {
  step "Install method"

  if "$NON_INTERACTIVE"; then
    info "Using install method: ${INSTALL_METHOD}"
    return
  fi

  echo "  How would you like to install Agemon?"
  echo "    1) Git-based (recommended) — clone from GitHub"
  echo "    2) Binary — not yet supported"
  echo ""
  read -r -p "  Choice [1]: " choice
  choice="${choice:-1}"

  case "$choice" in
    1) INSTALL_METHOD="git" ;;
    2) error "Binary installation is not yet supported."; exit 1 ;;
    *) warn "Invalid choice, defaulting to git." ; INSTALL_METHOD="git" ;;
  esac

  info "Install method: ${INSTALL_METHOD}"
}

do_install() {
  step "Installing Agemon to ${INSTALL_DIR}"

  if [ "$INSTALL_METHOD" = "binary" ]; then
    die "Binary installation is not yet supported. Use --install-method git."
  fi

  # Git-based install
  if [ -d "${INSTALL_DIR}/.git" ]; then
    warn "Agemon already installed at ${INSTALL_DIR}. Pulling latest..."
    git -C "${INSTALL_DIR}" pull --ff-only
  else
    if [ -d "${INSTALL_DIR}" ] && [ "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]; then
      die "${INSTALL_DIR} already exists and is not empty. Remove it first or choose a different directory."
    fi
    info "Cloning from ${AGEMON_REPO}..."
    sudo mkdir -p "${INSTALL_DIR}"
    sudo chown "$(whoami)" "${INSTALL_DIR}"
    git clone "${AGEMON_REPO}" "${INSTALL_DIR}"
  fi

  success "Source installed at ${INSTALL_DIR}"
}

# ---------------------------------------------------------------------------
# Step 5: SSH key
# ---------------------------------------------------------------------------
ensure_ssh_key() {
  step "SSH key"

  SSH_KEY="${HOME}/.ssh/id_ed25519"
  if [ -f "${SSH_KEY}" ]; then
    success "SSH key found: ${SSH_KEY}"
    return
  fi

  warn "No ed25519 SSH key found at ${SSH_KEY}."
  if "$NON_INTERACTIVE"; then
    info "Generating SSH key automatically..."
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    ssh-keygen -t ed25519 -C "agemon@$(hostname)" -f "${SSH_KEY}" -N ""
  else
    read -r -p "  Generate a new ed25519 SSH key? [Y/n] " answer
    answer="${answer:-Y}"
    if [[ ! "$answer" =~ ^[Yy] ]]; then
      warn "Skipping SSH key generation. Git operations over SSH may fail."
      return
    fi
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    ssh-keygen -t ed25519 -C "agemon@$(hostname)" -f "${SSH_KEY}" -N ""
  fi

  success "SSH key generated: ${SSH_KEY}"
  echo ""
  echo "  ${BOLD}Add the following public key to GitHub (Settings → SSH keys):${RESET}"
  echo ""
  cat "${SSH_KEY}.pub"
  echo ""
  if ! "$NON_INTERACTIVE"; then
    read -r -p "  Press Enter after adding the key to GitHub..."
  fi
}

# ---------------------------------------------------------------------------
# Step 6: ACP agent binaries
# ---------------------------------------------------------------------------
check_acp_agents() {
  step "ACP agent binaries"

  if command -v claude-agent-acp &>/dev/null; then
    success "claude-agent-acp found on PATH"
  else
    warn "claude-agent-acp not found on PATH."
    echo ""
    echo "  Agemon uses the ACP (Agent Communication Protocol) to spawn AI agents."
    echo "  You need to install claude-agent-acp (or compatible ACP agents) separately."
    echo ""
    echo "  Installation options:"
    echo "    • Claude Code ACP: Follow instructions at https://docs.anthropic.com/claude-code"
    echo "    • Ensure the binary is on your PATH before starting Agemon"
    echo ""
    warn "Continuing without claude-agent-acp — agents won't be startable until installed."
  fi
}

# ---------------------------------------------------------------------------
# Step 7: Runtime directories
# ---------------------------------------------------------------------------
create_runtime_dirs() {
  step "Creating runtime directories"

  mkdir -p \
    "${AGEMON_DIR}" \
    "${AGEMON_DIR}/repos" \
    "${AGEMON_DIR}/tasks" \
    "${AGEMON_DIR}/plugins" \
    "${AGEMON_DIR}/skills"

  success "Runtime directories created at ${AGEMON_DIR}"

  if [ "$OS_TYPE" = "linux" ]; then
    sudo mkdir -p /etc/agemon
    sudo mkdir -p /var/log/agemon
    info "Created /etc/agemon and /var/log/agemon"
  elif [ "$OS_TYPE" = "macos" ]; then
    mkdir -p "${HOME}/Library/Logs/agemon"
    info "Created ${HOME}/Library/Logs/agemon"
  fi
}

# ---------------------------------------------------------------------------
# Step 8: Generate secrets / env file
# ---------------------------------------------------------------------------
write_env_file() {
  local env_file="$1"
  local key="$2"
  local port="$3"

  printf 'AGEMON_KEY=%s\nPORT=%s\n' "$key" "$port" > "$env_file"
}

generate_secrets() {
  step "Configuring environment"

  # Determine env file path
  if [ "$OS_TYPE" = "linux" ]; then
    ENV_FILE="/etc/agemon/env"
    ENV_DIR="/etc/agemon"
  else
    ENV_FILE="${AGEMON_DIR}/env"
    ENV_DIR="${AGEMON_DIR}"
  fi

  # Use provided key or generate one
  if [ -n "${AGEMON_KEY:-}" ]; then
    info "Using AGEMON_KEY from environment."
    FINAL_KEY="${AGEMON_KEY}"
  else
    FINAL_KEY="$(openssl rand -hex 32)"
    info "Generated new AGEMON_KEY."
  fi

  FINAL_PORT="${PORT}"

  if [ "$OS_TYPE" = "linux" ]; then
    # Write to /etc/agemon/env (requires sudo)
    printf 'AGEMON_KEY=%s\nPORT=%s\n' "${FINAL_KEY}" "${FINAL_PORT}" | sudo tee "${ENV_FILE}" > /dev/null
    sudo chmod 640 "${ENV_FILE}"
  else
    mkdir -p "${ENV_DIR}"
    write_env_file "${ENV_FILE}" "${FINAL_KEY}" "${FINAL_PORT}"
    chmod 600 "${ENV_FILE}"
  fi

  success "Environment file written to ${ENV_FILE}"
  info "Port: ${FINAL_PORT}"
}

# ---------------------------------------------------------------------------
# Step 9: Install service
# ---------------------------------------------------------------------------
install_systemd_service() {
  local service_src="${INSTALL_DIR}/scripts/agemon.service"

  if [ ! -f "$service_src" ]; then
    warn "agemon.service not found at ${service_src}. Skipping service installation."
    return
  fi

  info "Installing systemd service..."
  sudo cp "$service_src" /etc/systemd/system/agemon.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now agemon

  if sudo systemctl is-active --quiet agemon; then
    success "Agemon systemd service is running."
  else
    warn "Agemon service may not have started. Check: sudo systemctl status agemon"
  fi
}

install_launchd_service() {
  local plist_src="${INSTALL_DIR}/scripts/agemon.plist"
  local plist_dst="${HOME}/Library/LaunchAgents/ai.agemon.server.plist"
  local log_dir="${HOME}/Library/Logs/agemon"

  if [ ! -f "$plist_src" ]; then
    warn "agemon.plist not found at ${plist_src}. Skipping service installation."
    return
  fi

  mkdir -p "${HOME}/Library/LaunchAgents" "${log_dir}"

  # Patch log paths in plist to use user home directory
  sed \
    -e "s|/var/log/agemon/agemon.log|${log_dir}/agemon.log|g" \
    -e "s|/var/log/agemon/agemon-error.log|${log_dir}/agemon-error.log|g" \
    "$plist_src" > "$plist_dst"

  chmod 644 "$plist_dst"

  info "Installing launchd agent..."
  # Unload if already loaded (ignore errors)
  launchctl unload "$plist_dst" 2>/dev/null || true
  launchctl load "$plist_dst"

  success "Agemon launchd agent loaded: ai.agemon.server"
  info "Logs: ${log_dir}/"
}

install_service() {
  if "$NO_SERVICE"; then
    info "Skipping service installation (--no-service)."
    return
  fi

  step "Installing system service"

  if [ "$OS_TYPE" = "linux" ]; then
    if command -v systemctl &>/dev/null; then
      install_systemd_service
    else
      warn "systemctl not found — skipping service installation."
      warn "Start manually: cd ${INSTALL_DIR} && bun run backend/src/server.ts"
    fi
  elif [ "$OS_TYPE" = "macos" ]; then
    install_launchd_service
  fi
}

# ---------------------------------------------------------------------------
# Step 10: Run initial setup (bun install)
# ---------------------------------------------------------------------------
run_initial_setup() {
  step "Running initial setup"

  if [ ! -d "${INSTALL_DIR}" ]; then
    warn "Install directory not found at ${INSTALL_DIR}. Skipping bun install."
    return
  fi

  info "Installing dependencies in ${INSTALL_DIR}..."
  (cd "${INSTALL_DIR}" && bun install)
  success "Dependencies installed."
}

# ---------------------------------------------------------------------------
# Step 11: Print summary
# ---------------------------------------------------------------------------
print_summary() {
  step "Installation complete"

  local server_url="http://localhost:${FINAL_PORT:-${PORT}}"

  echo ""
  echo "  ${BOLD}${GREEN}Agemon is installed!${RESET}"
  echo ""
  echo "  ${BOLD}Access URL:${RESET}     ${server_url}"
  echo "  ${BOLD}Install dir:${RESET}    ${INSTALL_DIR}"
  echo "  ${BOLD}Runtime dir:${RESET}    ${AGEMON_DIR}"

  if [ "$OS_TYPE" = "linux" ]; then
    echo "  ${BOLD}Env file:${RESET}       /etc/agemon/env"
  else
    echo "  ${BOLD}Env file:${RESET}       ${AGEMON_DIR}/env"
  fi

  echo ""
  echo "  ${BOLD}${YELLOW}Auth key reminder:${RESET}"
  echo "  Your AGEMON_KEY is stored in the env file above."
  echo "  Keep it secret — it grants full access to the API."
  echo ""
  echo "  ${BOLD}Next steps:${RESET}"

  if "$NO_SERVICE"; then
    echo "    1. Start Agemon manually:"
    echo "       cd ${INSTALL_DIR} && bun run backend/src/server.ts"
  elif [ "$OS_TYPE" = "linux" ]; then
    echo "    1. Check service status:  sudo systemctl status agemon"
    echo "    2. View logs:             sudo journalctl -u agemon -f"
  else
    echo "    1. Check service status:  launchctl list | grep agemon"
    echo "    2. View logs:             tail -f ~/Library/Logs/agemon/agemon.log"
  fi

  echo "    $([ "$NO_SERVICE" = "true" ] && echo 2 || echo 3). Open the UI:            ${server_url}"
  echo ""
  if ! command -v claude-agent-acp &>/dev/null; then
    echo "  ${BOLD}${YELLOW}Reminder:${RESET} Install claude-agent-acp to enable AI agent sessions."
    echo ""
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"

  print_banner
  detect_os
  check_dependencies
  choose_install_method
  do_install
  ensure_ssh_key
  check_acp_agents
  create_runtime_dirs
  generate_secrets
  run_initial_setup
  install_service
  print_summary
}

main "$@"
