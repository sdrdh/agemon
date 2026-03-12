## Phase 7: Build & Distribution (Week 7)

**Goal:** Production-ready build and distribution

### Task 7.1: Production Build System

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Configure Vite production build
- [ ] Configure backend TypeScript build
- [ ] Create build scripts
- [ ] Minify and compress assets
- [ ] Generate source maps
- [ ] Optimize bundle size

**Build Output:**
```
dist/
├── public/          # Frontend static files
│   ├── index.html
│   ├── assets/
│   └── favicon.ico
├── server.js        # Compiled backend
└── schema.sql       # Database schema
```

**Acceptance Criteria:**
- `bun run build` produces complete dist/
- Frontend bundle < 200KB (excluding xterm)
- xterm.js lazy-loaded (~800KB)
- Backend compiles without errors
- Source maps generated for debugging
- Static assets properly fingerprinted

**Dependencies:** All Phase 1-6 tasks

---

### Task 7.2: Single Binary Packaging

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Research Bun standalone binary options
- [ ] Bundle SQLite native module
- [ ] Embed frontend static files
- [ ] Create startup script
- [ ] Test on Linux, macOS, Windows

**Target Binary:**
- Single executable file
- Embeds all dependencies
- Creates database on first run
- Serves frontend from embedded files
- ~100-150MB total size

**Acceptance Criteria:**
- Single binary runs without dependencies
- Works on Linux x64
- Works on macOS (Intel and ARM)
- Works on Windows (optional for v1)
- Database auto-created on first run
- Logs to stdout/stderr properly

**Dependencies:** Task 7.1

---

### Task 7.3: Installation Scripts

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Create curl install script
- [ ] Create Homebrew formula
- [ ] Write systemd service file
- [ ] Create Docker image (optional)
- [ ] Setup GitHub releases

**Install Methods:**
```bash
# Curl install
curl -fsSL https://get.agemon.dev | bash

# Homebrew
brew install agemon/tap/agemon

# Docker (optional)
docker run -p 3000:3000 agemon/agemon
```

**Acceptance Criteria:**
- Curl script installs to `~/.local/bin`
- Homebrew formula works
- Systemd service auto-restarts on crash
- GitHub releases have binaries attached
- Install process takes < 1 minute

**Dependencies:** Task 7.2

---

### Task 7.4: Production Single-Port Serving

**Priority:** P0
**Status:** Todo

**Deliverables:**
- [ ] Backend serves built frontend assets via `hono/bun` `serveStatic` in production mode
- [ ] SPA fallback route — all non-API paths serve `index.html`
- [ ] Conditional setup: static serving only when `NODE_ENV=production` (dev mode uses Vite proxy as-is)
- [ ] `bun run build && bun run start` runs the full app on a single port

**Key Considerations:**
- Vite proxy already handles single-port in dev (`:5173` → `:3000`); this is production-only
- Static files served from `../frontend/dist` relative to backend
- Asset paths must align with Vite's build output (`/assets/*` for fingerprinted files)
- Keep CORS middleware dev-only since same-origin in production

**Affected Areas:** backend (server.ts), root package.json (start script)

**Dependencies:** Task 7.1 (production build)

---

### Task 7.5: OS-Native Process Supervision & Graceful Restart

**Priority:** P1
**Status:** Todo

**Deliverables:**
- [ ] systemd user service unit file with `Restart=always` for Linux deployment
- [ ] launchd LaunchAgent plist with `KeepAlive=true` for macOS deployment
- [ ] Graceful shutdown handler — drain WebSocket connections, flush pending DB writes, stop ACP sessions before exit
- [ ] SIGUSR1-based graceful restart — defer restart until idle, then clean shutdown + let supervisor re-launch
- [ ] Supervisor auto-detection — check environment markers (launchd: `LAUNCH_JOB_LABEL`, systemd: `INVOCATION_ID`) to choose restart strategy
- [ ] Install/uninstall commands: `agemon service install` / `agemon service uninstall` to set up platform supervisor config

**Key Considerations:**
- Follows OpenClaw's pattern: no pm2/forever/supervisord — rely on OS-native supervisors
- launchd `ThrottleInterval` should be low (1s) for intentional restarts; `launchctl kickstart -k` bypasses throttle
- Fallback for unsupervised mode: spawn detached child, then exit (self-respawn)
- Graceful shutdown is critical — ACP agent sessions must be cleanly stopped before exit to avoid orphaned processes
- Restart sentinel file (optional, future): persist in-flight state so restarted process can recover context
- Wrapper script should capture the user's full interactive PATH at install time and bake it into the service config (e.g., `Environment=PATH=...` in systemd, `EnvironmentVariables` in launchd plist). This covers edge cases like `nvm`/`fnm`/`asdf`/`mise`-managed binaries that live in versioned paths not covered by the in-code PATH expansion in `agents.ts`. Avoid sourcing shell profiles at runtime (slow, side effects) — snapshot PATH once at install.

**Affected Areas:** backend (new `lib/supervisor.ts`), scripts (service install helpers), docs

**Dependencies:** Task 7.2 (single binary packaging)

---

### Task 7.6: Self-Update via Process Supervisor

**Priority:** P2
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Backend endpoint to check for updates (compare local git hash / version against remote)
- [ ] Expose current version (git hash + build date) via API for settings UI
- [ ] "Check for updates" button in settings UI — shows available update with changelog/diff summary
- [ ] "Update now" action that waits for safe state before exiting (all sessions in `awaiting_input` or terminal state)
- [ ] Broadcast `server_restarting` WebSocket event before exit so frontend can show "Updating..." overlay
- [ ] Frontend detects WebSocket reconnection after restart and reloads page to pick up new assets
- [ ] Wrapper script template for systemd/launchd ExecStart that does `git pull && bun install && exec bun run src/server.ts`
- [ ] Option to force-update immediately (skip waiting for safe state, with confirmation)

**Key Considerations:**
- Agemon doesn't restart itself — it gracefully exits and lets the OS supervisor (systemd/launchd) handle pull + rebuild + restart
- Frontend is served by the backend in production (Task 7.4), so process restart refreshes both
- Safe-state check: poll active sessions until none are in `running` state — only `awaiting_input`, `stopped`, `crashed`, or `ready` are safe
- If sessions never reach safe state, offer a timeout + force option after N minutes
- Version check can be `git ls-remote` against origin or a GitHub releases API call
- Builds on Task 7.5's graceful shutdown and supervisor infrastructure

**Affected Areas:** backend (new update route, shutdown logic), frontend (settings UI, reconnect overlay), scripts (wrapper template)

**Dependencies:** Task 7.4 (Production Single-Port Serving), Task 7.5 (Process Supervision)

---
