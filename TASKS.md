# Agemon Development Tasks

**Project:** Agemon - Mobile-First AI Agent Orchestration Platform  
**Timeline:** 8 weeks to MVP  
**Last Updated:** March 2026

---

## Overview

This document breaks down the development of Agemon v1.0 into actionable tasks organized by phase. Each task includes deliverables, acceptance criteria, and dependencies.

**Key Principles:**
- Each task should be completable in 1-3 days
- Tasks within a phase can be parallelized where noted
- Acceptance criteria must be met before moving to next phase
- Mobile-first validation required for all UI tasks

---

## Phase 1: Core Infrastructure (Week 1-2)

**Goal:** Working dev environment with database, API, and WebSocket foundation

### Task 1.1: Project Initialization

**Priority:** P0 (Blocker)  
**Estimated Time:** 4 hours

**Deliverables:**
- [x] Initialize Bun project with TypeScript
- [x] Setup monorepo structure (backend, frontend, shared)
- [x] Configure Vite for React frontend
- [x] Setup Fastify backend with TypeScript
- [x] Create `.env.example` with required variables
- [x] Write `README.md` with quick start instructions
- [x] Setup `.gitignore` for node_modules, dist, .env

**Project Structure:**
```
agemon/
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── db/
│   │   ├── routes/
│   │   └── lib/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes/
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── shared/
│   └── types/
├── .env.example
├── README.md
└── package.json (workspace root)
```

**Acceptance Criteria:**
- `bun install` runs successfully
- `bun run dev` starts both backend and frontend
- Frontend accessible at `http://localhost:5173`
- Backend accessible at `http://localhost:3000`
- TypeScript compilation works without errors
- Hot reload works for both frontend and backend

**Dependencies:** None

---

### Task 1.2: Database Schema & Client

**Priority:** P0  
**Estimated Time:** 6 hours

**Deliverables:**
- [x] Install `bun:sqlite` (built-in, replaces better-sqlite3)
- [x] Create `schema.sql` with all tables
- [x] Write database client wrapper (`db/client.ts`)
- [x] Write migration system (version tracking)
- [x] Create seed script with sample data
- [x] Write database query helpers

**Tables to Create:**
- `tasks` - Core task metadata
- `acp_events` - Agent thought stream
- `awaiting_input` - Blocking questions queue
- `diffs` - Pending code reviews
- `terminal_sessions` - PTY session state

**Acceptance Criteria:**
- Database file created on first run
- All tables created successfully
- Migrations track version in `schema_version` table
- Seed data populates sample tasks
- Query helpers return typed results
- Database operations are synchronous (better-sqlite3)

**Dependencies:** Task 1.1

---

### Task 1.5: Schema Rewrite — Agent Sessions

**Priority:** P0
**Estimated Time:** 2 hours

**Deliverables:**
- [x] Rewrite `schema.sql`: add `agent_sessions` table; make `session_id` required on `acp_events` + `awaiting_input`; drop `terminal_sessions`; bump schema version to 2
- [x] Update `db/client.ts`: add session CRUD helpers (`getSession`, `listSessions`, `listSessionsByState`, `insertSession`, `updateSessionState`); remove terminal_session helpers; update `insertEvent` and `insertAwaitingInput` to require `session_id`
- [x] Update `shared/types/index.ts`: add `AgentSession`, `AgentSessionState`; add `session_id` to `ACPEvent` + `AwaitingInput`; drop `TerminalSession`; add `session_started` + `session_state_changed` WS events
- [x] Update `backend/src/db/seed.ts` to create sessions before events

**Acceptance Criteria:**
- `bun run backend/src/db/seed.ts` runs clean against new schema
- `bun tsc --noEmit` in `backend/` passes with no errors
- `schema_version` table contains version 2

**Dependencies:** Task 1.2

---

### Task 1.3: REST API Foundation

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [x] ~~Setup Fastify with TypeScript~~ (using Hono instead)
- [x] Configure CORS for frontend
- [x] Implement authentication middleware (AGEMON_KEY Bearer token)
- [x] Create error handling middleware
- [x] Setup request logging
- [x] Create API route structure

**API Routes Implemented:**
```
GET    /api/health          - Health check
GET    /api/tasks           - List all tasks
GET    /api/tasks/by-project - Tasks grouped by repo
POST   /api/tasks           - Create new task
GET    /api/tasks/:id       - Get task details
PATCH  /api/tasks/:id       - Update task
DELETE /api/tasks/:id       - Delete task
GET    /api/tasks/:id/events - ACP events
GET    /api/tasks/:id/chat  - Chat history
GET    /api/repos           - All registered repos
GET    /api/sessions        - All agent sessions
POST   /api/tasks/:id/start - Spawn agent
POST   /api/tasks/:id/stop  - Stop agent
```

**Acceptance Criteria:**
- All routes return proper JSON responses
- Authentication blocks unauthenticated requests
- Errors return consistent JSON format
- Request logging shows method, path, status
- CORS allows frontend origin
- TypeScript types for all request/response bodies

**Dependencies:** Task 1.2

---

### Task 1.4: WebSocket Infrastructure

**Priority:** P0  
**Estimated Time:** 6 hours

**Deliverables:**
- [x] ~~Install `@fastify/websocket`~~ (using Hono/Bun WebSocket instead)
- [x] Setup WebSocket server
- [x] Implement connection handling
- [x] Create broadcast helper function
- [x] Define event types (TypeScript)
- [x] Test multi-client broadcasting

**Event Types:**
```typescript
type ServerEvent = 
  | { type: 'task_updated', task: Task }
  | { type: 'agent_thought', taskId: string, content: string }
  | { type: 'awaiting_input', taskId: string, question: string }
  | { type: 'terminal_output', sessionId: string, data: string };

type ClientEvent =
  | { type: 'send_input', taskId: string, response: string }
  | { type: 'terminal_input', sessionId: string, data: string };
```

**Acceptance Criteria:**
- WebSocket endpoint at `/ws`
- Multiple clients can connect simultaneously
- Events broadcast to all connected clients
- Client receives immediate update on task change
- Reconnection works after disconnect
- Type-safe event handling

**Dependencies:** Task 1.3

---

### Task 1.6: Supervised Dev Server

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Replace shell `&` in root `dev` script with `concurrently` (or `bun run --parallel`)
- [x] Prefixed, color-coded output per process (`[API]` / `[WEB]`)
- [x] Kill-others-on-fail — if backend crashes, frontend dies too (and vice versa)
- [x] Clean signal forwarding (Ctrl+C kills both processes)

**Key Considerations:**
- `concurrently` is the standard (~39M weekly downloads), adds one devDependency
- Alternative: `bun run --parallel --filter '*' dev --if-present` — zero deps but no kill-others-on-fail
- Current shell `&` + `wait` orphans processes on crash and interleaves output

**Affected Areas:** root package.json (dev script)

**Dependencies:** None

---

## Phase 2: Frontend Foundation (Week 2-3)

**Goal:** Mobile-optimized Kanban board with real-time updates

### Task 2.1: shadcn/ui Component Library Setup

**Priority:** P0
**Estimated Time:** 8 hours

**Deliverables:**
- [x] Install Tailwind CSS and configure
- [x] Run `shadcn-ui init` to setup base configuration
- [x] Add core components (`button`, `card`, `badge`, `dialog`, `input`, `select`, `toast`, `tabs`)
- [x] Customize touch targets for mobile (44×44px minimum)
- [x] Configure dark mode with CSS variables
- [ ] Create mobile-specific variants (bottom sheets, floating action button)
- [ ] Test components on actual mobile device

**shadcn Components to Install:**
```bash
bunx shadcn-ui@latest init
bunx shadcn-ui@latest add button card badge dialog input select toast tabs sheet
```

**Mobile Customizations Required:**
- Edit `frontend/src/components/ui/button.tsx` - increase default sizes:
  - `default: "h-11 px-5 py-3"` (from h-10)
  - `icon: "h-11 w-11"` (from h-10 w-10)
- Add `Sheet` component for mobile bottom drawers
- Create floating action button variant for "Add Task"

**Acceptance Criteria:**
- All components work on mobile (tested on actual device)
- Touch targets minimum 44×44px (verified)
- Dark mode support via CSS variables
- Components are accessible (Radix UI handles ARIA)
- Consistent spacing and typography
- TypeScript props properly typed
- Bundle size ~50-60KB for UI components

**Dependencies:** Task 1.1

