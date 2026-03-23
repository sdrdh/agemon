# Archived Tasks

Completed phases archived from TASKS.md for context efficiency.
All items below were fully implemented.

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



---

## Phase 2: Frontend Foundation (Week 2-3)

**Goal:** Mobile-optimized Kanban board with real-time updates

### Task 2.1: shadcn/ui Component Library Setup

**Priority:** P0
**Status:** Done
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
- [x] Re-spawn each with `--resume <external_session_id>` (if `external_session_id` is set)
- [x] Insert new `agent_sessions` row for each re-spawned process (linking same task)
- [x] Broadcast `session_state_changed` for interrupted sessions (via frontend WS reconnect + query invalidation)
- [x] Broadcast `session_started` for re-spawned sessions

**Acceptance Criteria:**
- Server restart recovers in-progress sessions automatically
- Sessions without `external_session_id` are marked `interrupted` but not re-spawned
- New session rows are created (old rows preserved as history)
- Task status remains correct after recovery

**Dependencies:** Task 4.1

---

### Task 4.3: ACP Event Stream Parser

**Priority:** P0
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



---
