# Plan: Code Organization & Testing

**Status:** Proposed
**Last Updated:** March 2026

## Context

Agemon has god files and zero automated tests. This plan restructures code and adds tests, organized by package so each package can be worked on independently.

Each task contains both its splitting plan and its testing plan.

---

## Package 1: Backend

### 1A — Extract `createApp()` factory from `server.ts`

**Split:** Move app creation out of `server.ts` (255 lines) into `backend/src/app.ts`.

- `createApp(opts: { key: string })` — creates Hono app, registers middleware (CORS, auth, logging, error handler), mounts all routes, WebSocket handler, MCP endpoint. Exports `broadcast()`. Returns `{ app, broadcast, eventBus, wsClients }`.
- `server.ts` slims to ~40 lines: env vars, `runMigrations()`, `createApp()`, `Bun.serve()`, signal handlers.
- Update imports in `lib/acp.ts` and `routes/tasks.ts` — import `broadcast` from `app.ts` instead of `server.ts`.

**Test:** Create `backend/src/test-helpers/app.ts` — `setupTestApp()` calls `createApp({ key: 'test-key' })` with in-memory DB. Enables all in-process route testing via `app.request()`.

---

### 1B — Split `db/client.ts` (951 lines)

**Split:**
```
backend/src/db/
  client.ts          # getDb(), resetDb(), generateTaskId(), facade re-export (~80 lines)
  migrations.ts      # SCHEMA_VERSION, runMigrations() (~210 lines)
  helpers.ts         # parseTask, parseSession, mapApproval, mapMcpServer, parseRepoName, constant sets (~90 lines)
  tasks.ts           # listTasks, getTask, createTask, updateTask, deleteTask, listTasksByProject
  sessions.ts        # getSession, listSessions, insertSession, updateSessionState, etc. (10 methods)
  events.ts          # listEvents, insertEvent
  inputs.ts          # listPendingInputs, insertAwaitingInput, answerInput
  diffs.ts           # getDiff, getPendingDiff, insertDiff, updateDiffStatus
  chat.ts            # listChatHistory, listChatHistoryBySession
  approvals.ts       # insert/resolve/get/list pending approvals + approval rules (7 methods)
  repos.ts           # listRepos, upsertRepo, getTaskRepos, setTaskRepos, _buildRepoMap
  mcp-servers.ts     # add/remove/get/list MCP servers, getMergedMcpServers
```

Each domain file exports functions that call `getDb()` internally. `client.ts` re-composes the `db` facade — external API unchanged. Add `resetDb()` export (sets `_db = null`).

**Test:** Create `backend/src/test-helpers/db.ts` — `setupTestDb()` sets `DB_PATH=:memory:`, calls `resetDb()` + `runMigrations()`.

Create `backend/src/db/client.test.ts` (~50 tests):

| Domain | Tests | Key assertions |
|--------|-------|----------------|
| Tasks | ~15 | CRUD round-trip, repo association, archive filtering, generateTaskId collisions, listTasksByProject grouping |
| Repos | ~5 | Upsert idempotency, setTaskRepos replacement, _buildRepoMap batch |
| Sessions | ~8 | State transitions, ended_at auto-set, config JSON round-trip, archive filtering |
| Events | ~3 | Insert + list with limit, ordering |
| Inputs | ~3 | Insert + list pending, answerInput status change |
| Diffs | ~3 | Insert + get, getPendingDiff latest, status update |
| Chat | ~3 | UNION merge, event type mapping, session-scoped query |
| Approvals | ~6 | Insert + resolve, list pending vs all, findApprovalRule task-level overrides global |
| MCP Servers | ~4 | Global + task-level, getMergedMcpServers override by name |

Create `backend/src/db/helpers.test.ts` (~5 tests): parseRepoName (SSH, HTTPS, with/without .git, fallback).

---

### 1C — Split `lib/acp.ts` (1,059 lines)

**Split:**
```
backend/src/lib/acp/
  index.ts              # Re-exports public API
  session-registry.ts   # RunningSession type, sessions Map, userStopped Set (~50 lines)
  handshake.ts          # runAcpHandshake() (~80 lines)
  notifications.ts      # handleNotification, handleSessionUpdate, flushCurrentMessage (~150 lines)
  tool-helpers.ts       # extractToolName, extractToolContext — pure functions (~50 lines)
  approvals.ts          # pendingApprovalResolvers Map, resolveApproval (~100 lines)
  spawn.ts              # spawnProcess, spawnAndHandshake (~120 lines)
  prompt.ts             # sendPromptTurn (~80 lines)
  resume.ts             # resumeSession (~120 lines)
  lifecycle.ts          # stopAgent, cancelTurn, handleExit, shutdownAllSessions, recoverInterruptedSessions (~120 lines)
  task-status.ts        # deriveTaskStatus — extract pure derivation logic (~40 lines)
  config.ts             # setSessionConfigOption, getSessionConfigOptions (~30 lines)
```

`session-registry.ts` owns the shared state. `index.ts` re-exports so external imports stay as `'../lib/acp'`.

**Sequence:** Extract `tool-helpers.ts` first (pure, zero risk) → `session-registry.ts` → `task-status.ts` → remaining modules → `index.ts`.

**Depends on:** 1A (broadcast import resolution).

**Test:**