**Parallelizable:** Can work alongside backend tasks

---

### Task 2.2: Kanban Board View

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [x] Create `Kanban` component (visual-only columns, no drag-and-drop)
- [x] Create `Column` component (To-Do, Working, Awaiting Input, Done)
- [x] Create `TaskCard` component
- [x] Implement task filtering by status
- [x] Setup WebSocket for real-time updates
- [x] Add empty state messaging
- [x] Mobile responsive layout (horizontal scroll on mobile)

**Features:**
- Vertical scroll on mobile
- Horizontal scroll or tabs for columns
- Real-time task movement
- Task count badges
- Pull-to-refresh (mobile)

**Acceptance Criteria:**
- Displays tasks grouped by status
- Updates in real-time when task status changes
- Works smoothly on mobile (test on actual device)
- Empty columns show helpful message
- Loading state while fetching tasks
- Handles 100+ tasks without performance issues

**Dependencies:** Task 1.4, Task 2.1

---

### Task 2.3: Add Task Flow

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [x] Create "Add Task" button (full-page form instead of floating button)
- [x] Create task creation form
- [x] Implement form with validation
- [x] Multi-select for repositories (RepoSelector component)
- [x] Agent selection dropdown (AgentSelector component)
- [x] Submit and update task list

**Form Fields:**
- Title (required)
- Description (optional)
- Repositories (multi-select, required)
- Agent (select: claude-code, aider, gemini)

**Acceptance Criteria:**
- Modal opens with smooth animation
- Form validates before submission
- Shows error messages inline
- Submits via POST /api/tasks
- Closes modal on success
- New task appears in "To-Do" column immediately
- Works well on mobile keyboard

**Dependencies:** Task 2.2

---

### Task 2.4: Task Detail View

**Priority:** P1  
**Estimated Time:** 8 hours

**Deliverables:**
- [x] Create task detail route (`/tasks/$id`)
- [x] Display task metadata (title, status badge in header)
- [x] Show chat-style interface with streaming message accumulation
- [x] Add "Start Agent" button (for To-Do tasks)
- [x] Add "Stop Agent" button (for Working tasks)
- [x] Mobile-optimized layout
- [x] Collapsible activity groups (thoughts + tool calls grouped and collapsed by default)
- [x] Live agent activity indicator (Thinking, Reading file.ts, Running command, etc.)
- [x] Multi-turn prompt support (send follow-up messages to running agent)
- [x] Chat history persistence and REST endpoint (`GET /tasks/:id/chat`)

**Features:**
- Sticky header with back button, title, status badge, stop button
- Scrollable chat area with auto-scroll on new messages
- Sticky bottom input bar (contextual: Start Agent / Send message / disabled)
- Streaming message chunks accumulate into single bubbles via stable messageId
- Agent thoughts and tool calls collapsed into "N thoughts, M tool calls" groups
- Agent message responses shown as full chat bubbles
- User messages right-aligned, agent left-aligned, system centered
- Pulsing activity indicator showing current agent action

**Acceptance Criteria:**
- Route works with deep linking
- Displays all task information
- Event stream updates in real-time
- Start/Stop buttons work correctly
- Back navigation returns to Kanban
- Looks good on mobile screen

**Dependencies:** Task 2.2

---

## Phase 3: Git Integration (Week 3-4)

**Goal:** Multi-repo worktree management and GitHub PR creation

### Task 3.1: Git Worktree Manager

**Priority:** P0  
**Estimated Time:** 12 hours

**Deliverables:**
- [x] Install `simple-git` dependency
- [x] Create `GitWorktreeManager` class
- [x] Implement worktree creation (bare repo cache + per-task worktrees)
- [x] Implement worktree deletion (per-task and per-repo cleanup)
- [x] Branch naming convention logic (`agemon/{taskId}-{org}-{repo}`)
- [x] Path resolution utilities (`getWorktreePath`, `getBranchName`)

**Core Functions:**
```typescript
class GitWorktreeManager {
  createWorktree(taskId: string, repoUrl: string, baseBranch: string): Promise<string>
  deleteWorktree(taskId: string, repoName: string): Promise<void>
  commitChanges(taskId: string, message: string): Promise<void>
  pushBranch(taskId: string, repoName: string): Promise<void>
  getWorktreePath(taskId: string, repoName: string): string
  getDiff(taskId: string): Promise<string>
}
```

**Acceptance Criteria:**
- Worktree created at `.agemon/tasks/{taskId}/{repoName}`
- Branch follows naming: `{taskId}-{repoName}`
- Multiple worktrees for same repo work independently
- Cleanup removes worktree and references
- Error handling for git failures
- Works with SSH and HTTPS git URLs

**Dependencies:** Task 1.2

---

### Task 3.2: GitHub Integration

**Priority:** P1  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Install `@octokit/rest` for GitHub API
- [ ] Create GitHub client wrapper
- [ ] Implement PR creation
- [ ] Store PR URLs in database
- [ ] Handle authentication with PAT

**Functions:**
```typescript
class GitHubClient {
  createPR(repo: string, branch: string, title: string, body: string): Promise<string>
  getPRStatus(url: string): Promise<'open' | 'merged' | 'closed'>
  linkPRToTask(taskId: string, prUrl: string): Promise<void>
}
```

**Acceptance Criteria:**
- PR created successfully via API
- PR URL stored in task metadata
- Handles GitHub API errors gracefully
- Works with organization and personal repos
- PAT loaded from environment variable

**Dependencies:** Task 3.1

---

### Task 3.3: "One-Tap" Multi-Repo PR Flow

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Create "Approve & Create PRs" button
- [ ] Implement coordinated commit flow
- [ ] Push all branches simultaneously
- [ ] Create PRs for all repos
- [ ] Update task status to "Done"
- [ ] Show success notification with PR links

**Flow:**
1. User taps button
2. Commit changes in all repos (same message)
3. Push all branches
4. Create linked PRs
5. Update task to "Done"
6. Display success message with PR links

**Acceptance Criteria:**
- Commits use consistent message across repos
- All branches pushed before PR creation
- PRs reference each other in description
- Rollback on failure (atomic operation)
- Shows progress indicator during operation
- Mobile-friendly success screen with PR links

**Dependencies:** Task 3.2

---

### Task 3.4: Generate Task-Level CLAUDE.md and Symlink Skills for Agent Context

**Priority:** P1
**Estimated Time:** 4 hours

**Deliverables:**
- [ ] Generate a `CLAUDE.md` at the task folder (`.agemon/tasks/{task-id}/CLAUDE.md`) when an agent session starts
- [ ] Include task context: title, description, status, attached repos
- [ ] Include worktree context: branch name convention, repo paths within the task folder
- [ ] Include behavioral guidelines: commit to worktree branch, don't modify main, don't push without approval
- [ ] Symlink each repo's `.claude/skills/*` into `.agemon/tasks/{task-id}/.claude/skills/` (flat, first-repo-wins on collision, log warning on skip)
- [ ] Regenerate CLAUDE.md and re-symlink skills on session resume
- [ ] Regenerate CLAUDE.md and re-symlink skills when repos are attached/detached from a task
- [ ] Skip generation when no worktree exists (fallback cwd mode)

**Key Considerations:**
- Agent cwd is the task folder (`.agemon/tasks/{task-id}/`), so our CLAUDE.md loads as the project-level context
- Repo CLAUDE.md files won't auto-load (Claude Code walks up, not down) — reference their paths in our generated file so the agent can read them
- Flat skill symlinks keep Claude's skill matching working naturally (no namespace prefixes)
- Hook into `spawnAndHandshake` and `resumeSession` in `backend/src/lib/acp.ts`, right after `agentCwd` is resolved
- Keep generated CLAUDE.md concise — agents have context limits
- Repo attach/detach route (`routes/tasks.ts`) should trigger regeneration for all active sessions of that task

**Affected Areas:** backend (`lib/acp.ts`, `routes/tasks.ts`, new template utility)

**Dependencies:** Task 3.1 (Git Worktree Manager)

---

### Task 3.5: Session Context Usage Tracking & Display

**Priority:** P1
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Capture `usage_update` notifications from ACP agents (currently ignored at `lib/acp.ts:375`)
- [ ] Normalize token fields (inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens)
- [ ] Store cumulative usage on the `agent_sessions` table (add columns or JSON field)
- [ ] Broadcast usage updates to frontend via WebSocket event (`session_usage_update`)
- [ ] Add shared types for session usage data
- [ ] Display context usage in session UI (token counts, context window % bar)

