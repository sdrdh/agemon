# PRD: Project Agemon (The Agent Gateway)

**Version:** 1.0  
**Last Updated:** February 2026  
**Status:** Pre-development

---

## 1. Vision & Core Philosophy

Agemon is a **self-hosted, headless orchestration platform** that bridges autonomous AI agent execution with remote human oversight. Unlike desktop-bound tools, Agemon treats mobile as a first-class citizen, enabling developers to manage AI-assisted work from anywhere.

### Core Principles

1. **Mobile-First:** Every feature must work seamlessly on a phone
2. **Self-Hosted:** User owns data, infrastructure, and agents
3. **Agent-Agnostic:** Works with any ACP-compatible agent
4. **Task-Oriented:** Not just parallel execution, but lifecycle management
5. **Minimal Dependencies:** Single binary, SQLite, no complex infrastructure

### Positioning Statement

> "While Emdash and Conductor excel at parallel agent execution on your desktop, **Agemon is the only mobile-first platform for managing AI coding tasks from anywhere**. Queue work on your phone, monitor during your commute, approve from the coffee shop."

---

## 2. Target Users

### Primary: The Remote Indie Developer
- Manages 2-5 microservices solo
- Works from coffee shops, travels frequently
- Uses AI agents daily (Claude Code, Aider, Gemini CLI)
- Values ownership of tools and data
- Budget: Free or <$10/mo for hosting

### Secondary: The Privacy-First Developer
- Won't use cloud AI orchestrators
- Self-hosts everything (Gitea, Drone CI, Bitwarden)
- Needs AI assistance but wants data control
- Technical enough to deploy via SSH

### Tertiary: The Side Project Juggler
- Full-time job + 3-4 side projects
- Needs to capture ideas on mobile
- Wants async task completion
- Reviews/approves work during commute

---

## 3. Market Context

### Competitive Landscape

| Product | Platform | Key Limitation |
|---------|----------|----------------|
| **Emdash** (YC W26) | Desktop (Win/Mac/Linux) | No mobile interface |
| **Conductor** (Melty Labs) | Mac-only desktop | Requires Apple Silicon, no remote access |
| **Claude Squad** | Terminal CLI | No GUI, no mobile |
| **OpenHands** | Self-hosted K8s/Docker | Enterprise complexity |

### Market Gap

**No existing solution provides:**
- ✅ Mobile-first interface
- ✅ Tailscale-native remote access
- ✅ Lightweight self-hosted web platform
- ✅ Task lifecycle management (vs. just parallel execution)

---

## 4. Execution Model

Agemon manages two execution types within a **Multi-Repo Task Folder**:

### A. Agent Sessions (Interactive)

**Definition:** A live, interactive session where the user is "present"

**Behavior:**
- Pipes a live PTY (Pseudo-Terminal) to the web UI
- Full interactive terminal in browser
- User can type commands, see real-time output
- Session state persists on server

**Persistence:**
- Session remains active even if mobile UI disconnects
- User can resume from any device
- Terminal history preserved across reconnections

### B. ACP Agent Loops (Autonomous)

**Definition:** Goal-oriented agent processes communicating via ACP protocol

**Behavior:**
- Agent works autonomously toward a goal
- Emits "Thought" and "Action" events
- Runs in background without user interaction

**Oversight:**
- User can monitor thought stream
- User intervenes when agent requests input
- Full event log maintained

**State Transitions:**
- Agents auto-transition between states
- Users don't manually move tasks
- User only responds to "Awaiting Input" blockers

---

## 5. User Interface: The Kanban Board

The Kanban board is organized by **System State** to show users exactly where their attention is required.

### Column Definitions

| Column | Description | User Actions |
|--------|-------------|--------------|
| **To-Do** | Defined tasks awaiting initialization | Add task, view details, start agent, delete |
| **Working** | Active agent execution with live thought streams | Monitor only (read-only) |
| **Awaiting Input** | **Critical State** - Agent blocked or diff pending approval | Answer questions, approve/reject diffs, provide guidance |
| **Done** | Completed tasks with optional synthesis summary | View summary, archive, delete |

### Key Interaction Pattern

**Read-only columns:** No drag-drop - agents control state transitions

**Single write operation:** Add new task via "+" button

**Critical action:** Respond to "Awaiting Input" items

**Passive monitoring:** Watch agent thought streams in real-time

---

## 6. Multi-Repo Orchestration

### Task Workspace Structure

Every task creates a root folder containing worktree checkouts of all involved repositories:

