#!/usr/bin/env bash
# Agemon Installer
# Usage: bash install.sh [--install-method git|binary] [--port 3000] [--no-service] [--non-interactive] [--help]
set -euo pipefail

# ---------------------------------------------------------------------------
# Globals / defaults
# ---------------------------------------------------------------------------
INSTALL_METHOD="git"
PORT="3000"
HOST="127.0.0.1"
NO_SERVICE=false
NON_INTERACTIVE=false
UNINSTALL=false
AGEMON_REPO="https://github.com/sdrdh/agemon.git"
AGEMON_DIR="${HOME}/.agemon"
# INSTALL_DIR set after OS detection — always ~/.agemon/app
INSTALL_DIR=""

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && tput colors &>/dev/null && [ "$(tput colors)" -ge 8 ]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[1;33m'
  CYAN=$'\033[0;36m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
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

check_port_available() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    ! lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null
  elif command -v ss &>/dev/null; then
    ! ss -tlnp "sport = :$port" 2>/dev/null | grep -q LISTEN
  else
    # Can't check — assume available
    return 0
  fi
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
      --host)
        HOST="$2"; shift 2 ;;
      --install-dir)
        INSTALL_DIR="$2"; shift 2 ;;
      --no-service)
        NO_SERVICE=true; shift ;;
      --non-interactive)
        NON_INTERACTIVE=true; shift ;;
      --uninstall)
        UNINSTALL=true; shift ;;
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
  --install-dir DIR             Install directory (default: ~/.agemon/app)
  --host HOST                   Bind address (default: 0.0.0.0)
  --port PORT                   Port for the Agemon server (default: 3000)
  --no-service                  Skip systemd/launchd service setup
  --non-interactive             Use defaults without prompting
  --uninstall                   Remove Agemon (service, app, optionally data)
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
  printf '%s\n' ""
  printf '%s\n' "${CYAN}   ___${RESET}"
  printf '%s\n' "${CYAN}  / _ \\${RESET}    ${BOLD}__ _  ___  _ __ ___   ___  _ __${RESET}"
  printf '%s\n' "${CYAN} / /_\\ \\${RESET}  ${BOLD}/ _\` |/ _ \\| '_ \` _ \\ / _ \\| '_ \\${RESET}"
  printf '%s\n' "${CYAN}/ /   \\ \\${RESET}${BOLD}| (_| |  __/| | | | | | (_) | | | |${RESET}"
  printf '%s\n' "${CYAN}\\/     \\/${RESET}${BOLD} \\__, |\\___||_| |_| |_|\\___/|_| |_|${RESET}"
  printf '%s\n' "${CYAN}           ${RESET}${BOLD}|___/${RESET}"
  printf '%s\n' ""
  printf '%s\n' "   ${GREEN}AI Agent Orchestration Platform${RESET} ${BOLD}— Installer${RESET}"
  printf '%s\n' ""
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

  # Set default install directory (can be overridden by --install-dir)
  if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR="${HOME}/.agemon/app"
  fi

  info "OS: $OS_TYPE ($ARCH_TYPE)"
  info "Install directory: ${INSTALL_DIR}"
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
    read -r -p "  Install Bun now? [Y/n] " answer </dev/tty
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
    read -r -p "  Install Git now? [Y/n] " answer </dev/tty
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

  read -r -p "  Install GitHub CLI? [y/N] " answer </dev/tty
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
  read -r -p "  Choice [1]: " choice </dev/tty
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
    if mkdir -p "${INSTALL_DIR}" 2>/dev/null; then
      : # directory created or already exists, user has write access
    elif command -v sudo &>/dev/null; then
      sudo mkdir -p "${INSTALL_DIR}"
      sudo chown "$(whoami):$(id -gn)" "${INSTALL_DIR}"
    else
      die "Cannot create ${INSTALL_DIR} — run as root or install sudo."
    fi
    git clone --branch main "${AGEMON_REPO}" "${INSTALL_DIR}"
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
    read -r -p "  Generate a new ed25519 SSH key? [Y/n] " answer </dev/tty
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
  printf "\n"
  printf "  ${BOLD}Add the following public key to GitHub (Settings → SSH keys):${RESET}\n"
  printf "\n"
  cat "${SSH_KEY}.pub"
  echo ""
  if ! "$NON_INTERACTIVE"; then
    read -r -p "  Press Enter after adding the key to GitHub..." </dev/tty
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
    "${AGEMON_DIR}/extensions" \
    "${AGEMON_DIR}/skills"

  success "Runtime directories created at ${AGEMON_DIR}"

  if [ "$OS_TYPE" = "macos" ]; then
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
  local host="$4"

  printf 'AGEMON_KEY=%s\nPORT=%s\nHOST=%s\n' "$key" "$port" "$host" > "$env_file"
}

