# API Reference

## Authentication

All endpoints (except `/api/health` and `/api/version`) require a Bearer token:

```
Authorization: Bearer <AGEMON_KEY>
```

## Base URL

```
http://localhost:3000
```

---

## Health & Version

### GET /api/health

Check if the server is running. No auth required.

**Response 200:**
```json
{ "status": "ok", "timestamp": "2026-02-28T10:00:00.000Z" }
```

### GET /api/version

Get current server version. No auth required.

**Response 200:**
```json
{ "current": "0.1.0", "running_under_systemd": false }
```

### GET /api/version/check

Check for available updates.

**Response 200:**
```json
{
  "current": "0.1.0",
  "latest": "0.2.0",
  "latest_tag": "v0.2.0",
  "has_update": true,
  "should_notify": true,
  "published_at": "2026-03-01T00:00:00Z",
  "release_url": "https://github.com/...",
  "checked_at": "2026-02-28T10:00:00Z",
  "channel": "stable"
}
```

### POST /api/update

Trigger a software update. Requires `running_under_systemd: true`.

### POST /api/restart

Gracefully restart the server. Requires `running_under_systemd: true`.

### POST /api/rebuild

Rebuild the frontend from the working tree, then restart.

---

## Tasks

Tasks are served by the **tasks extension** at `/api/extensions/tasks/`:

### GET /api/extensions/tasks/tasks

List all tasks (excludes archived by default).

**Query params:** `archived=true` — include archived tasks.

**Response 200:** `Task[]`

```json
[
  {
    "id": "add-authentication",
    "title": "Add authentication",
    "description": "Implement JWT with Passport.js",
    "status": "working",
    "repos": [{ "id": 1, "url": "git@github.com:acme/api.git", "name": "acme/api", "created_at": "..." }],
    "agent": "claude-code",
    "archived": false,
    "created_at": "2026-02-28T10:00:00Z"
  }
]
```

### POST /api/extensions/tasks/tasks

Create a new task.

**Request body:**
```json
{
  "title": "Add authentication",
  "description": "Implement JWT with Passport.js",
  "repos": ["git@github.com:acme/api.git"],
  "agent": "claude-code"
}
```

**Response 201:** Created `Task`.

### GET /api/extensions/tasks/tasks/:id

Get a single task.

**Response 200:** `Task`.
**Response 404:** `{ "error": "Not Found", "message": "Task not found", "statusCode": 404 }`

### PATCH /api/extensions/tasks/tasks/:id

Update task fields. All fields optional.

```json
{ "title": "Updated title", "description": "..." }
```

### GET /api/extensions/tasks/tasks/by-project

Group tasks by repository.

**Response 200:**
```json
{
  "projects": {
    "acme/api": [ { "id": "...", "title": "...", ... } ]
  },
  "ungrouped": [ { "id": "...", "title": "...", "repos": [], ... } ]
}
```

### GET /api/extensions/tasks/tasks/:id/events

Get the ACP event stream for a task (merged from all sessions).

**Query params:** `limit=500` (default).

---

## Sessions

### GET /api/sessions

List all sessions (excludes archived by default).

**Query params:** `archived=true`, `limit=100` (default, max 1000).

**Response 200:** `AgentSession[]`

### GET /api/sessions/:id

Get a single session.

**Response 200:** `AgentSession`.

### GET /api/sessions/:id/chat

Get chat history for a session.

**Query params:** `limit=500` (default, max 5000), `before=<event-id>` (pagination).

**Response 200:**
```json
{
  "messages": [
    { "id": "...", "role": "agent", "content": "...", "eventType": "action", "timestamp": "..." }
  ],
  "hasMore": false
}
```

### GET /api/sessions/:id/config

Get available config options (e.g. model selector) for a session.

### POST /api/sessions/:id/config

Set a config option (`model`, `mode`, etc.).

```json
{ "configId": "model", "value": "claude-3-5-sonnet-20241022" }
```

### GET /api/sessions/:id/commands

Get available slash commands for a session.

### GET /api/sessions/:id/approvals

List pending approvals for a session.

### POST /api/sessions/:id/stop

Stop a running session.

### POST /api/sessions/:id/resume

Resume a stopped/crashed session.

### POST /api/sessions/:id/message

Send a follow-up message to a running session.

```json
{ "content": "Actually, use SQLite instead." }
```

### PATCH /api/sessions/:id/archive

Archive or unarchive a session.

```json
{ "archived": true }
```

---

## Task-Scoped Session Routes

### POST /api/tasks/:id/sessions

Create a new agent session for a task. Creates worktrees on first session.

**Request body (optional):**
```json
{ "agentType": "opencode" }
```

**Response 202:** `AgentSession` (in `starting` state).

### GET /api/tasks/:id/sessions

List sessions for a task.

**Query params:** `archived=true`

### GET /api/tasks/:id/approvals

List pending or all approvals for a task.

**Query params:** `all=1` — include resolved approvals.

---

## Dashboard

### GET /api/dashboard/active

Returns blocked and idle active sessions for the dashboard.

**Response 200:**
```json
{
  "blocked": [
    {
      "session": { ... },
      "task": { "id": "...", "title": "...", "description": null },
      "lastAgentMessage": "Which library should I use?",
      "pendingInputs": [{ "id": "...", "question": "...", "status": "pending", ... }],
      "pendingApprovals": [{ "id": "...", "toolName": "Bash", ... }]
    }
  ],
  "idle": [
    { "session": { ... }, "task": { ... }, "lastAgentMessage": null }
  ]
}
```