```
.agemon/tasks/{task-id}/
├── backend-repo/    # Isolated git worktree
├── frontend-repo/   # Isolated git worktree
└── shared-types/    # Isolated git worktree
```

### Worktree Strategy

**Branch Naming:** `{task-id}-{repo-short}`

**Benefits:**
- Isolated checkouts prevent conflicts
- Multiple tasks work on same repo simultaneously
- Clean separation of work streams

**Execution Context:**
- Agent spawned at task root
- Unified context across all repositories
- No directory switching needed

---

## 7. Key Features

### 7.1 Mobile-First Review Interface

**Diff Viewer:**
- Vertical-optimized for mobile screens
- Syntax-highlighted code changes
- File-by-file navigation
- Unified diff view (narrow screen friendly)
- Quick approve/reject buttons
- Touch-optimized scrolling

**Terminal View (PTY):**
- Live terminal stream in browser
- Interactive input capability
- Auto-scroll to latest output
- Command history search
- Works on mobile and desktop
- Reconnection handling

**Quick Actions:**
- Approve/reject changes
- Provide text input to agent
- Archive completed tasks
- Start/stop agents

**Notifications:**
- Push alerts for "Awaiting Input"
- Task completion notifications
- Agent error alerts

### 7.2 "One-Tap" Integration

Single mobile-friendly action that coordinates:
- Commits changes across all repositories
- Pushes branches to remote origins
- Opens linked GitHub PRs
- Moves task to "Done" status

**User Flow:**
1. Agent completes work
2. User reviews diff on mobile
3. Taps "Approve & Create PRs"
4. All repos committed, pushed, PRs created
5. Task automatically marked done

### 7.3 Event Logging & Audit Trail

**Logged Events:**
- Agent "Thought" events (reasoning)
- Terminal commands executed
- User responses to questions
- Diff approvals/rejections
- Git operations (commit, push, PR)

**Benefits:**
- Session recovery after disconnect
- Full audit trail
- Debug agent behavior
- Generate summaries

### 7.4 Task Synthesis (Optional)

**On Completion:**
- AI-generated summary of work
- Technical digest of changes
- Links to created PRs

**Rollup Reports:**
- Daily summary of tasks
- Weekly productivity report
- Shareable digests

---

## 8. Technical Stack

### Runtime & Backend

**Runtime:** Bun 1.1+
- 3x faster startup than Node.js
- Built-in TypeScript
- Native SQLite support

**Backend Framework:** Fastify 4.x
- Fast, low overhead
- Rich plugin ecosystem
- WebSocket support

**Key Libraries:**
- Database: `better-sqlite3` (synchronous, fast)
- WebSocket: `@fastify/websocket`
- Terminal: `node-pty` (PTY emulation)
- Git: `simple-git` (worktree management)
- ACP: `@agentclientprotocol/sdk`

### Frontend

**Build Tool:** Vite 5.x

**Framework:** React 18

**Key Libraries:**
- Router: `@tanstack/react-router`
- State: `@tanstack/react-query` + `Zustand`
- Terminal: `@xterm/xterm` + addons
- Styling: Tailwind CSS
- UI Components: Headless UI + custom

**Bundle Strategy:**
- Code-split by route
- Lazy-load terminal (~800KB)
- Progressive loading

### Database

**Engine:** SQLite via `better-sqlite3`

**Key Tables:**
- Tasks (status, repos, config)
- ACP Events (thought stream)
- Awaiting Input (blocked questions)
- Diffs (pending reviews)
- Terminal Sessions (PTY state)

### Distribution

**Format:** Single binary (~100MB)

**Platforms:** Linux x64, macOS (Intel + ARM), Windows

---

## 9. API & Protocol Design

### REST API Endpoints

**Task Management:**
- List, create, update, delete tasks
- Get task details and event stream
- Start/stop agent execution

**Diff Management:**
- Get pending diff
- Approve or reject changes
- Provide feedback

**Input Handling:**
- Send responses to blocking questions
- Send terminal input to PTY

### WebSocket Events

**Server → Client:**
- Task status updates
- Agent thought events
- Awaiting input requests
- Terminal output streams

**Client → Server:**
- Input responses
- Terminal keyboard input
- Start/stop commands

### ACP Integration

**Supported Events:**
- `thought` - Agent reasoning
- `action` - Commands executed
- `await_input` - Blocking questions
- `result` - Operation outcomes

---

## 10. Security Model

### Authentication
- Static token via environment variable (`AGEMON_KEY`)
- HTTP Bearer authentication
- Single-user in v1