generate_secrets() {
  step "Configuring environment"

  ENV_FILE="${AGEMON_DIR}/env"

  # Use provided key or generate one
  if [ -n "${AGEMON_KEY:-}" ]; then
    info "Using AGEMON_KEY from environment."
    FINAL_KEY="${AGEMON_KEY}"
  else
    FINAL_KEY="$(openssl rand -hex 32)"
    info "Generated new AGEMON_KEY."
  fi

  if ! "$NON_INTERACTIVE"; then
    # Bind address
    echo ""
    echo "  How should Agemon be accessible?"
    printf "    ${GREEN}1) Local only (127.0.0.1)${RESET} — use tailscale serve or a reverse proxy for remote access (recommended)\n"
    printf "    ${RED}2) Network (0.0.0.0)${RESET} — all interfaces, no TLS — ${RED}dangerous on untrusted networks${RESET}\n"
    echo ""
    read -r -p "  Choice [1]: " host_choice </dev/tty
    host_choice="${host_choice:-1}"
    case "$host_choice" in
      2)
        HOST="0.0.0.0"
        warn "Binding to 0.0.0.0 — consider a reverse proxy (Caddy/nginx) with HTTPS for production."
        ;;
      *) HOST="127.0.0.1" ;;
    esac

    # Port (with availability check)
    while true; do
      read -r -p "  Port [${PORT}]: " input_port </dev/tty
      PORT="${input_port:-${PORT}}"
      if check_port_available "$PORT"; then
        break
      fi
      warn "Port ${PORT} is already in use."
      PORT="3000"
    done
  fi

  FINAL_PORT="${PORT}"
  FINAL_HOST="${HOST}"

  mkdir -p "${AGEMON_DIR}"
  write_env_file "${ENV_FILE}" "${FINAL_KEY}" "${FINAL_PORT}" "${FINAL_HOST}"
  chmod 600 "${ENV_FILE}"

  success "Environment file written to ${ENV_FILE}"
  info "Host: ${FINAL_HOST}, Port: ${FINAL_PORT}"
}

# ---------------------------------------------------------------------------
# Step 9: Install service
# ---------------------------------------------------------------------------
install_systemd_service() {
  local service_user
  service_user="$(whoami)"

  info "Generating systemd service file..."
  sudo tee /etc/systemd/system/agemon.service > /dev/null <<EOF
[Unit]
Description=Agemon — AI Agent Orchestration
After=network.target

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/scripts/agemon-start.sh
Restart=always
RestartSec=3
Environment=NODE_ENV=production
EnvironmentFile=-${HOME}/.agemon/env

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true
ReadWritePaths=${HOME}/.agemon

[Install]
WantedBy=multi-user.target
EOF

  info "Installing systemd service..."
  sudo systemctl daemon-reload
  sudo systemctl enable --now agemon

  if sudo systemctl is-active --quiet agemon; then
    success "Agemon systemd service is running."
  else
    warn "Agemon service may not have started. Check: sudo systemctl status agemon"
  fi
}

install_launchd_service() {
  local plist_dst="${HOME}/Library/LaunchAgents/ai.agemon.server.plist"
  local log_dir="${HOME}/Library/Logs/agemon"

  mkdir -p "${HOME}/Library/LaunchAgents" "${log_dir}"

  info "Generating launchd plist..."
  cat > "$plist_dst" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.agemon.server</string>

    <key>KeepAlive</key>
    <true/>

    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/scripts/agemon-start.sh</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${log_dir}/agemon.log</string>

    <key>StandardErrorPath</key>
    <string>${log_dir}/agemon-error.log</string>

    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

  chmod 644 "$plist_dst"

  info "Installing launchd agent..."
  launchctl unload "$plist_dst" 2>/dev/null || true
  launchctl load "$plist_dst"

  success "Agemon launchd agent loaded: ai.agemon.server"
  info "Logs: ${log_dir}/"
}

