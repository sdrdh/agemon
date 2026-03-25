---
name: agemon
description: "Manage coding tasks and agent sessions via the Agemon API. Use when: creating tasks, starting/stopping agent sessions, sending messages to sessions, checking task status, or managing repos on tasks. NOT for: direct git operations (use git), code review (use coding-agent or github skill), or general file editing."
metadata:
  {
    "openclaw":
      {
        "emoji": "🖥️",
        "requires": { "env": ["AGEMON_URL", "AGEMON_KEY"] },
        "primaryEnv": "AGEMON_KEY",
      },
  }
---

# Agemon

Control Agemon task/session management from OpenClaw.

## Setup

Store credentials:

```bash
# Agemon base URL (no trailing slash)
export AGEMON_URL="http://127.0.0.1:3000"
# API key for authentication
export AGEMON_KEY="your-agemon-key"
```

All requests need:

```bash
curl -s "${AGEMON_URL}/api/..." \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json"
```

## Tasks

**List tasks:**

```bash
curl -s "${AGEMON_URL}/api/extensions/tasks/tasks" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Create task:**

```bash
curl -s -X POST "${AGEMON_URL}/api/extensions/tasks/tasks" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix login bug",
    "description": "Users report 500 on /login",
    "repos": ["git@github.com:org/repo.git"],
    "agent": "claude-code"
  }'
```

Fields: `title` (required), `description`, `repos` (array of git URLs), `agent` (default: `claude-code`, options: `claude-code`, `codex`, `aider`, `goose`).

**Get task:**

```bash
curl -s "${AGEMON_URL}/api/extensions/tasks/tasks/{task_id}" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Update task:**

```bash
curl -s -X PATCH "${AGEMON_URL}/api/extensions/tasks/tasks/{task_id}" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "title": "Updated title"}'
```

Patchable: `title`, `description`, `status` (`todo`, `in-progress`, `blocked`, `in-review`, `done`), `repos`, `archived`.

**Delete task:**

```bash
curl -s -X DELETE "${AGEMON_URL}/api/extensions/tasks/tasks/{task_id}" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

## Sessions

**Start session on task:**

```bash
curl -s -X POST "${AGEMON_URL}/api/tasks/{task_id}/sessions" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"agentType": "claude-code"}'
```

Returns session object with `id`. The agent spawns and runs an ACP handshake.

**List sessions for task:**

```bash
curl -s "${AGEMON_URL}/api/tasks/{task_id}/sessions" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**List all sessions:**

```bash
curl -s "${AGEMON_URL}/api/sessions" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Get session detail:**

```bash
curl -s "${AGEMON_URL}/api/sessions/{session_id}" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Send message to session:**

```bash
curl -s -X POST "${AGEMON_URL}/api/sessions/{session_id}/message" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Please also add tests"}'
```

**Get chat history:**

```bash
curl -s "${AGEMON_URL}/api/sessions/{session_id}/chat" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Stop session:**

```bash
curl -s -X POST "${AGEMON_URL}/api/sessions/{session_id}/stop" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Resume session:**

```bash
curl -s -X POST "${AGEMON_URL}/api/sessions/{session_id}/resume" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Stop all sessions for task:**

```bash
curl -s -X POST "${AGEMON_URL}/api/tasks/{task_id}/stop" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

## Notification Mappings (OpenClaw Integration)

Register a task to forward events to a specific channel:

```bash
curl -s -X POST "${AGEMON_URL}/api/extensions/openclaw-integration/configure" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "fix-login-bug", "channel": "#dev"}'
```

**List mappings:**

```bash
curl -s "${AGEMON_URL}/api/extensions/openclaw-integration/mappings" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Remove mapping:**

```bash
curl -s -X DELETE "${AGEMON_URL}/api/extensions/openclaw-integration/mappings/{task_id}" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

## Typical Flows

### Create task and watch it

1. Create task (POST tasks)
2. Register notification mapping (POST configure) with your channel
3. Start session (POST tasks/{id}/sessions)
4. Events flow to OpenClaw webhook automatically

### Check on running work

1. List tasks (GET tasks) — find the task
2. List sessions (GET tasks/{id}/sessions) — find active session
3. Get chat history (GET sessions/{id}/chat) — see what the agent did
4. Send follow-up message if needed (POST sessions/{id}/message)

## Health Check

```bash
curl -s "${AGEMON_URL}/api/health"
```

Returns `{"status": "ok", ...}` with uptime, session counts, loaded extensions.

## Notes

- Task IDs are slugified from the title (e.g. "Fix login bug" → `fix-login-bug`)
- Session states: `starting`, `ready`, `running`, `paused`, `stopped`, `error`
- Agent types: `claude-code`, `codex`, `aider`, `goose`
- Repos are cloned as git worktrees per task — agents work in isolated directories
- The WebSocket at `${AGEMON_URL}/ws` streams real-time events (task updates, session output, approvals)