### Network Security
- **Tailscale:** End-to-end encrypted tunnel
- **exe.dev:** Automatic HTTPS proxy
- **VPS:** Caddy auto-HTTPS with Let's Encrypt

### Git Operations
- GitHub Personal Access Token
- Minimal scopes (repo read/write)
- Never stored in database

### Agent Isolation
- Subprocess execution
- Limited to task workspace
- No direct database access
- ACP-only communication

---

## 11. Deployment Options

### Local Development
- Clone repository
- Install dependencies with Bun
- Run dev server
- Access at localhost:3000

### Tailscale (Recommended)
- Deploy on any Linux machine
- Enable Tailscale HTTPS
- Access via `https://agemon.{tailnet}.ts.net`
- Automatic Let's Encrypt certificates

### exe.dev (Easiest)
- SSH to exe.dev VM
- Install with one command
- Access via `https://{vm}.exe.xyz`
- Automatic HTTPS
- ~$5/mo

### VPS (Traditional)
- Deploy to Ubuntu server
- Use Caddy for HTTPS
- Custom domain support
- $5-10/mo

---

## 12. User Journey: Mobile-First Workflow

### Scenario: Developer on Train

**Morning Commute:**
1. Opens Agemon on phone
2. Taps "+" to add task: "Add authentication to backend + frontend"
3. Selects repositories and agent (Claude Code)
4. Task enters "To-Do" column

**At Office:**
5. Opens Agemon on laptop
6. Clicks task → "Start Agent"
7. Agent moves to "Working"
8. Watches thought stream: "Planning JWT middleware..."
9. Closes laptop, agent continues running

**Lunch Break:**
10. Checks phone - task still in "Working"
11. Scrolls thought stream
12. Continues with day

**Afternoon:**
13. Push notification: "Task blocked"
14. Opens phone - task in "Awaiting Input"
15. Sees question: "Which auth library?"
16. Selects "Passport.js"
17. Agent resumes to "Working"

**Evening Commute:**
18. Notification: "Changes ready for review"
19. Opens mobile diff viewer
20. Reviews changes across both repos
21. Looks good → Taps "Approve & Create PRs"
22. Task moves to "Done"
23. PRs automatically created and linked

**Weekend:**
24. Reviews completion summary
25. Reads synthesis: "Added JWT authentication with Passport.js"
26. Archives task

---

## 13. Success Metrics

### v1 Launch Goals
- 100-500 GitHub stars in first month
- 50+ active self-hosted installations
- Featured on Hacker News front page
- Positive reception in ACP community

### User Validation
- Can add task from mobile in <30 seconds
- Agent successfully completes multi-repo task
- User approves diff from phone
- PRs created without desktop interaction
- Full workflow works on flaky mobile connection

### Technical Validation
- Single binary under 150MB
- Mobile UI loads in <2 seconds on 4G
- Terminal connects in <500ms on Tailscale
- WebSocket reconnection works seamlessly
- Works on iOS Safari and Chrome mobile

---

## 14. Future Roadmap (Post-v1)

### v1.1 - Enhanced Terminal
- Bidirectional PTY input
- Terminal themes and customization
- Copy/paste improvements
- Search in terminal history

### v1.2 - Collaboration
- Share task progress via read-only link
- Team workspace support
- Role-based access (admin, reviewer, viewer)

### v1.3 - Advanced Features
- Multiple agents per task
- Agent comparison mode
- Custom agent templates
- Workflow automation rules

### v2.0 - Platform Expansion
- Desktop app (Tauri wrapper)
- Browser extension (quick task creation)
- CI/CD integration
- Webhook support

---

## 15. Open Questions

1. **Notification Strategy:** Web Push API or in-app only?
2. **Multi-Agent Support:** Single agent per task in v1, or multiple?
3. **Synthesis Service:** Build in v1 or wait for user demand?
4. **Analytics:** Track anonymous usage or fully privacy-first?
5. **Agent Configuration:** Store as JSON in tasks table or separate table?

---

## 16. Non-Goals (v1)

**Explicitly out of scope:**
- ❌ Multi-user/team features
- ❌ Cloud-hosted SaaS version
- ❌ Custom AI model training
- ❌ Advanced CI/CD pipelines
- ❌ Code review collaboration features
- ❌ Integration with project management tools (Linear, Jira)
- ❌ Desktop native application

**Rationale:** Focus on core self-hosted, single-user, mobile-first experience first. Validate product-market fit before expanding scope.