# Agemon Development Tasks

**Project:** Agemon - Mobile-First AI Agent Orchestration Platform  
**Timeline:** 8 weeks to MVP  
**Last Updated:** February 2026

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
- [ ] Initialize Bun project with TypeScript
- [ ] Setup monorepo structure (backend, frontend, shared)
- [ ] Configure Vite for React frontend
- [ ] Setup Fastify backend with TypeScript
- [ ] Create `.env.example` with required variables
- [ ] Write `README.md` with quick start instructions
- [ ] Setup `.gitignore` for node_modules, dist, .env

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
- [ ] Install `better-sqlite3` dependency
- [ ] Create `schema.sql` with all tables
- [ ] Write database client wrapper (`db/client.ts`)
- [ ] Write migration system (version tracking)
- [ ] Create seed script with sample data
- [ ] Write database query helpers

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

### Task 1.3: REST API Foundation

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Setup Fastify with TypeScript
- [ ] Configure CORS for frontend
- [ ] Implement authentication middleware (AGEMON_KEY)
- [ ] Create error handling middleware
- [ ] Setup request logging
- [ ] Create API route structure

**API Routes to Implement:**
```
GET    /api/health          - Health check
GET    /api/tasks           - List all tasks
POST   /api/tasks           - Create new task
GET    /api/tasks/:id       - Get task details
PATCH  /api/tasks/:id       - Update task
DELETE /api/tasks/:id       - Delete task
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
- [ ] Install `@fastify/websocket`
- [ ] Setup WebSocket server
- [ ] Implement connection handling
- [ ] Create broadcast helper function
- [ ] Define event types (TypeScript)
- [ ] Test multi-client broadcasting

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

## Phase 2: Frontend Foundation (Week 2-3)

**Goal:** Mobile-optimized Kanban board with real-time updates

### Task 2.1: UI Component Library

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Install Tailwind CSS and configure
- [ ] Install Headless UI for accessible components
- [ ] Create base component library
- [ ] Setup component documentation/storybook (optional)
- [ ] Create mobile-responsive layout utilities

**Components to Create:**
- `Button` - Primary, secondary, danger variants
- `Card` - Container for tasks
- `Badge` - Status indicators
- `Modal` - Forms and confirmations
- `Spinner` - Loading states
- `Input` - Form inputs
- `Select` - Dropdowns

**Acceptance Criteria:**
- All components work on mobile (tested on actual device)
- Touch targets minimum 44x44px
- Dark mode support (optional but nice)
- Components are accessible (keyboard navigation)
- Consistent spacing and typography
- TypeScript props properly typed

**Dependencies:** Task 1.1

**Parallelizable:** Can work alongside backend tasks

---

### Task 2.2: Kanban Board View

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Create `Kanban` component
- [ ] Create `Column` component (To-Do, Working, Awaiting Input, Done)
- [ ] Create `TaskCard` component
- [ ] Implement task filtering by status
- [ ] Setup WebSocket for real-time updates
- [ ] Add empty state messaging
- [ ] Mobile responsive layout

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
- [ ] Create "Add Task" button (floating on mobile)
- [ ] Create task creation modal
- [ ] Implement form with validation
- [ ] Multi-select for repositories
- [ ] Agent selection dropdown
- [ ] Submit and update Kanban

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
- [ ] Create task detail route (`/task/:id`)
- [ ] Display task metadata (title, repos, status)
- [ ] Show ACP event stream (thought history)
- [ ] Add "Start Agent" button (for To-Do tasks)
- [ ] Add "Stop Agent" button (for Working tasks)
- [ ] Mobile-optimized layout

**Features:**
- Swipe-back gesture on mobile
- Fixed header with task title
- Scrollable event stream
- Auto-scroll to latest event
- Timestamp for each event

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
- [ ] Install `simple-git` dependency
- [ ] Create `GitWorktreeManager` class
- [ ] Implement worktree creation
- [ ] Implement worktree deletion
- [ ] Branch naming convention logic
- [ ] Path resolution utilities

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

## Phase 4: ACP Integration (Week 4-5)

**Goal:** Spawn agents, parse events, handle "Awaiting Input" state

### Task 4.1: ACP Client Setup

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Install `@agentclientprotocol/sdk`
- [ ] Create `ACPAgentManager` class
- [ ] Implement agent spawning
- [ ] Handle session initialization
- [ ] Send prompts to agent
- [ ] Store agent PIDs for lifecycle management

**Agent Support:**
- Claude Code (via `claude-code-acp`)
- Aider (via wrapper/adapter)
- Gemini CLI

**Functions:**
```typescript
class ACPAgentManager {
  spawnAgent(taskId: string, agent: string, goal: string): Promise<string>
  sendPrompt(sessionId: string, prompt: string): Promise<void>
  stopAgent(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): Promise<'active' | 'stopped'>
}
```

**Acceptance Criteria:**
- Agent process spawns successfully
- ACP handshake completes
- Session ID tracked in database
- Agent responds to prompts
- Clean shutdown on stop command
- Error handling for agent crashes

**Dependencies:** Task 1.2, Task 3.1

---

### Task 4.2: ACP Event Stream Parser

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Parse ACP JSON-RPC events from agent stdout
- [ ] Store events in `acp_events` table
- [ ] Broadcast events via WebSocket
- [ ] Render thought stream in UI
- [ ] Handle different event types

**Event Types to Handle:**
- `thought` - Agent reasoning
- `action` - Commands executed
- `await_input` - Blocking questions
- `result` - Operation results

**Acceptance Criteria:**
- All event types parsed correctly
- Events stored with proper timestamps
- Events broadcast to connected clients
- UI displays thought stream in real-time
- Handles malformed events gracefully
- Performance: Can handle 100+ events/minute

**Dependencies:** Task 4.1, Task 2.4

---

### Task 4.3: "Awaiting Input" Handler

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Detect `await_input` events
- [ ] Move task to "awaiting_input" status
- [ ] Store question in database
- [ ] Render input form in UI (mobile-optimized)
- [ ] Send user response back to agent
- [ ] Resume agent execution

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

**Dependencies:** Task 4.2

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
- [ ] Quick start guide
- [ ] Architecture overview
- [ ] API reference
- [ ] Deployment guides (all options)
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

---

## Notes

**Parallelization Opportunities:**
- Phase 2 (Frontend) can start while Phase 1 (Backend) is in progress
- Task 2.1 (UI Components) is independent and can be done early
- Documentation (Task 8.3) can be written throughout development

**Critical Path:**
Phase 1 → Phase 4 (ACP) → Phase 5 (PTY) → Phase 7 (Build)

**High-Risk Tasks:**
- Task 5.1: PTY session management (complex, potential security issues)
- Task 7.2: Single binary packaging (Bun tooling may be immature)
- Task 4.1: ACP integration (depends on external SDK)

**Testing Strategy:**
- Each task should include unit tests where applicable
- Integration tests after each phase
- Mobile testing on real devices required
- End-to-end test before launch

---

**Last Updated:** February 2026  
**Status:** Ready for development