## Phase 4.5: Session-Centric UX (Completed)

**Goal:** Make sessions first-class entities with individual chat tabs and per-session state

### Task 4.5: Session-Centric Task Detail ✅

### Task 4.6: Unread Session Activity Indicators ✅

### Task 4.7: Session Sidebar, Naming, Markdown & UX Polish ✅

### Task 4.8: Component Splitting (Future) ✅

### Task 4.9: Native Chat App Bottom Navigation (Future) ✅

### Task 4.10: Activity-Specific Icons in Chat (Future) ✅

### Task 4.11: Multi-Theme System & Settings Page ✅

### Task 4.12: Rich Tool Call Details in Chat ✅

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
- **ProjectGroup-level skills:** Add a `skills/` directory or skill config to ProjectGroups. When a task belongs to a ProjectGroup, its skills get symlinked into the task folder alongside repo skills (Task 3.5.3). This gives users a place to define shared skills that apply across all tasks in a project group (e.g., coding standards, review checklists)

**Dependencies:** Task 1.3 (DB schema), Task 2.1 (REST routes)

---

### Task 4.15: Settings Page Restructure & Agent Configuration

**Priority:** P1
**Status:** Todo

> Design doc: `docs/plans/2026-03-04-agent-auth-settings-design.md`

**Deliverables:**
- [ ] Restructure settings into sections: Appearance, Agents, Updates, About
- [ ] Move existing theme/color mode UI under Settings → Appearance
- [ ] `GET /api/agents/status` — auto-detect installed binaries (`Bun.which()`), run read-only login/readiness checks, and return per-agent status
- [ ] Frontend: Settings → Agents section with agent list cards showing detection badge, auth status badge, and setup instructions
- [ ] Setup instructions per agent: terminal commands to install and authenticate (e.g. "Run `claude /login` in your terminal", "Set `ANTHROPIC_API_KEY` in your shell/env"), with note to restart/update Agemon after
- [ ] Default agent/model/mode preferences stored in an Agemon-owned flat file under `~/.agemon/`, applied to new sessions
- [ ] Frontend: Default agent dropdown + default model/mode selectors in Settings → Agents
- [ ] Session creation inherits global defaults, user can override per-session
- [ ] Settings → Updates section placeholder (wired up in Task 7.6)
- [ ] Settings → About section with version info and links

**Key Considerations:**
- No proxy login flows or API key inputs in UI — users configure agents in their terminal, then restart Agemon to pick up changes
- Task 7.6 (self-update) handles restart to detect newly installed/authenticated agents
- Global defaults (default agent, model, mode) should live in a small Agemon-owned settings file, not `.env` and not SQLite
- Auth detection is read-only: just check if the agent is usable, don't try to fix it from the UI
- Installed/login status is derived live from the machine state and should not be cached as source-of-truth config
- Mobile-first: full-width cards, 44px touch targets

**Dependencies:** Task 1.3 (REST routes), Task 4.11 (existing settings page)

---

### Task 4.16: Dynamic Slash Command Menu in Chat ✅

### Task 4.17: Cancel Agent Turn (Escape Key Equivalent) ✅

### Task 4.18: Fix Tool Call Approval Dialog Persistence ✅

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

### Task 4.20: Context Window Utilization Monitor ✅

**Priority:** P1  
**Status:** Done (with minor bugs)

**Deliverables:**
- [x] Derive context window fill percentage from token usage data (used tokens / max context window)
- [x] Display a context window % progress bar prominently in the session chat header
- [x] Show a warning indicator when context usage exceeds a threshold (e.g., 80%)
- [x] Show context % per session tab so users can see utilization for each active session

**Key Considerations:**
- Context window max varies by agent/model — may need a configurable default or agent-reported value
- This is the primary usage metric users care about — more prominent than raw token counts
- If the ACP `usage_update` doesn't include max context size, use known defaults per agent type (e.g., claude-code = 200k)
- Progress bar should use color coding: green → yellow → red as context fills up
- Depends on Task 4.19 for the underlying token data pipeline

**Affected Areas:** frontend (session chat header, session tabs), backend (context % calculation), shared (types)

**Dependencies:** Task 4.19 (token usage data pipeline)

---

### Task 4.21: MCP Server Configuration for Agent Sessions ✅

### Task 4.22: Markdown Rendering for Task Descriptions ✅

### Task 4.23: Back Gesture Navigation from Session to Session List ✅

### Task 4.24: Archive Tasks and Sessions ✅

### Task 4.25: Allow Resuming Interrupted Sessions ✅