---

## Settings

### GET /api/settings

Get all settings.

**Response 200:** `Record<string, string>`

### GET /api/settings/:key

Get a single setting.

**Response 200:** `{ "value": "stable" }`

### POST /api/settings

Set a setting. Key must be in the allowlist (`auto_upgrade`, `auto_resume_sessions`, `release_channel`, `release_branch`).

```json
{ "key": "release_channel", "value": "pre-release" }
```

---

## Repos

### GET /api/repos

List all registered repositories.

---

## MCP Servers

MCP servers are managed by the **mcp-config extension** at `/api/extensions/mcp-config/`:

### GET /api/extensions/mcp-config/mcp-servers

List global MCP server configurations.

### POST /api/extensions/mcp-config/mcp-servers

Add a global MCP server.

### DELETE /api/extensions/mcp-config/mcp-servers/:id

Remove a global MCP server.

### POST /api/extensions/mcp-config/mcp-servers/test

Test an MCP server configuration before saving.

### GET /api/extensions/mcp-config/tasks/:id/mcp-servers

List MCP servers for a task (global + task-scoped).

### POST /api/extensions/mcp-config/tasks/:id/mcp-servers

Add a task-scoped MCP server.

### DELETE /api/extensions/mcp-config/tasks/:id/mcp-servers/:serverId

Remove a task-scoped MCP server.

---

## Skills

Skills are managed by the **skills-manager extension** at `/api/extensions/skills-manager/`:

### GET /api/extensions/skills-manager/skills

List global skills.

### POST /api/extensions/skills-manager/skills

Install a skill from a git URL or npm package.

```json
{ "source": "https://github.com/user/agemon-skill", "skillNames": ["my-skill"] }
```

### DELETE /api/extensions/skills-manager/skills/:name

Remove a global skill.

### GET /api/extensions/skills-manager/tasks/:id/skills

List skills for a task (global + task-scoped).

### POST /api/extensions/skills-manager/tasks/:id/skills

Install a task-scoped skill.

### DELETE /api/extensions/skills-manager/tasks/:id/skills/:name

Remove a task-scoped skill.

---

## Plugin Infrastructure

### GET /api/extensions

List all loaded extensions with their manifests.

### GET /api/extensions/:id/settings

Get extension settings schema and current values (masked for secrets).

### POST /api/extensions/:id/settings

Update extension settings.

### PATCH /api/extensions/:id

Update extension configuration (e.g. nav visibility).

### GET /api/renderers/pages/:extensionId/:component.js

Fetch compiled extension page renderer (browser ESM).

### GET /api/renderers/icons/:extensionId/:component.js

Fetch compiled extension icon renderer.

---

## WebSocket

### ws://localhost:3000/ws

Connect for real-time updates. Auth via browser cookie (set automatically on login). Token can also be passed as query param: `?token=<AGEMON_KEY>`.

The connection is closed with code `4401` if the token is missing or invalid.

**Server → Client events:**

```typescript
// All events include seq (monotonic counter) and epoch (server restart counter)

{ "type": "task_updated",              seq, epoch, task: Task }
{ "type": "agent_thought",             seq, epoch, taskId, sessionId, content, eventType: 'thought'|'action', messageId? }
{ "type": "awaiting_input",           seq, epoch, taskId, sessionId, question, inputId }
{ "type": "terminal_output",           seq, epoch, sessionId, data }
{ "type": "session_started",           seq, epoch, taskId, session: AgentSession }
{ "type": "session_ready",             seq, epoch, taskId, session: AgentSession }
{ "type": "session_state_changed",     seq, epoch, sessionId, taskId, state }
{ "type": "approval_requested",        seq, epoch, approval: PendingApproval }
{ "type": "approval_resolved",         seq, epoch, approvalId, decision }
{ "type": "config_options_updated",    seq, epoch, sessionId, taskId, configOptions }
{ "type": "available_commands",        seq, epoch, sessionId, taskId, commands }
{ "type": "turn_cancelled",           seq, epoch, sessionId, taskId }
{ "type": "turn_completed",           seq, epoch, sessionId, taskId }
{ "type": "session_usage_update",      seq, epoch, sessionId, taskId, usage }
{ "type": "extensions_changed",        seq, epoch, extensionIds }
{ "type": "update_available",         seq, epoch, version, should_notify }
{ "type": "server_restarting",         seq, epoch }
{ "type": "full_sync_required",        seq, epoch }
```

**Client → Server events:**

```typescript
{ "type": "send_input",         sessionId, inputId, response }
{ "type": "terminal_input",     sessionId, data }
{ "type": "send_message",       sessionId, content }
{ "type": "approval_response",  approvalId, decision }
{ "type": "set_config_option",  sessionId, configId, value }
{ "type": "cancel_turn",        sessionId }
{ "type": "resume",             lastSeq }   // sent on reconnect
```

**Reconnection:** The server sends `seq` and `epoch` on every event. On reconnect, send `{ type: "resume", lastSeq }` to receive only events after your last known `seq`. If the epoch changed (server restarted), the server sends `full_sync_required` and you should refetch all data.

---

## Error Format

All errors follow:

```json
{
  "error": "Not Found",
  "message": "Task not found",
  "statusCode": 404
}
```