# ---------------------------------------------------------------------------
# Step 9.5: Wire bundled extensions
# ---------------------------------------------------------------------------

# Extensions that are recommended for most users
RECOMMENDED_EXTENSIONS="tasks mcp-config mcp-server skills-manager"

is_recommended() {
  local id="$1"
  for r in $RECOMMENDED_EXTENSIONS; do
    [ "$r" = "$id" ] && return 0
  done
  return 1
}

wire_bundled_extensions() {
  step "Bundled extensions"

  local ext_src="${INSTALL_DIR}/extensions"
  local ext_dst="${AGEMON_DIR}/extensions"

  if [ ! -d "$ext_src" ] || [ -z "$(ls -A "$ext_src" 2>/dev/null)" ]; then
    info "No bundled extensions found — skipping."
    return
  fi

  for ext_dir in "$ext_src"/*/; do
    [ -d "$ext_dir" ] || continue
    local ext_id ext_display ext_desc recommended_label default_answer
    ext_id="$(basename "$ext_dir")"
    local link_path="${ext_dst}/${ext_id}"

    # Read name/description from agemon-extension.json if available
    if [ -f "${ext_dir}/agemon-extension.json" ] && command -v python3 &>/dev/null; then
      ext_display="$(python3 -c "import json; d=json.load(open('${ext_dir}/agemon-extension.json')); print(d.get('name','${ext_id}'))" 2>/dev/null || echo "$ext_id")"
      ext_desc="$(python3 -c "import json; d=json.load(open('${ext_dir}/agemon-extension.json')); print(d.get('description',''))" 2>/dev/null || echo "")"
    else
      ext_display="$ext_id"
      ext_desc=""
    fi

    if [ -L "$link_path" ]; then
      success "Extension already linked: ${ext_display}"
      continue
    fi

    if [ -e "$link_path" ]; then
      warn "Skipping ${ext_display} — ${link_path} exists and is not a symlink."
      continue
    fi

    if "$NON_INTERACTIVE"; then
      # In non-interactive mode, only install recommended extensions
      if is_recommended "$ext_id"; then
        ln -s "$ext_dir" "$link_path"
        success "Linked extension: ${ext_display} (recommended)"
      else
        info "Skipped (non-interactive): ${ext_display}"
      fi
    else
      printf "\n"
      if is_recommended "$ext_id"; then
        printf "  ${BOLD}%s${RESET} ${GREEN}(recommended)${RESET}" "$ext_display"
        default_answer="Y"
      else
        printf "  ${BOLD}%s${RESET}" "$ext_display"
        default_answer="N"
      fi
      [ -n "$ext_desc" ] && printf "\n  %s" "$ext_desc"
      printf "\n"
      read -r -p "  Install? [${default_answer}/$([ "$default_answer" = "Y" ] && echo "n" || echo "y")]: " answer </dev/tty
      answer="${answer:-${default_answer}}"
      if [[ "$answer" =~ ^[Yy] ]]; then
        ln -s "$ext_dir" "$link_path"
        success "Linked extension: ${ext_display}"
      else
        info "Skipped: ${ext_display}"
      fi
    fi
  done
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

  info "Building frontend..."
  (cd "${INSTALL_DIR}/frontend" && bun run build)
  success "Frontend built."
}

# ---------------------------------------------------------------------------
# Step 11: Print summary
# ---------------------------------------------------------------------------
print_summary() {
  step "Installation complete"

  local final_host="${FINAL_HOST:-${HOST}}"
  local final_port="${FINAL_PORT:-${PORT}}"
  local display_host="$final_host"
  if [ "$display_host" = "0.0.0.0" ]; then
    display_host="$(hostname -f 2>/dev/null || hostname)"
  fi
  local server_url="http://${display_host}:${final_port}"

  printf "\n"
  printf "  ${BOLD}${GREEN}Agemon is installed!${RESET}\n"
  printf "\n"
  printf "  ${BOLD}Access URL:${RESET}     %s\n" "${server_url}"
  printf "  ${BOLD}Install dir:${RESET}    %s\n" "${INSTALL_DIR}"
  printf "  ${BOLD}Runtime dir:${RESET}    %s\n" "${AGEMON_DIR}"

  printf "  ${BOLD}Env file:${RESET}       %s/env\n" "${AGEMON_DIR}"

  printf "  ${BOLD}Auth key:${RESET}       ${CYAN}%s${RESET}\n" "${FINAL_KEY}"
  printf "\n"
  printf "  ${BOLD}${YELLOW}Save your auth key!${RESET}\n"
  printf "  This is the only time it will be displayed.\n"
  printf "  It's also stored in the env file above.\n"
  printf "\n"
  printf "  ${BOLD}Next steps:${RESET}\n"

  if "$NO_SERVICE"; then
    printf "    1. Start Agemon manually:\n"
    printf "       cd %s && bun run backend/src/server.ts\n" "${INSTALL_DIR}"
  elif [ "$OS_TYPE" = "linux" ]; then
    printf "    1. Check service status:  sudo systemctl status agemon\n"
    printf "    2. View logs:             sudo journalctl -u agemon -f\n"
  else
    printf "    1. Check service status:  launchctl list | grep agemon\n"
    printf "    2. View logs:             tail -f ~/Library/Logs/agemon/agemon.log\n"
  fi

  if "$NO_SERVICE"; then
    printf "    2. Open the UI:            %s\n" "${server_url}"
  else
    printf "    3. Open the UI:            %s\n" "${server_url}"
  fi
  printf "\n"
  if ! command -v claude-agent-acp &>/dev/null; then
    printf "  ${BOLD}${YELLOW}Reminder:${RESET} Install claude-agent-acp to enable AI agent sessions.\n"
    printf "\n"
  fi
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
do_uninstall() {
  print_banner
  detect_os

  step "Uninstalling Agemon"

  # 1. Stop and remove service
  if [ "$OS_TYPE" = "linux" ]; then
    if command -v systemctl &>/dev/null && systemctl is-active --quiet agemon 2>/dev/null; then
      info "Stopping systemd service..."
      sudo systemctl stop agemon 2>/dev/null || true
      sudo systemctl disable agemon 2>/dev/null || true
    fi
    if [ -f /etc/systemd/system/agemon.service ]; then
      info "Removing systemd service..."
      sudo rm -f /etc/systemd/system/agemon.service
      sudo systemctl daemon-reload 2>/dev/null || true
      success "Systemd service removed."
    fi
  elif [ "$OS_TYPE" = "macos" ]; then
    local plist="${HOME}/Library/LaunchAgents/ai.agemon.server.plist"
    if [ -f "$plist" ]; then
      info "Unloading launchd agent..."
      launchctl unload "$plist" 2>/dev/null || true
      rm -f "$plist"
      success "Launchd agent removed."
    fi
  fi

  # 2. Remove app directory
  if [ -d "${INSTALL_DIR}" ]; then
    info "Removing ${INSTALL_DIR}..."
    if [ -w "${INSTALL_DIR}" ]; then
      rm -rf "${INSTALL_DIR}"
    else
      sudo rm -rf "${INSTALL_DIR}"
    fi
    success "App directory removed."
  else
    info "App directory ${INSTALL_DIR} not found — skipping."
  fi

  # 3. Remove logs (macOS only — Linux uses journald)
  if [ "$OS_TYPE" = "macos" ]; then
    rm -rf "${HOME}/Library/Logs/agemon" 2>/dev/null && info "Removed ~/Library/Logs/agemon"
  fi

  # 4. Ask about data directory
  if [ -d "${AGEMON_DIR}" ]; then
    if "$NON_INTERACTIVE"; then
      warn "Keeping data directory ${AGEMON_DIR} (use 'rm -rf ${AGEMON_DIR}' to remove manually)."
    else
      printf "\n"
      warn "Data directory found: ${AGEMON_DIR}"
      printf "  This contains your database, repos, tasks, env file, and SSH-related config.\n"
      read -r -p "  Remove data directory? This is irreversible. [y/N] " answer </dev/tty
      answer="${answer:-N}"
      if [[ "$answer" =~ ^[Yy] ]]; then
        rm -rf "${AGEMON_DIR}"
        success "Data directory removed."
      else
        info "Keeping ${AGEMON_DIR}."
      fi
    fi
  fi

  printf "\n"
  success "Agemon has been uninstalled."
  printf "\n"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"

  if "$UNINSTALL"; then
    do_uninstall
    exit 0
  fi

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
  wire_bundled_extensions
  install_service
  print_summary
}

main "$@"