**Key Considerations:**
- ACP agents already emit `usage_update` — protocol support is mature across claude-agent-acp, openclaw, acpx
- Distinguish between accumulated usage (sum of all API calls) and last-call usage (true context window at end) — last-call is more useful for showing context % utilization
- Keep DB writes efficient — usage updates can be frequent; consider batching or only storing latest snapshot per session
- Frontend display should be lightweight — a small context bar or token count in the session header, not a full dashboard

**Affected Areas:** backend (`lib/acp.ts`, `db/schema.sql`, `db/client.ts`), shared types, frontend (session UI)

**Dependencies:** Task 4.1 (ACP Client Setup)

---

## Phase 4: ACP Integration (Week 4-5)

**Goal:** Spawn agents, parse events, handle "Awaiting Input" state

### Task 4.1: ACP Client Setup

**Priority:** P0 — **HIGH PRIORITY: requires protocol rewrite**
**Estimated Time:** 10 hours

> **CRITICAL FINDING:** Current `acp.ts` spawns agents as simple JSONL-on-stdout processes.
> Real ACP agents use **JSON-RPC 2.0 over stdin/stdout** (bidirectional).
> The agent process exits immediately because stdin is not piped.
> See `docs/acp-agents.md` for full details on each agent's requirements.

**Deliverables:**
- [x] ~~Install `@agentclientprotocol/sdk`~~ (using direct binary spawning instead)
- [x] ~~Create `ACPAgentManager` class~~ (implemented as `lib/acp.ts` functions)
- [x] Implement session-aware agent spawning (creates `agent_sessions` row on spawn)
- [x] Capture `external_session_id` from `session/new` response for `--resume` support
- [x] Handle session initialization and state transitions
- [x] **Pipe stdin to agent process** (`stdin: 'pipe'`)
- [x] **Implement JSON-RPC 2.0 handshake** (`initialize` → `session/new` → `session/prompt`)
- [x] Send prompts to agent via JSON-RPC `session/prompt`
- [x] Update session `pid` and `state` throughout lifecycle
- [x] Auto-approve `requestPermission` requests for headless operation
- [x] Use task worktree cwd for agent working directory

**Agent Support (see `docs/acp-agents.md`):**
- Claude Code (via `claude-agent-acp`) — needs `claude /login`, most complex
- OpenCode (`opencode acp`) — env var auth, simplest to integrate first
- Gemini CLI (`gemini --experimental-acp`) — Google auth, experimental

**Functions:**
```typescript
class ACPAgentManager {
  spawnAgent(taskId: string, agentType: AgentType, goal: string, resumeSessionId?: string): Promise<AgentSession>
  sendPrompt(sessionId: string, prompt: string): Promise<void>
  stopAgent(sessionId: string): Promise<void>
}
```

**Acceptance Criteria:**
- Agent process spawns with `stdin: 'pipe'` and creates an `agent_sessions` row with `state: 'starting'`
- JSON-RPC `initialize` handshake completes successfully
- `external_session_id` captured from CLI output and written to session row
- Session moves to `running` after ACP handshake
- Session moves to `stopped` or `crashed` on exit
- Clean shutdown via JSON-RPC `shutdown` request + `exit` notification
- Error handling for agent crashes (state → `crashed`)

**Dependencies:** Task 1.5, Task 3.1

---

### Task 4.2: Auto-Resume on Startup

**Priority:** P0
**Estimated Time:** 3 hours

**Deliverables:**
- [x] On server boot: query `agent_sessions` where `state IN ('running', 'starting')`
- [x] Mark all found sessions as `interrupted`
- [ ] Re-spawn each with `--resume <external_session_id>` (if `external_session_id` is set)
- [ ] Insert new `agent_sessions` row for each re-spawned process (linking same task)
- [x] Broadcast `session_state_changed` for interrupted sessions (via frontend WS reconnect + query invalidation)
- [ ] Broadcast `session_started` for re-spawned sessions

**Acceptance Criteria:**
- Server restart recovers in-progress sessions automatically
- Sessions without `external_session_id` are marked `interrupted` but not re-spawned
- New session rows are created (old rows preserved as history)
- Task status remains correct after recovery

**Dependencies:** Task 4.1

---

### Task 4.3: ACP Event Stream Parser

**Priority:** P0 — **HIGH PRIORITY: requires JSON-RPC 2.0 implementation**
**Estimated Time:** 10 hours

> **NOTE:** Current `readStdout()` in `acp.ts` reads JSONL lines and looks for `type` fields.
> Real ACP uses JSON-RPC 2.0 — responses have `jsonrpc`, `id`, `method`, `result` fields.
> Agent thoughts/actions come as JSON-RPC notifications or streaming response parts.
> See `docs/acp-agents.md` for protocol details.

**Deliverables:**
- [x] Implement JSON-RPC 2.0 message parser (handle requests, responses, notifications)
- [x] Map ACP `session/update` notifications to internal event types
- [x] Store events in `acp_events` table (with streaming chunk accumulation — one DB row per complete message)
- [x] Broadcast events via WebSocket with stable `messageId` for chunk merging
- [x] Render streaming chat in UI with live message accumulation
- [x] Handle different event types

**Event Types Handled:**
- `agent_message_chunk` → `action` — Agent response text (streaming, accumulated into single messages)
- `agent_thought_chunk` → `thought` — Agent reasoning (streaming, accumulated)
- `tool_call` → `action` — Tool invocations with title and status
- `tool_call_update` → `action` — Tool completion/failure updates
- `__raw__` → `thought` — Non-JSON-RPC output from agent process

**Acceptance Criteria:**
- JSON-RPC 2.0 messages parsed correctly (requests, responses, notifications)
- ACP protocol events mapped to internal types
- Events stored with proper timestamps
- Events broadcast to connected clients
- UI displays thought stream in real-time
- Handles malformed events gracefully
- Performance: Can handle 100+ events/minute

**Dependencies:** Task 4.1, Task 2.4

---

### Task 4.4: "Awaiting Input" Handler

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [x] Detect `await_input` events
- [x] Move task to "awaiting_input" status
- [x] Store question in database
- [x] Render input form in UI (amber-styled input request bubble)
- [x] Send user response back to agent (`send_input` WS event)
- [x] Resume agent execution (task returns to `working`)

**UI Components:**
- Question display
- Text input OR option selector
- Submit button
- Loading state while agent processes

**Acceptance Criteria:**
- Task automatically moves to "Awaiting Input"
- Question displays in mobile-friendly format
- User can respond via text or select option
- Response sent to agent successfully
- Task resumes to "Working" after response
- Notification sent when input needed

**Dependencies:** Task 4.3

---

## Phase 4.5: Session-Centric UX (Completed)

**Goal:** Make sessions first-class entities with individual chat tabs and per-session state

### Task 4.5: Session-Centric Task Detail

**Priority:** P0
**Status:** Done

**Deliverables:**
- [x] Add `ready` state to `AgentSessionState` (schema v5)
- [x] Split ACP lifecycle into `spawnAndHandshake` (→ ready) and `sendPromptTurn` (ready → running)
- [x] Add `session/load` resume support with fallback to `session/new`
- [x] New endpoints: `POST /tasks/:id/sessions`, `GET /sessions/:id/chat`, `POST /sessions/:id/stop`, `POST /sessions/:id/resume`
- [x] Per-session chat history (`listChatHistoryBySession`)
- [x] Human-readable task IDs via `slugify(title)`
- [x] Task status derived from session states (no auto-done)
- [x] `sessionId` on all broadcast events
- [x] Session tabs with colored state dots and "+" button for new sessions
- [x] Per-session chat keyed by `sessionId` in Zustand store
- [x] Resume button for stopped/crashed sessions
- [x] "Done" button for explicit task completion with worktree cleanup
- [x] Tool call parsing with status icons (Check/X/Loader2)

### Task 4.6: Unread Session Activity Indicators

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] `unreadSessions` state in Zustand store with `markUnread`/`clearUnread` actions
- [x] `WsProvider` marks sessions unread on `agent_thought` and `awaiting_input` events
- [x] `clearUnread` called on tab switch and when messages arrive for active session
- [x] Priority-aware indicators: amber pulsing dot for awaiting input, primary pulsing dot for general unread
- [x] WebSocket connection fully persistent — no stop signals on navigation

