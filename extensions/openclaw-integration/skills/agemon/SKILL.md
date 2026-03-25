---
name: agemon
description: "Manage coding tasks and agent sessions on Agemon. Use when: creating tasks, listing tasks, starting/stopping agent sessions, sending messages to running sessions, checking task/session status, or registering notification mappings. NOT for: direct git operations (use git), code editing (use coding-agent), or GitHub issue/PR management (use github skill)."
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

Control Agemon task/session management. Agemon orchestrates coding agents (Claude Code, Codex, Aider, Goose) on tasks with git repo worktrees.

## Setup

```bash
export AGEMON_URL="http://127.0.0.1:3000"  # no trailing slash
export AGEMON_KEY="your-agemon-key"
```

All requests:

```bash
curl -s "${AGEMON_URL}/api/..." \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json"
```

## Tasks

**List:**

```bash
curl -s "${AGEMON_URL}/api/extensions/tasks/tasks" \
  -H "Authorization: Bearer ${AGEMON_KEY}"
```

**Create:**

```bash
curl -s -X POST "${AGEMON_URL}/api/extensions/tasks/tasks" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix login bug", "description": "500 on /login", "repos": ["git@github.com:org/repo.git"], "agent": "claude-code"}'
```

Fields: `title` (required), `description`, `repos` (git URL array), `agent` (`claude-code` | `codex` | `aider` | `goose`, default: `claude-code`).

**Get:** `GET /api/extensions/tasks/tasks/{id}`

**Update:**

```bash
curl -s -X PATCH "${AGEMON_URL}/api/extensions/tasks/tasks/{id}" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

Patchable: `title`, `description`, `status` (`todo`|`in-progress`|`blocked`|`in-review`|`done`), `repos`, `archived`.

**Delete:** `DELETE /api/extensions/tasks/tasks/{id}`

## Sessions

**Start session on task:**

```bash
curl -s -X POST "${AGEMON_URL}/api/tasks/{task_id}/sessions" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"agentType": "claude-code"}'
```

**Send message:**

```bash
curl -s -X POST "${AGEMON_URL}/api/sessions/{session_id}/message" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"content": "Also add tests for edge cases"}'
```

**Chat history:** `GET /api/sessions/{session_id}/chat`

**Stop:** `POST /api/sessions/{session_id}/stop`

**Resume:** `POST /api/sessions/{session_id}/resume`

**List all:** `GET /api/sessions`

**List for task:** `GET /api/tasks/{task_id}/sessions`

**Stop all for task:** `POST /api/tasks/{task_id}/stop`

## Notification Mappings

Register a task to forward events with opaque metadata:

```bash
curl -s -X POST "${AGEMON_URL}/api/extensions/openclaw-integration/configure" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "fix-login-bug", "metadata": {"channel": "#dev", "agentId": "main"}}'
```

`metadata` is opaque — Agemon stores and forwards it verbatim in webhook payloads. Fields are spread into the OpenClaw hook action for routing.

**Thread-aware notifications:** To route Agemon events back to the Slack thread you're in, include your session context:

```bash
curl -s -X POST "${AGEMON_URL}/api/extensions/openclaw-integration/configure" \
  -H "Authorization: Bearer ${AGEMON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"taskId": "fix-login-bug", "metadata": {"channel": "slack", "sessionKey": "<your-current-session-key>"}}'
```

The `sessionKey` tells OpenClaw to deliver to the same conversation (including thread) that the originating session was in. If you're an OpenClaw agent running in a Slack thread, pass your own session key.

**List:** `GET /api/extensions/openclaw-integration/mappings`

**Remove:** `DELETE /api/extensions/openclaw-integration/mappings/{task_id}`

## Typical Flow

1. Create task → get `id`
2. Register notification mapping with metadata (POST configure)
3. Start session → agent spawns, ACP handshake, begins work
4. Events auto-forward to OpenClaw webhook with metadata attached
5. Monitor: list sessions, get chat history, send follow-up messages

## Health

```bash
curl -s "${AGEMON_URL}/api/health"
```

## Notes

- Task IDs are slugified from title (`Fix login bug` → `fix-login-bug`)
- Session states: `starting` → `ready` → `running` → `stopped`/`error`
- Repos are cloned as worktrees per task — agents work in isolated dirs
- WebSocket at `${AGEMON_URL}/ws` streams real-time events
