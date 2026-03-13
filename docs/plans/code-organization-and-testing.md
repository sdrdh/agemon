# Plan: Code Organization & Testing

**Status:** Code splitting complete, initial tests in place (March 13, 2026)
**Original:** March 2026

## Context

Agemon had god files and zero automated tests. This plan restructured code and added tests, organized by package so each package can be worked on independently.

**Completion status (March 13):**
- ✅ **1A** — `createApp()` factory extracted from `server.ts`
- ✅ **1B** — `db/client.ts` split into 10 domain modules
- ✅ **1C** — `lib/acp.ts` (1,214 lines) split into 12 modules in `lib/acp/`
- ✅ **1D** — `routes/tasks.ts` (408 lines) split into `shared/sessions/approvals`
- ✅ **1E** — 23 backend tests (slugify 8, jsonrpc 6, context 9) — all passing
- ✅ **2A** — Extracted 3 hooks from `tasks.$id.tsx`
- ✅ **2B** — Split `session-chat-panel.tsx` into 5 sub-components
- ✅ **2C** — Split `mcp-server-list.tsx` into 3 components
- ✅ **2D** — Vitest infrastructure + 18 store tests — all passing
- 🔲 **3A** — Root test script + CI (not yet started)
- 🔲 **Remaining tests** — ~120 more tests planned (DB ~60, routes ~46, acp ~24)

**Current test count:** 41/~160 planned. Smoke tests: 31/31 passing.

Each task below contains both its splitting plan and its testing plan.

---

## Package 1: Backend

### 1A — Extract `createApp()` factory from `server.ts`

**Split:** Move app creation out of `server.ts` (309 lines) into `backend/src/app.ts`.

- `createApp(opts: { key: string })` — creates Hono app, registers middleware (CORS, auth, logging, error handler), mounts all routes, WebSocket handler, MCP endpoint. Exports `broadcast()`. Returns `{ app, broadcast, eventBus, wsClients }`.
- `server.ts` slims to ~60 lines: env vars, `mkdir` agemon dirs, global plugin/skill symlinking, `runMigrations()`, `createApp()`, `Bun.serve()`, crash recovery, signal handlers.
- Update imports in `lib/acp.ts`, `lib/context.ts`, and `routes/tasks.ts` — import `broadcast` from `app.ts` instead of `server.ts`.

**Test:** Create `backend/src/test-helpers/app.ts` — `setupTestApp()` calls `createApp({ key: 'test-key' })` with in-memory DB. Enables all in-process route testing via `app.request()`.

**Dependencies:** None (foundational task)

---

### 1B — Split `db/client.ts` (1,055 lines, 49 facade methods)

**Split:**
```
backend/src/db/
  client.ts          # getDb(), resetDb(), generateTaskId(), facade re-export (~100 lines)
  migrations.ts      # SCHEMA_VERSION, runMigrations() (~210 lines)
  helpers.ts         # parseTask, parseSession, mapApproval, mapMcpServer, parseRepoName, constant sets (~90 lines)
  tasks.ts           # listTasks, getTask, createTask, updateTask, deleteTask, listTasksByProject (6 methods)
  sessions.ts        # getSession, listSessions, listSessionsByState, insertSession, updateSessionState,
                     # updateSessionName, updateSessionArchived, updateSessionUsage,
                     # updateSessionConfigOptions, updateSessionAvailableCommands,
                     # getSessionConfigOptions, getSessionAvailableCommands (12 methods)
  events.ts          # listEvents, insertEvent, listChatHistory, listChatHistoryBySession (4 methods)
  inputs.ts          # listPendingInputs, insertAwaitingInput, answerInput (3 methods)
  diffs.ts           # getDiff, getPendingDiff, insertDiff, updateDiffStatus (4 methods)
  approvals.ts       # insertPendingApproval, resolvePendingApproval, getPendingApproval,
                     # listPendingApprovals, listPendingApprovalsBySession, listAllApprovals,
                     # insertApprovalRule, findApprovalRule (8 methods)
  repos.ts           # listRepos, upsertRepo, getTaskRepos, setTaskRepos, _buildRepoMap (5 methods)
  mcp-servers.ts     # addMcpServer, removeMcpServer, getMcpServer, listGlobalMcpServers,
                     # listTaskMcpServers, getMergedMcpServers (6 methods)
```

Each domain file exports functions that call `getDb()` internally. `client.ts` re-composes the `db` facade — external API unchanged. Add `resetDb()` export (sets `_db = null`).

**Test:** Create `backend/src/test-helpers/db.ts` — `setupTestDb()` sets `DB_PATH=:memory:`, calls `resetDb()` + `runMigrations()`.

Create `backend/src/db/client.test.ts` (~60 tests):