### Task 4.7: Session Sidebar, Naming, Markdown & UX Polish

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Responsive sidebar/list navigation (sidebar on desktop ≥1024px, stacked on mobile)
- [x] `SessionListPanel` with grouped Active/Previous sections and inline Stop/Resume actions
- [x] `SessionChatPanel` with mobile back navigation (single header per view)
- [x] Session naming from first prompt (`name` column, schema v6, auto-set in `sendPromptTurn`)
- [x] Archive icon for stopping sessions (replaces Square/X)
- [x] Markdown rendering for agent messages (`react-markdown` + `remark-gfm`)
- [x] `@tailwindcss/typography` with custom code block styling
- [x] Task info drawer (ℹ️ button → slide-out with description, repos, metadata)
- [x] Screen reader text on unread indicator dots (`role="status"` + sr-only labels)

### Task 4.8: Component Splitting (Future)

**Priority:** P2
**Status:** Done

**Deliverables:**
- [x] Extract `TaskInfoDrawer`, `SessionListPanel`, `SessionChatPanel` from `tasks.$id.tsx` into `src/components/custom/`
- [x] Reduce `tasks.$id.tsx` to layout composition only

> Prompt: see `docs/future-prompts.md` → Prompt 3

### Task 4.9: Native Chat App Bottom Navigation (Future)

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Replace top `NavBar` with `BottomNav` fixed to bottom (icons + labels)
- [x] Hide `BottomNav` on task detail pages
- [x] Minimal branding header on non-detail pages
- [x] Safe area handling for iOS home indicator on input bar

> Prompt: see `docs/future-prompts.md` → Prompt 1

### Task 4.10: Activity-Specific Icons in Chat (Future)

**Priority:** P2
**Status:** Done

**Deliverables:**
- [x] Distinct icons for thoughts (Brain), tool calls (Wrench), and skills (Zap)
- [x] Update `parseActivityMessages` to categorize skills separately
- [x] Render activity-type icons alongside status icons in `ActivityGroup`

> Prompt: see `docs/future-prompts.md` → Prompt 2

---

### Task 4.11: Multi-Theme System & Settings Page

**Priority:** P2
**Status:** Done

**Deliverables:**
- [x] Theme engine with 6 themes: Monochrome Stealth (default), Cyber Indigo, Terminal Green, Graphite Line Indigo, Dracula, One Dark Pro
- [x] Light/dark/system color mode support; dark-only enforcement for terminal/dracula/one-dark themes
- [x] CSS variable system (`data-theme` attribute + `.dark` class) with per-theme overrides in `index.css`
- [x] `ThemeProvider` context + `useTheme()` hook (`lib/theme-provider.tsx`, `lib/theme.ts`)
- [x] Persistent theme/mode storage via localStorage
- [x] Settings page (`/settings`) with visual theme grid (swatch cards) and color mode toggle
- [x] System `prefers-color-scheme` listener for auto dark mode

---

### Task 4.12: Rich Tool Call Details in Chat

**Priority:** P2
**Status:** Todo

**Deliverables:**
- [ ] Store full tool call metadata (tool name, arguments, input params) in ACP events — not just the flattened content string
- [ ] Parse and surface tool-specific details: command for Bash, file path for Read/Edit/Write, pattern for Grep/Glob, query for WebSearch
- [ ] Render tool calls collapsed by default in activity groups (current behavior)
- [ ] On tap/expand, show full tool call details inline — tool type, all arguments, and output/result
- [ ] Mobile-friendly expandable detail view (consider bottom sheet or inline accordion)

**Key Considerations:**
- Currently all tool call data is flattened to a string like `[tool:ID] Title (status)` — rich metadata is lost at the backend before it reaches the frontend
- Backend `acp.ts` receives full `toolCall` objects from the ACP agent but only extracts `toolCallId`, `title`, and `status`
- May need a structured JSON column or separate fields in `acp_events` to preserve the full tool call payload
- Builds on existing `parseActivityMessages` and `ActivityGroup` components

**Dependencies:** None (existing tool call flow works, this enhances it)

---

### Task 4.13: Conversational Task Description Refinement

**Priority:** P2
**Status:** Todo

**Deliverables:**
- [ ] Allow creating tasks with minimal info (just a title) and fleshing out the description later via chat with an agent
- [ ] Agent-assisted description enrichment — chat back and forth to clarify intent, add context, capture constraints, and build a rich description
- [ ] Persist the refined description back to the task so it serves as useful recall context, not a vague one-liner
- [ ] UX for transitioning between "quick capture" and "refine with agent" modes on a task

**Key Considerations:**
- Current task creation is a one-shot form — no way to iteratively build up the description after the fact
- The chat interface already exists per-task; this would use a similar conversational flow but focused on the task definition itself rather than agent work
- The goal is capturing enough context that you remember exactly what the todo is about weeks later
- Think of it like rubber-ducking the task idea with an AI before committing to it

**Dependencies:** None

---

### Task 4.14: ProjectGroup Configuration

**Priority:** P2
**Status:** Todo

**Deliverables:**
- [ ] First-class `ProjectGroup` entity replacing implicit repo-name grouping from `GET /api/tasks/by-project`
- [ ] DB schema: `project_groups` table (id, name, preserved_patterns, shell_setup, created_at, updated_at)
- [ ] DB schema: `project_group_repos` table (project_group_id, repo_id, setup_script, run_script, teardown_script) — per-repo script overrides since worktree folder names may differ from repo names
- [ ] Tasks belong to a ProjectGroup (add `project_group_id` FK to `tasks` table, nullable for backward compat)
- [ ] Tasks created under a ProjectGroup inherit its config and per-repo scripts
- [ ] REST endpoints: CRUD for ProjectGroups (`/api/project-groups`), attach/detach repos with script overrides
- [ ] Replace `GET /api/tasks/by-project` with `GET /api/project-groups` listing groups + their tasks
- [ ] Frontend: ProjectGroup management UI (create, edit name, configure preserved patterns & shell setup)
- [ ] Frontend: Per-repo script configuration within a ProjectGroup (setup, run, teardown scripts)
- [ ] Frontend: Task creation allows selecting a ProjectGroup (inherits repos + config)

**Key Considerations:**
- Named "ProjectGroup" to avoid confusion with GitHub Projects
- Inspired by emdash's per-repo "Project config" (preserved patterns, shell setup, setup/run/teardown scripts), but elevated to a multi-repo grouping level
- `preserved_patterns` = glob patterns for files the agent should not modify (e.g., `*.lock`, `migrations/**`)
- `shell_setup` = script run once when initializing a new agent session in this group (e.g., `nvm use 18 && export NODE_ENV=dev`)
- Per-repo scripts handle the fact that each repo may need different setup/run/teardown commands and worktree paths
- Migrating existing implicit grouping: existing tasks grouped by repo name can be auto-migrated to ProjectGroups on first access or via a one-time migration script

**Dependencies:** Task 1.3 (DB schema), Task 2.1 (REST routes)

---

### Task 4.15: Settings Page Restructure & Agent Configuration

**Priority:** P1
**Status:** Todo

> Design doc: `docs/plans/2026-03-04-agent-auth-settings-design.md`

**Deliverables:**
- [ ] Restructure settings into sections: Appearance, Agents, Updates, About
- [ ] Move existing theme/color mode UI under Settings → Appearance
- [ ] `GET /api/agents/status` — auto-detect installed binaries (`Bun.which()`), check auth status (env var presence or login health-check), return per-agent status
- [ ] Frontend: Settings → Agents section with agent list cards showing detection badge, auth status badge, and setup instructions
- [ ] Setup instructions per agent: terminal commands to install and authenticate (e.g. "Run `claude /login` in your terminal", "Set `ANTHROPIC_API_KEY` in `.env`"), with note to restart/update Agemon after
- [ ] Default agent/model/mode preferences stored in DB (`settings` table), applied to new sessions
- [ ] Frontend: Default agent dropdown + default model/mode selectors in Settings → Agents
- [ ] Session creation inherits global defaults, user can override per-session
- [ ] Settings → Updates section placeholder (wired up in Task 7.6)
- [ ] Settings → About section with version info and links

**Key Considerations:**
- No proxy login flows or API key inputs in UI — users configure agents in their terminal, then restart Agemon to pick up changes
- Task 7.6 (self-update) handles restart to detect newly installed/authenticated agents
- Global defaults (default agent, model, mode) stored in SQLite `settings` table, not `.env` — `.env` is for secrets and server config only
- Auth detection is read-only: just check if the agent is usable, don't try to fix it from the UI
- Mobile-first: full-width cards, 44px touch targets