### Task 4.26: Multi-Modal Content Support (Images)

**Priority:** P1
**Estimated Time:** 1.5 days

**Deliverables:**
- [ ] File-based media storage (`{DB_DIR}/media/{hash}.{ext}`) with deduplication by content hash
- [ ] REST endpoints for uploading and serving media files (`POST /media`, `GET /media/:id`)
- [ ] Extend `acp_events.content` to support structured content blocks (text + image references) via JSON
- [ ] Parse image content blocks from ACP agent output (e.g. base64 screenshots) and persist to file storage
- [ ] Render inline images in chat bubbles for agent messages
- [ ] Image attachment UI in chat input — allow users to attach images when sending messages or responding to input requests
- [ ] Send user-attached images to agent via ACP protocol
- [ ] Cleanup mechanism — purge orphaned media files not referenced by any event (e.g. on task/session archive or delete, or via scheduled sweep)
- [ ] Mobile-friendly image viewing (tap to expand, pinch-to-zoom)

**Key Considerations:**
- `acp_events.content` is currently plain text; needs a backwards-compatible migration to support JSON content blocks alongside legacy text
- Agent screenshots arrive as base64 — extract, hash, write to disk, replace with file reference before storing event
- Cleanup should be safe: only delete files with zero references across all tables
- Max file size limit to prevent abuse (e.g. 10MB per image)
- Consider lazy-loading images in long chat histories for performance

**Affected Areas:** backend (storage, routes, ACP parser, DB migration), frontend (chat bubble, input composer, image viewer), shared (types for content blocks)

**Dependencies:** Task 4.5 (Session-Centric Task Detail)

---

### Task 4.27: Copy Chat Message Content ✅

**Priority:** P2
**Estimated Time:** 2 hours

**Deliverables:**

**Key Considerations:**
- Copy the raw markdown/text content, not the rendered HTML — users want pasteable text
- Approval cards and system status messages may not need copy (or could be excluded)
- Use the Clipboard API (`navigator.clipboard.writeText`) — well-supported on modern mobile browsers
- Keep the copy affordance subtle so it doesn't clutter the chat UI (small icon on hover/tap, or context menu)

**Affected Areas:** frontend (chat bubble component)

**Dependencies:** None

---

### Task 4.28: Speech-to-Text Input (Web Speech API)

**Priority:** P2
**Estimated Time:** 4 hours

