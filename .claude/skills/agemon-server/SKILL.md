---
name: agemon-server
description: Interact with the local Agemon server REST API and WebSocket. Use when you need to create tasks, check task or session status, respond to agent input requests, approve diffs, or query the Agemon server in any way.
compatibility: Requires curl, jq. Agemon server must be running locally.
---

# Agemon Server Skill

Interact with the local Agemon REST API.

## Auth & Base URL

```bash
# Required env vars — already set in every agemon agent session
AGEMON_KEY="..."           # Bearer token
PORT="${PORT:-3000}"       # Server port, default 3000
BASE="http://localhost:${PORT}/api"
AUTH="Authorization: Bearer ${AGEMON_KEY}"
```

All examples below assume these variables are set.

---

## Common Operations

### Check server health (no auth)
```bash
curl -s http://localhost:${PORT}/api/health | jq .
```

### List all tasks
```bash
curl -s -H "$AUTH" "$BASE/tasks" | jq '.[].id + " [" + .status + "] " + .title'
```

Include archived tasks: `$BASE/tasks?archived=true`

### Get a specific task
```bash
curl -s -H "$AUTH" "$BASE/tasks/$TASK_ID" | jq .
```

### Create a task
```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"title":"My task","description":"Details","repos":["git@github.com:org/repo.git"],"agent":"claude-code"}' \
  "$BASE/tasks" | jq .
```

Valid agents: `claude-code`, `aider`, `gemini`

### Update a task (title/description/agent only — status is system-controlled)
```bash
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"title":"New title"}' "$BASE/tasks/$TASK_ID" | jq .
```

### Delete a task
```bash
curl -s -X DELETE -H "$AUTH" "$BASE/tasks/$TASK_ID"
```

---

## Sessions

### List sessions for a task
```bash
curl -s -H "$AUTH" "$BASE/tasks/$TASK_ID/sessions" | jq .
```

Include archived: `?archived=true`

### Start a new session
```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{}' "$BASE/tasks/$TASK_ID/sessions" | jq .
# Optional: override agent type
-d '{"agentType":"aider"}'
```

Returns session in `starting` state (202). Session moves to `ready` after ACP handshake.

### Stop a session
```bash
curl -s -X POST -H "$AUTH" "$BASE/sessions/$SESSION_ID/stop" | jq .
```

### Stop all sessions for a task
```bash
curl -s -X POST -H "$AUTH" "$BASE/tasks/$TASK_ID/stop" | jq .
```

### Resume a stopped/crashed session
```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{}' "$BASE/sessions/$SESSION_ID/resume" | jq .
```

### Get chat history for a session
```bash
curl -s -H "$AUTH" "$BASE/sessions/$SESSION_ID/chat" | jq .
# Limit: ?limit=100 (default 500, max 5000)
```

### Get aggregated chat for a task (all sessions merged)
```bash
curl -s -H "$AUTH" "$BASE/tasks/$TASK_ID/chat" | jq .
```

### Get ACP events for a task
```bash
curl -s -H "$AUTH" "$BASE/tasks/$TASK_ID/events" | jq .
# Event types: thought | action | await_input | result
```

---

## Responding to Input Requests

When a task is in `awaiting_input` state, an agent is blocked waiting for a response.

### Find pending inputs (via WebSocket event or polling tasks)
```bash
# Check task status
curl -s -H "$AUTH" "$BASE/tasks/$TASK_ID" | jq '{status, id}'
```

Pending inputs arrive as WebSocket events: `{"type":"awaiting_input","taskId":"...","question":"...","inputId":"..."}`

### Send an input response (via WebSocket — preferred)
Connect to `ws://localhost:${PORT}/ws?token=${AGEMON_KEY}` and send:
```json
{"type":"send_input","taskId":"<id>","inputId":"<id>","response":"your answer"}
```

### Send a message to a running session (via WebSocket)
```json
{"type":"send_message","sessionId":"<id>","message":"your message"}
```

---

## Approvals

Agents request approval before applying diffs or running destructive commands.

### List pending approvals for a task
```bash
curl -s -H "$AUTH" "$BASE/tasks/$TASK_ID/approvals" | jq .
# All approvals (including resolved): ?all=1
```

### Respond to an approval (via WebSocket)
```json
{"type":"approval_response","approvalId":"<id>","approved":true}
```
or
```json
{"type":"approval_response","approvalId":"<id>","approved":false}
```

---

## System

### Get server version
```bash
curl -s -H "$AUTH" "$BASE/version" | jq .
```

### Check for updates
```bash
curl -s -H "$AUTH" "$BASE/version/check" | jq .
```

### Get/set settings
```bash
curl -s -H "$AUTH" "$BASE/settings" | jq .
curl -s -H "$AUTH" "$BASE/settings/some-key" | jq .
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"key":"setting-name","value":"setting-value"}' "$BASE/settings" | jq .
```

---

## Task Status Reference

| Status | Meaning |
|--------|---------|
| `todo` | Created, no session started |
| `working` | At least one session is running |
| `awaiting_input` | Session blocked, waiting for user response |
| `done` | Explicitly marked done by user |

**Note:** Status is system-derived — never set it directly via PATCH.

## Session State Reference

| State | Meaning |
|-------|---------|
| `starting` | Process spawning, ACP handshake pending |
| `ready` | Handshake done, awaiting first prompt |
| `running` | Agent actively processing |
| `stopped` | Cleanly stopped |
| `crashed` | Process died unexpectedly |
| `interrupted` | Server restarted while session was running |

---

## WebSocket Quick Reference

Connect: `ws://localhost:${PORT}/ws?token=${AGEMON_KEY}`

**Server → Client events:**
- `task_updated` — task status changed
- `agent_thought` — agent emitted a thought
- `awaiting_input` — agent blocked, needs response
- `terminal_output` — PTY output for a session
- `session_updated` — session state changed

**Client → Server events:**
- `send_input` — answer an awaiting_input
- `send_message` — send a message to a running session
- `approval_response` — approve or reject a diff/command
- `terminal_input` — send keystrokes to PTY