**Dependencies:** Task 1.3 (REST routes), Task 4.11 (existing settings page)

---

### Task 4.16: Dynamic Slash Command Menu in Chat

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Capture `available_commands_update` from ACP session updates and broadcast to frontend via WebSocket
- [x] Store available commands per session in frontend state (Zustand)
- [x] Show autocomplete dropdown when user types `/` in chat input, filtered by typing
- [x] Display command name and description in dropdown items
- [x] Selecting a command inserts `/<command>` into the input (sent as regular message)
- [x] Commands refresh automatically when agent sends updated command list (e.g. after session mode change)

**Key Considerations:**
- Commands are agent-provided (dynamic) — no hardcoded command lists. Each agent type (claude-code, opencode, aider, gemini) advertises its own set
- ACP payload shape: `{ sessionUpdate: "available_commands_update", availableCommands: [{ name, description, input?: { hint } }] }`
- Transport is simple: commands are sent as regular `/command` text via existing `send_message` — no new backend dispatch needed
- New shared type `AgentCommand` and new `ServerEvent` variant `available_commands` needed in `shared/types/`
- Mobile-first: dropdown must work well with virtual keyboard visible, 44px touch targets

**Affected Areas:** backend (acp.ts update handler), frontend (chat input component, Zustand store), shared (new types)

**Dependencies:** None (builds on existing chat + ACP infrastructure)

### Task 4.17: Cancel Agent Turn (Escape Key Equivalent)

**Priority:** P1
**Status:** Todo

**Deliverables:**
- [ ] Implement `cancelTurn(sessionId)` in acp.ts — sends ACP `session/cancel` notification, auto-denies pending approvals, keeps session alive ready for next prompt
- [ ] Handle `stopReason: "cancelled"` in prompt turn response — flush partial messages, reset `turnInFlight`, re-derive task status to `awaiting_input`
- [ ] Add WebSocket action `cancel_turn` so frontend can trigger cancellation
- [ ] Convert send button to stop button while agent turn is in flight (same position, same 44px target, swap icon/action)
- [ ] Broadcast a `turn_cancelled` event so frontend can show inline cancellation indicator in chat stream

**Key Considerations:**
- Send → Stop toggle: button stays in the same position, swaps between send icon and stop icon based on `turnInFlight` state. Tap stop = cancel current turn
- This is lighter than `stopAgent()` — cancel stops the current turn but the session stays alive and ready for the next prompt
- ACP spec: `session/cancel` is a notification (no response); the agent responds to the original `session/prompt` request with `stopReason: "cancelled"`
- Client must resolve pending approvals with `cancelled` outcome before sending `session/cancel`
- Agent may still send `session/update` notifications after cancel — client should accept them
- New shared type `TurnCancelledEvent` needed in `shared/types/`

**Affected Areas:** backend (acp.ts, ws handler), frontend (chat input button toggle, event handling), shared (new event type)

**Dependencies:** None (builds on existing ACP infrastructure)

---

### Task 4.18: Fix Tool Call Approval Dialog Persistence

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Persist pending approval state so the dialog re-renders when user returns to a session
- [x] ~Auto-select the session with a pending approval when navigating back to a task~ (removed — auto-select caused back gesture to immediately re-enter the session; session list icons are sufficient for discovery)
- [x] Ensure approval cards never silently disappear (fallback UI if lookup fails)
- [ ] Add a global indicator (e.g., badge on task card or nav) showing tasks with unresolved approvals

**Key Considerations:**
- Approval state already persists in Zustand store and backend DB — the issue is purely a rendering/routing problem
- `SessionChatPanel` unmounts when `selectedSessionId` is null, destroying all approval UI
- `ChatBubble` silently returns `null` when `approvalLookup.get(content)` fails — needs a fallback
- On route re-entry, `GET /api/tasks/:id/approvals` re-fetches but the session must also be re-selected for the panel to mount
- Consider auto-scrolling to the pending approval card on re-mount

**Affected Areas:** frontend (routes/tasks.$id.tsx, session-chat-panel, chat-bubble, ws-provider, store)

**Dependencies:** None (existing approval flow works, this fixes a UX regression)

---

### Task 4.19: Token Usage Tracking per Session

**Priority:** P2
**Estimated Time:** 4 hours

**Deliverables:**
- [ ] Parse `usage_update` notifications from ACP (currently discarded in `default: break` at acp.ts)
- [ ] Store cumulative input/output token counts per session in the DB
- [ ] Broadcast usage updates to frontend via WebSocket
- [ ] Display token counts (input/output/total) in the session chat header

**Key Considerations:**
- ACP `session/update` with `usage_update` type already arrives at the backend — just needs handling instead of being silently dropped
- Raw token counts only — no cost estimation needed
- Cumulative per session (sum of all turns)
- Lightweight display: compact token count in session header, no separate page needed

**Affected Areas:** backend (acp.ts, db schema, ws events), frontend (session chat header), shared (new types)

**Dependencies:** None

---

### Task 4.20: Context Window Utilization Monitor

**Priority:** P1
**Estimated Time:** 4 hours

**Deliverables:**
- [ ] Derive context window fill percentage from token usage data (used tokens / max context window)
- [ ] Display a context window % progress bar prominently in the session chat header
- [ ] Show a warning indicator when context usage exceeds a threshold (e.g., 80%)
- [ ] Show context % per session tab so users can see utilization for each active session

**Key Considerations:**
- Context window max varies by agent/model — may need a configurable default or agent-reported value
- This is the primary usage metric users care about — more prominent than raw token counts
- If the ACP `usage_update` doesn't include max context size, use known defaults per agent type (e.g., claude-code = 200k)
- Progress bar should use color coding: green → yellow → red as context fills up
- Depends on Task 4.19 for the underlying token data pipeline

**Affected Areas:** frontend (session chat header, session tabs), backend (context % calculation), shared (types)

**Dependencies:** Task 4.19 (token usage data pipeline)

---

### Task 4.21: MCP Server Configuration for Agent Sessions

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Global MCP server config — servers available to all agent sessions (stored in DB)
- [x] Task-level MCP server config — servers scoped to a specific task's sessions
- [x] Populate `mcpServers` in ACP `session/new` and `session/load` calls with merged global + task-level configs
- [x] API endpoints to manage MCP server configs (CRUD at global and task level)
- [x] Frontend UI to add/remove MCP servers at global and task level

**Key Considerations:**
- ACP already accepts `mcpServers` array in handshake — currently hardcoded to `[]` in three places in `acp.ts`
- MCP server config shape: name, transport type (stdio/streamable-http), command/URL, env vars, auth headers
- Merge order: global configs + task-level configs (task overrides global if same name)
- Common use cases: context7 for docs, Agemon's own `/mcp` endpoint for cross-task orchestration, filesystem tools
- Consider whether session-level overrides are needed (probably not for v1)

**Affected Areas:** backend (db schema, acp.ts handshake, new API routes), frontend (settings UI, task config UI), shared (new types)

**Dependencies:** Task 4.1 (ACP Client)

### Task 4.22: Markdown Rendering for Task Descriptions

**Priority:** P2
**Status:** Done

**Deliverables:**
- [x] Render task description as Markdown in the task info drawer
- [x] Support GFM (tables, checklists, strikethrough) and syntax-highlighted code blocks

**Key Considerations:**
- All dependencies already installed and used for chat bubbles (`react-markdown`, `remark-gfm`, `rehype-highlight`, `@tailwindcss/typography`)
- Same pattern as chat bubble markdown rendering, applied to task description

**Affected Areas:** frontend (task info drawer)

**Dependencies:** None

### Task 4.23: Back Gesture Navigation from Session to Session List

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Swiping left (back gesture) on a session view navigates back to the session list page
- [x] Ensure browser/OS back gesture and in-app back button both work consistently
- [x] Removed session auto-select entirely — was causing back gesture to immediately re-enter the session

**Key Considerations:**
- Mobile-first: back gesture is a primary navigation pattern on phones
- Uses `history.pushState` on session select + `popstate` listener to handle back gesture
- Auto-select was conflicting with back navigation — removed in favor of session list icons showing approval/unread status

**Affected Areas:** frontend (routing, session views)

**Dependencies:** None

---

### Task 4.24: Archive Tasks and Sessions

**Priority:** P1
**Status:** Todo