| Domain | Tests | Key assertions |
|--------|-------|----------------|
| Tasks | ~15 | CRUD round-trip, repo association, archive filtering, generateTaskId collisions, listTasksByProject grouping |
| Repos | ~5 | Upsert idempotency, setTaskRepos replacement, _buildRepoMap batch |
| Sessions | ~12 | State transitions, ended_at auto-set, config JSON round-trip, usage tracking, archive filtering, available commands |
| Events | ~4 | Insert + list with limit, ordering, chat history union merge |
| Inputs | ~3 | Insert + list pending, answerInput status change |
| Diffs | ~3 | Insert + get, getPendingDiff latest, status update |
| Approvals | ~8 | Insert + resolve, list pending vs all, findApprovalRule task-level overrides global, per-session scoping |
| MCP Servers | ~6 | Global + task-level, getMergedMcpServers override by name, remove orphans |

Create `backend/src/db/helpers.test.ts` (~5 tests): parseRepoName (SSH, HTTPS, with/without .git, fallback).

**Dependencies:** None (can run in parallel with 1A)

---

### 1C — Split `lib/acp.ts` (1,214 lines)

**Split:**
```
backend/src/lib/acp/
  index.ts              # Re-exports public API
  session-registry.ts   # RunningSession type, sessions Map, userStopped Set (~50 lines)
  handshake.ts          # runAcpHandshake() (~80 lines)
  notifications.ts      # handleNotification, handleSessionUpdate, handleUsageUpdate,
                        # handleToolCall, flushCurrentMessage (~200 lines)
  tool-helpers.ts       # extractToolName, extractToolContext — pure functions (~50 lines)
  approvals.ts          # pendingApprovalResolvers Map, resolveApproval (~100 lines)
  spawn.ts              # spawnProcess, spawnAndHandshake (~140 lines)
  prompt.ts             # sendPromptTurn, sendInputToAgent (~100 lines)
  resume.ts             # resumeSession (~120 lines)
  lifecycle.ts          # stopAgent, cancelTurn, handleExit, shutdownAllSessions,
                        # recoverInterruptedSessions (~140 lines)
  task-status.ts        # deriveTaskStatus — extract pure derivation logic (~40 lines)
  config.ts             # setSessionConfigOption, getSessionConfigOptions,
                        # getSessionAvailableCommands (~50 lines)
```

`session-registry.ts` owns the shared state. `index.ts` re-exports so external imports stay as `'../lib/acp'`.

**Sequence:** Extract `tool-helpers.ts` first (pure, zero risk) → `session-registry.ts` → `task-status.ts` → remaining modules → `index.ts`.

**Depends on:** 1A (broadcast import resolution).

**Test:**

- `lib/acp/tool-helpers.test.ts` (~6 tests): extractToolName priority (_meta > kind > title), extractToolContext (file_path, command, pattern).
- `lib/acp/task-status.test.ts` (~10 tests): running+turn → working, running+idle → awaiting_input, pending input → awaiting_input, ready/starting → awaiting_input, all stopped → todo, done stays done, mixed states.
- `lib/agents.test.ts` (~8 tests): parseClaudeConfigOptions valid/invalid, parseOpenCodeConfigOptions valid/missing, buildAgentEnv strips AGEMON_KEY, getAllPluginPaths, getAllSkillPaths.

---

### 1D — Split `routes/tasks.ts` (408 lines)

**Split:**
```
backend/src/routes/
  shared.ts          # sendError, validateTaskFields, validateRepoUrls, requireTask (~40 lines)
  tasks.ts           # Task CRUD: GET/POST/PATCH/DELETE /tasks, /tasks/:id, /tasks/by-project (~120 lines)
  sessions.ts        # Session endpoints: start, stop, resume, config, archive, chat, list (~180 lines)
  approvals.ts       # GET /tasks/:id/approvals (~20 lines, move from server.ts)
  legacy.ts          # (optional) Backward-compat if needed
```

Update `app.ts` to mount all route groups. Move approval endpoint from `server.ts` to `approvals.ts`.

**Depends on:** 1A.

**Test:**

`routes/tasks.test.ts` (~30 tests):
- Auth: no header → 401, wrong key → 401, health skips auth
- Task CRUD: POST creates (201), POST no title (400), POST with repos, POST bad SSH URL (400), GET lists, GET with archived, GET by id, GET missing (404), GET by-project, PATCH updates, PATCH archive, DELETE (204 + 404)
- Sessions: POST start (202, mock ACP), GET list, POST stop, POST resume, POST set config, PATCH archive, GET chat, GET all sessions
- Events: GET with limit

`routes/mcp-config.test.ts` (~12 tests): global CRUD, task-level CRUD, duplicate name (409), missing name (400).

`routes/approvals.test.ts` (~4 tests): GET pending, GET all, task not found (404).

Session start/stop routes mock `acp` and `git` modules via `bun:test` `mock.module()`.

---

### 1E — Backend misc tests

- `lib/slugify.test.ts` (~8 tests): slugification, hyphen collapsing, truncation, empty input, unicode.
- `lib/jsonrpc.test.ts` (~6 tests): request/response correlation, timeouts, notification dispatch, close behavior.
- `lib/context.test.ts` (~10 tests): safeName, generateClaudeMd content, refreshPluginSymlinks idempotency, refreshSkillSymlinks collision handling, buildFirstPromptContext injection logic.
- Add `"test": "bun test"` to `backend/package.json`.

---

## Package 2: Frontend