**Deliverables:**
- [ ] Add mic button to session chat input (`session-chat-panel.tsx`) for voice dictation
- [ ] Add mic button to task creation description field (`tasks.new.tsx`)
- [ ] Use Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) — zero external API cost
- [ ] Feature-detect API availability; hide mic button on unsupported browsers (Firefox)
- [ ] Show visual recording indicator (pulsing icon or border) while listening
- [ ] Append transcribed text to existing input content (don't replace)
- [ ] Handle microphone permission denial gracefully with user-facing message

**Key Considerations:**
- Uses native OS speech engines: Google STT on Android Chrome, Apple Siri on iOS Safari — no API keys or costs
- Requires HTTPS (already needed for deployed web app)
- Both input areas already have 44px touch targets; mic button should match
- `interimResults` mode gives real-time feedback as user speaks
- Mobile-first: tap-to-start / tap-to-stop is more natural than hold-to-talk on phone

**Affected Areas:** frontend (new shared hook or util, two component updates)

**Dependencies:** None

---

### Task 4.29: Auto-Resize Chat Input Textarea ✅

### Task 4.30: Persist Slash Commands Across Page Refresh ✅

### Task 4.31: Database Cleanup for Archived Sessions

**Priority:** P2
**Estimated Time:** 1 day

**Deliverables:**
- [ ] Background cleanup job that runs on startup and periodically (e.g. daily)
- [ ] Purge `acp_events` for archived sessions older than a configurable retention period (default 7 days)
- [ ] Purge resolved `pending_approvals` and answered `awaiting_input` for archived sessions past retention
- [ ] Keep task and session metadata records (small, useful for history browsing)
- [ ] Run SQLite VACUUM after bulk deletes to reclaim disk space
- [ ] Expose retention settings (days) via env var or settings API
- [ ] Optional: show DB size in settings page for visibility

**Key Considerations:**
- `acp_events` is the dominant growth table — hundreds of large records per session
- Session/task records themselves are tiny and worth keeping indefinitely for history
- `ON DELETE CASCADE` already handles full task deletion — this is about partial cleanup (keep metadata, purge event detail)
- SQLite doesn't reclaim space without explicit VACUUM — must run after bulk deletes
- VACUUM rewrites the entire DB file — should run during low-activity periods, not mid-session
- Consider WAL mode implications: VACUUM requires exclusive lock, may briefly block writes
- Future enhancement: summarize events before deleting (store a session recap on the session record)

**Affected Areas:** backend (new cleanup module, db helpers for bulk event deletion, startup hook)

**Dependencies:** Task 4.24 (archive infrastructure)

---

### Task 4.33: Tool Call UI — Rich Per-Tool Cards

**Priority:** P2
**Design Doc:** [`docs/plans/2026-03-12-tool-call-ui-design.md`](docs/plans/2026-03-12-tool-call-ui-design.md)

**Deliverables:**
- [x] Add `ToolCallDisplay`, `startedAt`, `output`, `error`, `display`, `completedAt` to shared types
- [x] Backend: pluggable `parseToolDisplay` per agent (Claude Code extracts `_meta.claudeCode.toolResponse`; generic for others)
- [x] Backend: emit structured tool call events with output/display/timing from ACP notifications
- [x] Frontend: add `toolCalls: Record<string, ToolCall[]>` to Zustand store with `upsertToolCall`/`clearToolCalls`
- [x] Frontend: populate toolCalls store from WS events in `ws-provider.tsx`
- [x] Frontend: hybrid grouping — 1-3 tool calls as individual `ToolCallItem`; 4+ as `ActivityGroupItem`
- [x] Frontend: specialized tool card components — `BashToolCard`, `FileToolCard` (with unified diff), `SearchToolCard`, `GenericToolCard`
- [x] Frontend: `ToolStatusIcon` — tool-specific icons (Terminal, FileText, PenLine, etc.) colored by status
- [x] Frontend: `InlineDiff` — LCS-based unified diff view with line numbers and +/- markers
- [x] Frontend: page reload rehydration via `rehydrateToolCalls` from persisted chat history
- [x] Mobile: tap to expand/collapse, min 44px touch targets

**Affected Areas:** `shared/types/`, `backend/src/lib/agents.ts`, `backend/src/lib/acp/notifications.ts`, `frontend/src/lib/store.ts`, `frontend/src/lib/chat-utils.ts`, `frontend/src/lib/tool-call-helpers.ts` (new), `frontend/src/components/custom/tool-cards/` (new), `ws-provider.tsx`, `chat-messages-area.tsx`, `activity-group.tsx`, `use-session-chat.ts`

**Dependencies:** Task 4.x (ACP integration)

---

### Task 4.32: Offline Behaviour & WebSocket Event Sequencing ✅

**Priority:** P1
**Design Doc:** [`docs/plans/2026-03-12-offline-behaviour-design.md`](docs/plans/2026-03-12-offline-behaviour-design.md)

**Deliverables:**
- [x] Add `seq: number` + `epoch: string` to `ServerEvent` in `shared/types/index.ts`; add `resume` to `ClientEvent`; add `full_sync_required` to `ServerEvent`
- [x] Backend: global atomic seq counter + ring buffer (500 events) + epoch in `app.ts`
- [x] Backend: handle `resume` client event — replay ring buffer events where `seq > lastSeq` to that client only
- [x] Backend: detect buffer overflow → send `full_sync_required`; detect server restart via epoch
- [x] Frontend: track `lastSeq` + `knownEpoch` in Zustand store, updated on every received event
- [x] Frontend: send `{ type: 'resume', lastSeq }` after WS reconnect (in `ws.ts`)
- [x] Frontend: disable send button + textarea + cancel button when `!connected`
- [x] Frontend: disable approve/reject/always buttons in `approval-card.tsx` when `!connected`
- [x] Drafted text preserved in input on disconnect (not cleared until successful send)
- [x] Epoch mismatch and full_sync_required trigger full REST refetch via queryClient.invalidateQueries()

**Key Considerations:**
- Global seq (not per-task/session) is sufficient — simpler and matches Shelley/OpenClaw pattern
- Ring buffer is in-memory only; page reload falls back to existing REST refetch
- Deduplication on replay uses existing `msg.id` dedup logic in `ws-provider.tsx`
- Do not queue messages for later send — block is safer and avoids ordering issues

**Affected Areas:** `shared/types/`, `backend/src/server.ts`, `frontend/src/lib/store.ts`, `frontend/src/lib/ws.ts`, `session-chat-panel.tsx`, `approval-card.tsx`

**Dependencies:** Task 1.3 (WebSocket infrastructure)

---