- `lib/acp/tool-helpers.test.ts` (~6 tests): extractToolName priority (_meta > kind > title), extractToolContext (file_path, command, pattern).
- `lib/acp/task-status.test.ts` (~10 tests): running+turn → working, running+idle → awaiting_input, pending input → awaiting_input, ready/starting → awaiting_input, all stopped → todo, done stays done, mixed states.
- `lib/agents.test.ts` (~6 tests): parseClaudeConfigOptions valid/invalid, parseOpenCodeConfigOptions valid/missing, buildAgentEnv strips AGEMON_KEY.

---

### 1D — Split `routes/tasks.ts` (362 lines)

**Split:**
```
backend/src/routes/
  shared.ts          # sendError, validateTaskFields, validateRepoUrls, requireTask (~40 lines)
  tasks.ts           # Task CRUD: GET/POST/PATCH/DELETE /tasks, /tasks/:id, /tasks/by-project (~120 lines)
  sessions.ts        # Session endpoints: start, stop, resume, config, archive, chat (~150 lines)
  legacy.ts          # Backward-compat: /tasks/:id/stop, /tasks/:id/chat, global /sessions, /repos (~30 lines)
  mcp-config.ts      # (unchanged)
```

Update `app.ts` to mount all route groups.

**Depends on:** 1A.

**Test:**

`routes/tasks.test.ts` (~30 tests):
- Auth: no header → 401, wrong key → 401, health skips auth
- Task CRUD: POST creates (201), POST no title (400), POST with repos, POST bad SSH URL (400), GET lists, GET with archived, GET by id, GET missing (404), GET by-project, PATCH updates, PATCH archive, DELETE (204 + 404)
- Sessions: POST start (202, mock ACP), GET list, POST stop, POST resume, PATCH archive, GET chat, GET all sessions
- Events: GET with limit

`routes/mcp-config.test.ts` (~12 tests): global CRUD, task-level CRUD, duplicate name (409), missing name (400).

Session start/stop routes mock `acp` and `git` modules via `bun:test` `mock.module()`.

---

### 1E — Backend misc tests

- `lib/slugify.test.ts` (~8 tests): slugification, hyphen collapsing, truncation, empty input, unicode.
- `lib/jsonrpc.test.ts` (~6 tests): request/response correlation, timeouts, notification dispatch, close behavior.
- Add `"test": "bun test"` to `backend/package.json`.

---

## Package 2: Frontend

### 2A — Extract hooks from `tasks.$id.tsx` (411 lines)

**Split:**
```
frontend/src/hooks/
  use-task-detail.ts       # useQuery calls, 6 mutations, derived state (isDone, actionLoading) (~120 lines)
  use-session-selection.ts # selectedSessionId, handleSelectSession, handleBackToList, popstate, session guard (~60 lines)
  use-session-chat.ts      # chat store selectors, chat query + seeding, grouped items, pending inputs/approvals, handleSend, handleCancelTurn, handleApprovalDecision, turnInFlight (~100 lines)
```

`tasks.$id.tsx` becomes ~150 lines composing these hooks + rendering SessionListPanel, SessionChatPanel, TaskInfoDrawer.

---

### 2B — Extract sub-components from `session-chat-panel.tsx` (394 lines)

**Split:**
```
frontend/src/components/custom/
  session-mobile-header.tsx     # Mobile-only top bar (~30 lines)
  chat-messages-area.tsx        # Scroll container, sticky scroll, message rendering, "new messages" pill (~80 lines)
  slash-command-menu.tsx        # Command autocomplete dropdown + keyboard navigation (~60 lines)
  chat-input-area.tsx           # Input form + send/cancel + slash command integration (~80 lines)
  session-mode-bar.tsx          # Mode badge + model picker (~40 lines)
```

`session-chat-panel.tsx` becomes ~80 lines composing sub-components.

---

### 2C — Split `mcp-server-list.tsx` (403 lines)

**Split:**
- `mcp-server-item.tsx` — McpServerItem (lines 12-61)
- `mcp-server-form.tsx` — AddMcpServerForm (lines 64-293)
- `mcp-server-list.tsx` slims to ~80 lines

---

### 2D — Frontend test infrastructure + store tests

**Add** devDependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

**Create** `frontend/vitest.config.ts` with jsdom environment + path aliases matching vite.config.ts.

**Add** `"test": "vitest run"` to `frontend/package.json`.

**Create** `frontend/src/lib/store.test.ts` (~12 tests):
- appendChatMessage (new, streaming accumulation, cap at MAX_MESSAGES_PER_SESSION)
- setChatMessages / clearChatMessages
- addPendingInput / removePendingInput
- addPendingApproval / resolvePendingApproval
- mergePendingApprovals (merge + cap at MAX_APPROVALS)
- markUnread / clearUnread
- setTurnInFlight

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

## Verification

After each task:
1. `bun run dev` — backend + frontend start without errors
2. `bun test` (backend, after 1B) — all tests pass
3. `bunx vitest run` (frontend, after 2D) — all tests pass
4. `./scripts/test-api.sh` — existing smoke tests still pass

Final state:
- ~145 automated tests (DB ~55, routes ~42, business logic ~22, pure functions ~14, store ~12)
- No backend file over 200 lines (except migrations.ts, jsonrpc.ts)
- No frontend component over 200 lines
- CI on every PR
