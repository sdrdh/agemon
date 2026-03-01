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
| State | TanStack Query + Zustand | Server state + client state |
| Terminal | xterm.js | Lazy-loaded, ~800KB |
| Styling | Tailwind CSS | |
| Git | simple-git | Worktree management |
| Agent protocol | ACP SDK | `@agentclientprotocol/sdk` |
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
tasks           id, title, description, status, repos (JSON), agent, created_at
acp_events      id, task_id, type (thought|action|await_input|result), content, created_at
awaiting_input  id, task_id, question, status (pending|answered), response, created_at
diffs           id, task_id, content, status (pending|approved|rejected), created_at
terminal_sessions  id, task_id, shell, pid, created_at
```

**Task statuses:** `todo` → `working` → `awaiting_input` → `working` → `done`

---

## Auth

Single static token via env var `AGEMON_KEY`. HTTP Bearer on all API routes. No user accounts in v1.

---

## Worktree Convention

```
.agemon/tasks/{task-id}/{repo-name}/   # git worktree per repo per task
```

Branch naming: `{task-id}-{repo-name}`

---

## Environment Variables

```
AGEMON_KEY        # required — static auth token
GITHUB_PAT        # required for PR creation
PORT              # optional, default 3000
DB_PATH           # optional, default ./agemon.db
```

---

## Non-Goals (v1)

No multi-user, no cloud SaaS, no desktop native app, no CI/CD integration, no project management tool integrations.