**Deliverables:**
- [ ] Add `archived` boolean column to `tasks` table (default false), with schema migration
- [ ] Add `archived` boolean column to `agent_sessions` table (default false), with schema migration
- [ ] Update `TaskStatus` type or add `archived` field to `Task` and `AgentSession` shared types
- [ ] Backend: `PATCH /tasks/:id` accepts `archived: boolean` to archive/unarchive a task
- [ ] Backend: `PATCH /sessions/:id/archive` endpoint to archive/unarchive a session
- [ ] Backend: `GET /tasks` and `GET /tasks/by-project` exclude archived tasks by default; accept `?archived=true` query param to include them
- [ ] Backend: `GET /sessions` excludes archived sessions by default; accept `?archived=true` to include them
- [ ] Frontend kanban view filters out archived tasks (they don't appear in any column)
- [ ] Frontend session list filters out archived sessions
- [ ] Frontend: add archive/unarchive action to task detail view (swipe action or menu item)
- [ ] Frontend: add archive/unarchive action to session list items
- [ ] Frontend: optional "Show archived" toggle on kanban and session list views to reveal archived items (dimmed styling)

**Key Considerations:**
- Archive is a soft-hide, not a delete — archived tasks/sessions remain in DB and can be restored
- Archiving a task should NOT auto-archive its sessions (user may want to keep session history visible)
- Mobile-first: archive action should be accessible via swipe or context menu, not just a buried settings option
- Done tasks accumulate over time and clutter the kanban "Done" column — archive is the escape valve

**Affected Areas:** shared types, backend (db schema, routes), frontend (kanban, session list, task detail)

**Dependencies:** None

---

### Task 4.25: Allow Resuming Interrupted Sessions

**Priority:** P1
**Status:** Done

**Deliverables:**
- [x] Add `'interrupted'` to the allowed states check in `resumeSession()` (`acp.ts:743`) so interrupted sessions can be resumed like stopped/crashed ones
- [x] Frontend: show Resume button on interrupted sessions (same as stopped/crashed) — already handled by `isSessionTerminal()` including `'interrupted'`
- [~] Auto-resuming interrupted sessions on server startup — deferred (user manually resumes via button)

**Key Considerations:**
- Currently `resumeSession()` only allows `stopped` and `crashed` states — `interrupted` is rejected with an error
- `interrupted` means the server went down while the session was active — semantically these are the most important sessions to resume
- The resume path already handles `session/load` with `external_session_id` fallback to `session/new` — no protocol changes needed
- Task 4.2 has unchecked deliverables for auto-resume on startup that depend on this fix
- One-line backend fix + frontend state check update

**Affected Areas:** backend (`lib/acp.ts`), frontend (session list resume button visibility)

**Dependencies:** None

---

## Phase 5: Terminal PTY (Week 5-6)

**Goal:** Live interactive terminal in browser

### Task 5.1: PTY Session Management

**Priority:** P0  
**Estimated Time:** 12 hours

**Deliverables:**
- [ ] Install `node-pty` dependency
- [ ] Create `PTYSessionManager` class
- [ ] Spawn PTY sessions for tasks
- [ ] Handle PTY output streaming
- [ ] Handle user input to PTY
- [ ] Session persistence and recovery

**Functions:**
```typescript
class PTYSessionManager {
  createSession(taskId: string, shell: string): Promise<string>
  writeInput(sessionId: string, data: string): Promise<void>
  onOutput(sessionId: string, callback: (data: string) => void): void
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  killSession(sessionId: string): Promise<void>
}
```

**Acceptance Criteria:**
- PTY spawns with proper environment
- Output streams to WebSocket in real-time
- User input sent to PTY
- Terminal resizes properly
- Session survives browser disconnect
- Cleanup on task deletion

**Dependencies:** Task 1.4

---

### Task 5.2: xterm.js Terminal Component

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Install `@xterm/xterm` and addons
- [ ] Create lazy-loaded Terminal component
- [ ] Setup xterm.js with fit addon
- [ ] Connect to WebSocket for PTY data
- [ ] Handle keyboard input
- [ ] Implement copy/paste

**Addons to Include:**
- `@xterm/addon-fit` - Auto-sizing
- `@xterm/addon-web-links` - Clickable URLs
- `@xterm/addon-search` - Search in output

**Acceptance Criteria:**
- Terminal loads only when user opens it (lazy)
- Renders PTY output in real-time
- User can type commands
- Terminal fits container properly
- Copy/paste works (desktop and mobile)
- Links are clickable
- Search works (Ctrl+F)

**Dependencies:** Task 5.1, Task 2.1

---

### Task 5.3: Mobile Terminal Optimizations

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Mobile keyboard handling
- [ ] Virtual keyboard toolbar (common commands)
- [ ] Touch scrolling optimization
- [ ] Font size adjustment for mobile
- [ ] Landscape mode support

**Features:**
- Tab, Ctrl, Esc buttons above keyboard
- Common command shortcuts (ls, cd, git)
- Pinch-to-zoom font size
- Auto-hide keyboard on scroll

**Acceptance Criteria:**
- Terminal usable on mobile Safari
- Terminal usable on Chrome mobile
- Keyboard doesn't cover terminal
- Common commands easily accessible
- Readable font size on phone
- Works in portrait and landscape

**Dependencies:** Task 5.2

---

## Phase 6: Diff Viewer (Week 6)

**Goal:** Mobile-optimized code review interface

### Task 6.1: Diff Generation

**Priority:** P0  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Generate git diff for task workspace
- [ ] Parse diff into structured format
- [ ] Store diff in database
- [ ] Trigger "awaiting_input" for approval
- [ ] Handle multi-file diffs

**Functions:**
```typescript
class DiffManager {
  generateDiff(taskId: string): Promise<Diff>
  parseDiff(diffText: string): ParsedDiff
  storeDiff(taskId: string, diff: Diff): Promise<string>
}
```

**Acceptance Criteria:**
- Diff captures all changed files
- Diff properly parsed with line numbers
- Stored in database for review
- Task moves to "awaiting_input" status
- Multiple repos handled separately

**Dependencies:** Task 3.1

---

### Task 6.2: Diff Viewer Component

**Priority:** P0  
**Estimated Time:** 12 hours

**Deliverables:**
- [ ] Create mobile-optimized diff viewer
- [ ] Implement syntax highlighting
- [ ] Show line numbers
- [ ] Color-code additions/deletions
- [ ] Collapsible file sections
- [ ] Approve/Reject buttons

**Features:**
- Unified diff view (better for mobile)
- Syntax highlighting per language
- Touch-friendly file navigation
- Sticky file headers
- Show/hide unchanged lines

**Acceptance Criteria:**
- Renders diffs correctly on mobile
- Syntax highlighting works for common languages
- Line numbers aligned properly
- Additions shown in green, deletions in red
- Files collapsible for easier navigation
- Smooth scrolling on mobile
- Works with large diffs (1000+ lines)

**Dependencies:** Task 6.1, Task 2.1

---

### Task 6.3: Approve/Reject Flow

**Priority:** P0  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Approve button triggers commit + push
- [ ] Reject button discards changes
- [ ] Update diff status in database
- [ ] Notify agent of decision
- [ ] Move task to appropriate status

**Flow for Approve:**
1. User taps "Approve"
2. Commit changes with diff description
3. Push branch
4. Update diff status to "approved"
5. Move task back to "working" or trigger PR flow

**Flow for Reject:**
1. User taps "Reject"
2. Optional: User provides feedback
3. Discard staged changes (git reset)
4. Update diff status to "rejected"
5. Notify agent to retry
6. Move task back to "working"

**Acceptance Criteria:**
- Approve commits and pushes successfully
- Reject discards changes properly
- User can provide rejection feedback
- Agent notified of decision via ACP
- Task status updates correctly
- Works smoothly on mobile

**Dependencies:** Task 6.2, Task 3.1

---

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

## Phase 8: Deployment & Documentation (Week 7-8)

**Goal:** Launch-ready with complete documentation

### Task 8.1: Tailscale Setup Guide

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Write Tailscale deployment guide
- [ ] Create cert auto-generation script
- [ ] Document Tailscale HTTPS setup
- [ ] Create troubleshooting section
- [ ] Test on fresh Ubuntu install

**Documentation Sections:**
- Prerequisites
- Install Tailscale
- Enable HTTPS certificates
- Run Agemon with Tailscale
- Access from mobile
- Troubleshooting

**Acceptance Criteria:**
- Someone can follow guide and deploy in < 15 minutes
- HTTPS works via Tailscale certs
- Mobile access confirmed working
- Screenshots included
- Common errors documented

**Dependencies:** Task 7.2

---

### Task 8.2: exe.dev Deployment

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Create exe.dev install script
- [ ] Write deployment guide
- [ ] Setup health check endpoint
- [ ] Create startup/supervisor script
- [ ] Test on exe.dev VM

**One-Command Install:**
```bash
ssh my-vm.exe.xyz
curl -fsSL https://get.agemon.dev/exe-dev | bash
```

**Acceptance Criteria:**
- Install script works on exe.dev Ubuntu
- Agemon accessible at https://{vm}.exe.xyz
- Auto-starts on VM reboot
- Health check returns 200 OK
- Logs viewable via journalctl

**Dependencies:** Task 7.2

---

### Task 8.3: User Documentation

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [x] Quick start guide
- [x] Architecture overview
- [x] API reference
- [x] Deployment guides (local dev done; tailscale/exe-dev/vps pending)
- [ ] Troubleshooting FAQ
- [ ] Contributing guide

**Documentation Structure:**
```
docs/
├── getting-started.md
├── architecture.md
├── deployment/
│   ├── local.md
│   ├── tailscale.md
│   ├── exe-dev.md
│   └── vps.md
├── api-reference.md
├── troubleshooting.md
└── contributing.md
```

**Acceptance Criteria:**
- All major features documented
- Code examples included
- Screenshots for UI features
- Step-by-step deployment guides
- Common issues in FAQ
- Markdown properly formatted

**Dependencies:** All previous tasks

---

### Task 8.4: Mobile UX Polish

**Priority:** P1  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Add touch gestures (swipe back)
- [ ] Create PWA manifest
- [ ] Setup service worker (offline Kanban)
- [ ] Implement push notifications
- [ ] Test on iOS Safari and Chrome mobile
- [ ] Fix any mobile-specific bugs

**PWA Features:**
- Add to Home Screen
- Offline Kanban view
- Background sync
- Push notification permission

**Acceptance Criteria:**
- "Add to Home Screen" works on iOS
- Swipe-back gesture works
- Kanban viewable offline
- Push notifications work (when granted)
- No layout issues on mobile
- Tested on real iPhone and Android device

**Dependencies:** Phase 2 tasks

---

### Task 8.5: Launch Materials

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Record demo video (90 seconds)
- [ ] Create screenshot gallery
- [ ] Write Hacker News launch post
- [ ] Polish GitHub README
- [ ] Create comparison table (vs competitors)
- [ ] Setup analytics (optional, privacy-first)

**Demo Video Flow:**
1. Add task from phone (15s)
2. Agent starts working (15s)
3. Check progress on phone (10s)
4. Approve diff from phone (20s)
5. PRs created automatically (15s)
6. View completion summary (15s)

**Acceptance Criteria:**
- Video is clear and well-paced
- Screenshots show key features
- HN post follows community guidelines
- README compelling and informative
- Comparison table factually accurate
- Ready to launch

**Dependencies:** Task 8.3, Task 8.4

---

### Task 8.6: Astro Website & Documentation Site

**Priority:** P1
**Estimated Time:** 12 hours

**Deliverables:**
- [ ] Initialize Astro project in `website/` directory
- [ ] Configure Tailwind CSS (share config with main app)
- [ ] Create product landing page (hero, features, demo, CTA)
- [ ] Setup content collections for documentation
- [ ] Migrate markdown docs from Task 8.3
- [ ] Add interactive React components (component islands)
- [ ] Create mobile-responsive layout
- [ ] Setup deployment (GitHub Pages, Vercel, or Cloudflare Pages)

**Project Structure:**
```
website/
├── src/
│   ├── pages/
│   │   ├── index.astro              # Landing page
│   │   └── docs/[...slug].astro     # Docs routes
│   ├── content/
│   │   └── docs/                    # Markdown documentation
│   │       ├── getting-started.md
│   │       ├── deployment/
│   │       │   ├── local.md
│   │       │   ├── tailscale.md
│   │       │   ├── exe-dev.md
│   │       │   └── vps.md
│   │       ├── api-reference.md
│   │       ├── troubleshooting.md
│   │       └── contributing.md
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── Features.astro
│   │   ├── DemoVideo.astro
│   │   └── CodeExample.tsx          # React component
│   └── layouts/
│       ├── BaseLayout.astro
│       └── DocsLayout.astro
├── public/
│   ├── screenshots/
│   └── demo.mp4
├── astro.config.mjs
└── package.json
```

**Landing Page Sections:**
1. Hero - "Manage AI Agents from Your Phone"
2. Problem/Solution - Mobile-first orchestration gap
3. Features Grid - Terminal, Diffs, Multi-repo, Mobile review
4. Demo Video - 90-second walkthrough
5. Deployment Options - Quick start guides
6. GitHub CTA - Star repository and install

**Technical Requirements:**
- Static site generation (SSG)
- Share Tailwind config with main app
- React component islands for interactive demos
- Syntax highlighting for code examples
- Mobile-responsive (obviously!)
- Dark mode support
- Search functionality for docs

**Acceptance Criteria:**
- Landing page loads in <1 second on mobile 4G
- Lighthouse score >95 (all categories)
- All deployment guides tested and accurate
- Screenshots show actual app UI
- Mobile-responsive on all pages
- Docs are searchable
- Works offline (PWA optional)
- Deploy URL accessible and stable

**Deployment:**
- **Cloudflare Pages** (Primary)
- Production URL: `https://agemon.dev`
- Preview deployments: Auto-generated for PRs
- Global CDN: 117+ edge locations
- Zero-config Astro integration

**Dependencies:** Task 8.3 (User Documentation), Task 8.5 (Launch Materials - demo video)

**Parallelizable:** Can run alongside Tasks 7.1-7.3 (Build System) and 8.1-8.2 (Deployment Guides)

---

## Success Criteria (v1 Launch)

### Functional Requirements
- [ ] User can add task from mobile in < 30 seconds
- [ ] Agent executes and streams thoughts in real-time
- [ ] User can approve diff from phone
- [ ] Multi-repo PRs created automatically
- [ ] Terminal works interactively on mobile
- [ ] Full workflow completes end-to-end

### Performance Requirements
- [ ] Single binary under 150MB
- [ ] Mobile UI loads in < 2 seconds on 4G
- [ ] Terminal connects in < 500ms on Tailscale
- [ ] WebSocket reconnection seamless
- [ ] Handles 10 concurrent tasks

### Compatibility Requirements
- [ ] Works on iOS Safari
- [ ] Works on Chrome mobile (Android)
- [ ] Works on desktop browsers
- [ ] Deploys on Ubuntu 22.04+
- [ ] Deploys via Tailscale
- [ ] Deploys on exe.dev

### Launch Goals
- [ ] 100-500 GitHub stars in first month
- [ ] 50+ active self-hosted installations
- [ ] Featured on Hacker News front page
- [ ] Positive feedback from ACP community

---

## Post-v1 Backlog

**v1.1 - Enhanced Terminal**
- Bidirectional PTY input improvements
- Terminal themes and customization
- Better copy/paste handling
- Search in terminal history

**v1.2 - Collaboration**
- Share task progress via read-only link
- Team workspace support
- Role-based access control

**v1.3 - Advanced Features**
- Multiple agents per task
- Agent comparison mode
- Custom agent templates
- Workflow automation rules

**v2.0 - Platform Expansion**
- Desktop app (Tauri)
- Browser extension
- CI/CD integration
- Webhook support

**exe.dev Integration & Dev Server Previews**
- exe.dev auto-proxies ports 3000-9999 via HTTPS at `https://{vmname}.exe.xyz:{PORT}/`
- Add generic `env` JSON column on tasks table — arbitrary key-value env vars passed to agent processes
- Build MCP server into Agemon backend (Streamable HTTP transport) so agents can request resources
- Port allocation as an MCP tool — agents/users request N ports on demand, Agemon tracks and assigns from available range
- `PREVIEW_HOST` env var (e.g. `myvm.exe.xyz`) used to generate preview URLs for allocated ports
- Task env vars automatically injected into agent process environment on spawn
- Frontend: preview URL buttons in task detail view, env var editor for tasks

---

## Notes

### Parallelization Strategy

The 8-week development timeline can be optimized by running tasks in parallel across **4 independent tracks**:

#### **Track A: Backend Core (Sequential - Critical Path)**
```
Week 1-2: Foundation
├─ 1.1 Project Init (4h) ──┐
├─ 1.2 Database (6h)       │ Must be sequential
├─ 1.3 REST API (8h)       │ Each depends on previous
└─ 1.4 WebSocket (6h) ─────┘

Week 4-5: ACP Integration
├─ 4.1 ACP Client (10h)
├─ 4.2 Auto-Resume (3h)
├─ 4.3 Event Parser (10h)
└─ 4.4 Awaiting Input (10h)

Week 7: Build & Distribution
├─ 7.1 Production Build (8h)
├─ 7.2 Single Binary (10h)
└─ 7.3 Install Scripts (6h)
```

#### **Track B: Frontend (Parallel after 1.1)**
```
Week 2-3: UI Foundation
├─ 2.1 shadcn/ui Setup (8h)     ◄── Can start after 1.1
├─ 2.2 Kanban Board (10h)       ◄── Needs 1.4 for WebSocket
├─ 2.3 Add Task Flow (8h)       ┐
└─ 2.4 Task Detail (8h)         ┴── Can run in parallel

Week 5-6: Terminal
├─ 5.1 PTY Manager (12h)
├─ 5.2 xterm Component (10h)
└─ 5.3 Mobile Terminal (6h)
```

#### **Track C: Git Integration (Independent)**
```
Week 3-4: Git Operations
├─ 3.1 Git Worktree Manager (12h)  ◄── Can start after 1.2
├─ 3.2 GitHub Integration (8h)
└─ 3.3 One-Tap PR Flow (6h)

Week 6: Diff Management
├─ 6.1 Diff Generation (6h)
├─ 6.2 Diff Viewer (12h)
└─ 6.3 Approve/Reject (6h)
```

#### **Track D: Documentation & Website (Continuous)**
```
Week 1-8: Documentation
├─ 8.3 User Docs (10h)          ◄── Start early, continuous
│
Week 6-7: Website
├─ 8.6 Astro Website (12h)      ◄── Parallel with 7.1-7.3
│
Week 7-8: Launch Prep
├─ 8.1 Tailscale Guide (6h)     ┐
├─ 8.2 exe.dev Deployment (6h)  ├── All parallel
├─ 8.4 Mobile UX Polish (8h)    │
└─ 8.5 Launch Materials (8h)    ┘
```

### Optimal Parallel Execution Schedule

**Week 1:**
- Track A: 1.1 → 1.2 (start of critical path)
- Track B: 2.1 can start after 1.1 completes

**Week 2:**
- Track A: 1.3 → 1.4
- Track B: 2.1 continues → 2.2 starts after 1.4
- Track D: 8.3 (docs) start

**Week 3:**
- Track B: 2.3 + 2.4 (parallel)
- Track C: 3.1 starts (independent)

**Week 4:**
- Track A: 4.1 starts (critical path)
- Track C: 3.2 → 3.3

**Week 5:**
- Track A: 4.2 (auto-resume) + 4.3 → 4.4
- Track B: 5.1 starts (PTY)

**Week 6:**
- Track B: 5.2 → 5.3
- Track C: 6.1 → 6.2 → 6.3
- Track D: 8.6 (Astro) can start

**Week 7:**
- Track A: 7.1 → 7.2 → 7.3 (critical)
- Track D: 8.1 + 8.2 + 8.6 (all parallel)

**Week 8:**
- Track D: 8.4 + 8.5 (launch prep)

### Critical Path

**Total Critical Path Duration:** ~6 weeks
```
1.1 (4h) → 1.2 (6h) → 1.3 (8h) → 1.4 (6h) →
4.1 (10h) → 4.3 (10h) → 4.4 (10h) →
7.1 (8h) → 7.2 (10h) → 7.3 (6h) → 8.5 (8h)
```

Any delay in Track A tasks will delay the entire project. Tracks B, C, and D provide flexibility.

### Risk Mitigation Plan

**High-Risk Tasks:**

1. **Task 7.2: Single Binary Packaging** (Week 7)
   - **Risk:** Bun's standalone executable feature is newer, may have issues with native modules
   - **Mitigation:**
     - Test Bun binary packaging in Week 1 with hello-world
     - Prepare Docker fallback for Week 8
     - Have traditional Node.js binary packaging as backup

2. **Task 4.1: ACP Integration** (Week 4)
   - **Risk:** External protocol dependency, limited agent support
   - **Mitigation:**
     - Validate ACP SDK compatibility in Week 1
     - Test with Claude Code early in Week 4
     - Have manual agent wrapper fallback

3. **Task 5.1: PTY Session Management** (Week 5)
   - **Risk:** node-pty native module may not bundle correctly
   - **Mitigation:**
     - Test node-pty in production build early (Week 5)
     - Have containerized deployment as fallback
     - Consider WebSocket-only terminal as v1.1 feature if blocked

4. **Task 8.4: Mobile PWA Features** (Week 8)
   - **Risk:** iOS has strict PWA limitations, push notifications may not work
   - **Mitigation:**
     - Document iOS limitations clearly
     - Use in-app polling as primary mechanism
     - Push notifications are "nice to have" for v1

### Dependencies Matrix

| Task | Depends On | Can Run In Parallel With |
|------|------------|--------------------------|
| 1.1  | None       | Nothing (start point) |
| 1.2  | 1.1        | 2.1 |
| 1.3  | 1.2        | 2.1, 3.1 |
| 1.4  | 1.3        | 2.1, 3.1 |
| 2.1  | 1.1        | 1.2, 1.3, 1.4, 3.1 |
| 2.2  | 1.4, 2.1   | 3.1, 3.2 |
| 2.3  | 2.2        | 2.4, 3.2, 3.3 |
| 2.4  | 2.2        | 2.3, 3.2, 3.3 |
| 3.1  | 1.2        | 1.3, 1.4, 2.1, 2.2 |
| 3.2  | 3.1        | 2.3, 2.4, 4.1 |
| 3.3  | 3.2        | 2.3, 2.4, 4.1 |
| 4.1  | 1.5, 3.1   | 3.2, 3.3 |
| 4.2  | 4.1        | 4.3, 5.1 |
| 4.3  | 4.1, 2.4   | 4.2, 5.1 |
| 4.4  | 4.3        | 5.1, 5.2 |
| 5.1  | 1.4        | 4.3, 4.4, 6.1 |
| 5.2  | 5.1        | 6.1, 6.2 |
| 5.3  | 5.2        | 6.2, 6.3 |
| 6.1  | 3.1        | 4.4, 5.1, 5.2 |
| 6.2  | 6.1        | 5.2, 5.3 |
| 6.3  | 6.2        | 5.3 |
| 7.1  | All Phase 1-6 | 8.1, 8.2, 8.6 |
| 7.2  | 7.1        | 8.1, 8.2, 8.6 |
| 7.3  | 7.2        | 8.1, 8.2, 8.6 |
| 8.1  | 7.2        | 7.3, 8.2, 8.6 |
| 8.2  | 7.2        | 7.3, 8.1, 8.6 |
| 8.3  | None (continuous) | Everything |
| 8.4  | 2.x tasks  | 7.x, 8.1, 8.2, 8.6 |
| 8.5  | All tasks  | Nothing (final) |
| 8.6  | 8.3        | 7.1, 7.2, 7.3, 8.1, 8.2 |

### Testing Strategy

**Unit Tests:**
- Each backend module (database, git, pty, acp)
- Frontend components (UI library)
- Run during development, not separate phase

**Integration Tests:**
- After Phase 1: API + Database + WebSocket
- After Phase 4: ACP agent spawning and events
- After Phase 5: PTY sessions
- After Phase 6: End-to-end task workflow

**Mobile Testing:**
- **Required:** Test on real iPhone and Android device
- **When:** After each Phase 2, 5, 6, 8 task
- **What:** Touch targets, gestures, keyboard handling, performance

**End-to-End Testing:**
- Week 7: Full workflow from task creation to PR
- Week 8: Launch rehearsal on actual deployment

---

**Last Updated:** March 2026
**Status:** Core infrastructure, ACP integration, session-centric chat UI with multi-session tabs, unread activity indicators, nav bar, kanban, sessions page, slash command menu, MCP server config, and approval persistence implemented. Token usage tracking (Task 4.19), context window monitoring (Task 4.20), and turn cancellation (Task 4.17) planned. Terminal PTY, diff viewer, and GitHub PR flow remaining.