### 2A — Extract hooks from `tasks.$id.tsx` (427 lines)

**Split:**
```
frontend/src/hooks/
  use-task-detail.ts       # useQuery calls, 6 mutations, derived state (isDone, actionLoading) (~120 lines)
  use-session-selection.ts # selectedSessionId, handleSelectSession, handleBackToList,
                           # popstate, session guard (~60 lines)
  use-session-chat.ts      # chat store selectors, chat query + seeding, grouped items,
                           # pending inputs/approvals, handleSend, handleCancelTurn,
                           # handleApprovalDecision, handleSetConfig, turnInFlight (~120 lines)
```

`tasks.$id.tsx` becomes ~130 lines composing these hooks + rendering SessionListPanel, SessionChatPanel, TaskInfoDrawer.

---

### 2B — Extract sub-components from `session-chat-panel.tsx` (447 lines)

**Split:**
```
frontend/src/components/custom/
  session-mobile-header.tsx     # Mobile-only top bar with back button, session name (~40 lines)
  chat-messages-area.tsx        # Scroll container, sticky scroll, message rendering,
                                # "new messages" pill, context window bar (~100 lines)
  slash-command-menu.tsx        # Command autocomplete dropdown + keyboard navigation (~60 lines)
  chat-input-area.tsx           # Input form + send/cancel + slash command integration (~100 lines)
  session-mode-bar.tsx          # Mode badge + model picker + config options (~50 lines)
```

`session-chat-panel.tsx` becomes ~80 lines composing sub-components.

---

### 2C — Split `mcp-server-list.tsx` (403 lines)

**Split:**
- `mcp-server-item.tsx` — McpServerItem (lines 12-61, ~50 lines)
- `mcp-server-form.tsx` — AddMcpServerForm (lines 64-293, ~230 lines)
- `mcp-server-list.tsx` slims to ~100 lines

---

### 2D — Frontend test infrastructure + store tests

**Add** devDependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

**Create** `frontend/vitest.config.ts` with jsdom environment + path aliases matching vite.config.ts.

**Add** `"test": "vitest run"` to `frontend/package.json`.

**Create** `frontend/src/lib/store.test.ts` (~15 tests):
- appendChatMessage (new, streaming accumulation, cap at MAX_MESSAGES_PER_SESSION)
- setChatMessages / clearChatMessages
- addPendingInput / removePendingInput
- addPendingApproval / resolvePendingApproval
- mergePendingApprovals (merge + cap at MAX_APPROVALS)
- markUnread / clearUnread
- setTurnInFlight
- updateSessionUsage (new — tests token count accumulation)

Zustand stores tested via `useWsStore.getState()` — no React rendering needed.

---

## Package 3: Root / CI

### 3A — Root test script + CI

**Add** to root `package.json`:
```json
"test": "cd backend && bun test && cd ../frontend && bunx vitest run"
```

**Create** `.github/workflows/test.yml` running both backend and frontend tests on push/PR.

---

## Execution Order

```
Backend track:  1A → 1B → 1C → 1D → 1E  (sequential, each depends on prior)
Frontend track: 2A → 2B → 2C → 2D        (sequential, independent of backend)
CI:             3A                         (after both tracks done)
```

Backend and frontend tracks can run in parallel.

**Recommended sequencing for feature work:**
- Do **1A + 1B** before Task 3.5/4.19 (token tracking) — new feature lands in split modules
- Do **1C** before Task 4.32 (offline behavior) — avoid adding more code to acp.ts god file
- Frontend split (2A-2D) can wait until after immediate feature priorities

---

## Verification

After each task:
1. `bun run dev` — backend + frontend start without errors
2. `bun test` (backend, after 1B) — all tests pass
3. `bunx vitest run` (frontend, after 2D) — all tests pass
4. `./scripts/test-api.sh` — existing smoke tests still pass

Final state:
- ~160 automated tests (DB ~60, routes ~46, business logic ~24, pure functions ~18, store ~15, context ~10)
- No backend file over 200 lines (except migrations.ts)
- No frontend component over 150 lines
- CI on every PR

---

## Changes Since Original Plan (March 13 update)

**Backend:**
- server.ts grew +54 lines (global plugin/skill symlinking at startup)
- acp.ts grew +155 lines (usage tracking, tool call events, slash commands, config options)
- client.ts grew +104 lines (12 new methods: usage, config, commands, approvals-per-session)
- tasks.ts grew +46 lines (session resume, archive, config endpoints)
- **New:** context.ts module (169 lines) — CLAUDE.md generation, plugin/skill symlinking logic

**Adjustments:**
- 1A now includes moving global plugin/skill setup from server.ts to a startup module
- 1B splits 49 methods (up from ~40) — sessions domain now has 12 methods (was 8)
- 1C includes new notifications.ts with usage + tool call handlers (~200 lines, was 150)
- 1C includes new config.ts module for session config options + available commands
- 1D includes approvals route (move from server.ts inline endpoint)
- 1E adds context.test.ts for the new context module

**Test count:** ~160 (up from ~145) due to new features (usage tracking, config options, commands, context generation).
