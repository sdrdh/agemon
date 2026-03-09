# Agemon — Agent Working Context

> Read `PRD.md` for product spec and `TASKS.md` for the full task breakdown.
> The current task will be provided in the prompt.

---

## What This Is

Agemon is a self-hosted, headless AI agent orchestration platform with a mobile-first web UI. It lets developers queue tasks, monitor agent thought streams, respond to blockers, and approve diffs — all from a phone.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun 1.1+ | Built-in TS, native SQLite, fast startup |
| Backend | Hono 4.x | REST + WebSocket via `hono/bun` (`upgradeWebSocket`) |
| Database | SQLite | `bun:sqlite`, synchronous ops |
| Frontend | React 18 + Vite 5 | Code-split by route |
| UI Components | shadcn/ui | Radix UI + Tailwind, copy-paste components |
| Router | TanStack Router | |
| State | TanStack Query + Zustand | Server state + client state. TanStack Query not yet wired — add when real-time/caching is needed |
| Terminal | xterm.js | Lazy-loaded, ~800KB |
| Styling | Tailwind CSS | |
| Git | simple-git (deferred) | Worktree management — not yet installed, add when Task 3.1 begins |
| Agent protocol | ACP (JSON-RPC 2.0) | Bidirectional stdio — see `docs/acp-agents.md` |
| GitHub API | Octokit | PR creation |
| Website/Docs | Astro 4.x | Static site for product page + docs |

---

## Project Structure (target)

```
agemon/
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── db/          # schema, client, migrations
│   │   ├── routes/      # REST endpoints
│   │   └── lib/         # pty, git, acp, github managers
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes/      # TanStack Router routes
│   │   ├── components/
│   │   │   ├── ui/      # shadcn/ui components (auto-generated)
│   │   │   └── custom/  # custom app components
│   │   └── lib/         # api client, websocket, utils
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── website/
│   ├── src/
│   │   ├── pages/       # Astro routes (landing + docs)
│   │   ├── content/     # Markdown docs
│   │   ├── components/  # Astro + React components
│   │   └── layouts/     # Page layouts
│   ├── package.json
│   └── astro.config.mjs
├── shared/
│   └── types/           # shared TS types (events, tasks, diffs)
├── scripts/
│   └── test-api.sh      # backend API smoke tests
├── CLAUDE.md
├── PRD.md
├── TASKS.md
└── package.json         # bun workspace root
```

---

## Key Conventions

**TypeScript everywhere** — no plain JS files.

**Shared types** — all WebSocket event types and API shapes live in `shared/types/`. Both backend and frontend import from there. Never duplicate type definitions.

**Synchronous DB** — `bun:sqlite` is synchronous by design. Don't wrap queries in fake async.

**WebSocket events** — server broadcasts to all connected clients on any state change. Client is always read-only except for explicit user actions (input responses, terminal keystrokes).

**Task status is system-controlled** — only the agent/system moves tasks between statuses. Users never drag tasks. The only user write action is creating a task or responding to blockers.

**Mobile-first** — every UI component must work on a phone first. Touch targets minimum 44×44px. Test on real device before marking UI tasks done.

**shadcn/ui customization** — default shadcn components have 40px touch targets. Increase to 44px minimum by editing button sizes in `frontend/src/components/ui/button.tsx` after generation.

**Lazy-load the terminal** — xterm.js is heavy. Import it only when the user actually opens a terminal view.

---

## Core Data Model

```
tasks           id, title, description, status, agent, created_at
repos           id, url (unique), name, created_at
task_repos      task_id, repo_id  (many-to-many join table)
agent_sessions  id, task_id, agent_type, external_session_id, pid, state, started_at, ended_at, exit_code
acp_events      id, task_id, session_id, type (thought|action|await_input|result), content, created_at
awaiting_input  id, task_id, session_id, question, status (pending|answered), response, created_at
diffs           id, task_id, content, status (pending|approved|rejected), created_at
```

**Task statuses:** `todo` → `working` → `awaiting_input` → `working` → `done`

Task status is derived: `working` if any session is `running`; `awaiting_input` if any session has a pending input; `done` when user marks explicitly done. Task never auto-transitions to `done`.

**Session states:** `starting` → `ready` → `running` → `stopped` | `crashed` | `interrupted`

- `ready` = ACP handshake done, waiting for user's first prompt (no auto-start)
- `interrupted` = server went down while session was running (distinct from `crashed` = process died on its own)
- One task can have multiple concurrent sessions (e.g. claude-code + opencode running in parallel)
- `external_session_id` = provider session ID captured from CLI output, used for `--resume` on re-spawn
- Task status is **derived** from session states — no auto-done on agent exit, user must explicitly mark done
- Stopped/crashed sessions can be resumed via ACP `session/load`

---

## Auth

Single static token via env var `AGEMON_KEY`. HTTP Bearer on all API routes. No user accounts in v1.

---

## Worktree Convention

Agemon stores all runtime data in `~/.agemon/` (override with `AGEMON_DIR` env var).

```
~/.agemon/
├── agemon.db                        # SQLite database
├── CLAUDE.md                        # global instructions injected into every session
├── plugins/                         # global plugins (symlinked into agent discovery paths)
├── skills/                          # global skills
├── repos/{org}--{repo}.git          # bare repo cache
└── tasks/{taskId}/
    ├── CLAUDE.md                    # generated: references global + per-repo CLAUDE.md/AGENT.md
    ├── .agemonplugins/              # aggregated repo plugins (symlinks into each worktree)
    ├── .agemonskills/               # aggregated repo skills (symlinks into each worktree)
    ├── .claude/plugins/
    │   ├── _global -> ~/.agemon/plugins/
    │   └── _task   -> ../.agemonplugins/
    └── {org}--{repo}/               # git worktree per repo
```

**Agent CWD:** always `~/.agemon/tasks/{taskId}/` — all repos accessible as subdirectories.

**Branch naming:** `agemon/{taskId}-{org}--{repo}`

Global agemon plugins are automatically symlinked into `~/.claude/plugins/agemon` on server startup.

---

## Environment Variables

```
AGEMON_KEY        # required — static auth token
GITHUB_PAT        # required for PR creation
PORT              # optional, default 3000
DB_PATH           # optional, default ~/.agemon/agemon.db
AGEMON_DIR        # optional, default ~/.agemon
```

---

## Testing

**Backend API smoke tests** — `scripts/test-api.sh` runs 21 curl-based checks covering auth, CRUD, SSH validation, project grouping, repo attachment, agent start/stop stubs, and deletion. Requires a running backend.

```bash
# Terminal 1: start backend
cd backend && rm -f agemon.db* && AGEMON_KEY=test bun run src/server.ts

# Terminal 2: run tests (defaults to port 3000)
./scripts/test-api.sh

# Or specify a different port/key:
API_BASE=http://127.0.0.1:3001 AGEMON_KEY=mykey ./scripts/test-api.sh
```

Run these after any backend route, DB, or schema changes.

---

## Worktree-Aware Development

Claude Code may be running inside a git worktree (e.g. `.claude/worktrees/<name>/`), not the main checkout. **Do not hardcode absolute paths.** Use relative paths from the current working directory. When running commands like `bun install`, `bun run`, or type-checking, run them relative to where you are. The `tsc` binary lives at `frontend/node_modules/.bin/tsc` (no root-level typescript install).

---

## Non-Goals (v1)

No multi-user, no cloud SaaS, no desktop native app, no CI/CD integration, no project management tool integrations.
