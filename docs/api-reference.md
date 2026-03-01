# API Reference

## Authentication

All endpoints (except `/api/health`) require a Bearer token:

```
Authorization: Bearer <AGEMON_KEY>
```

## Base URL

```
http://localhost:3000
```

---

## Health

### GET /api/health

Check if the server is running.

**No auth required.**

**Response 200:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-02-28T10:00:00.000Z"
}
```

---

## Tasks

### GET /api/tasks

List all tasks, ordered by creation time (newest first).

**Response 200:**
```json
[
  {
    "id": "uuid",
    "title": "Add authentication",
    "description": "Implement JWT auth",
    "status": "working",
    "repos": ["https://github.com/org/repo"],
    "agent": "claude-code",
    "created_at": "2026-02-28T10:00:00Z"
  }
]
```

---

### POST /api/tasks

Create a new task.

**Request body:**
```json
{
  "title": "Add authentication",         // required
  "description": "JWT with Passport.js", // optional
  "repos": ["https://github.com/org/repo"], // required, non-empty
  "agent": "claude-code"                  // required: claude-code | aider | gemini
}
```

**Response 201:** Created task object.

---

### GET /api/tasks/:id

Get a single task by ID.

**Response 200:** Task object.
**Response 404:** `{ "error": "Not Found", "message": "Task not found", "statusCode": 404 }`

---

### PATCH /api/tasks/:id

Update task fields. All fields are optional. `status` is system-controlled and cannot be set via this endpoint.

**Request body:**
```json
{
  "title": "Updated title",
  "description": "Updated description",
  "agent": "aider"
}
```

**Response 200:** Updated task object.

---

### DELETE /api/tasks/:id

Delete a task and all associated data (cascade).

**Response 204:** No content.

---

### GET /api/tasks/:id/events

Get the ACP event stream for a task.

**Response 200:**
```json
[
  {
    "id": "uuid",
    "task_id": "uuid",
    "type": "thought",
    "content": "Analyzing the codebase...",
    "created_at": "2026-02-28T10:01:00Z"
  }
]
```

Event types: `thought` | `action` | `await_input` | `result`

---

## WebSocket

### ws://localhost:3000/ws

Connect for real-time updates. Requires auth via query parameter:

```
ws://localhost:3000/ws?token=<AGEMON_KEY>
```

The connection is closed with code `4401` if the token is missing or invalid.

**Server → Client events:**

```typescript
// Task status changed
{ "type": "task_updated", "task": { ...Task } }

// Agent emitted a thought
{ "type": "agent_thought", "taskId": "uuid", "content": "Thinking..." }

// Agent is blocked waiting for input
{ "type": "awaiting_input", "taskId": "uuid", "question": "Which library?", "inputId": "uuid" }

// Terminal output from PTY
{ "type": "terminal_output", "sessionId": "uuid", "data": "$ ls -la\n..." }
```

**Client → Server events:**

```typescript
// Answer an awaiting_input question
{ "type": "send_input", "taskId": "uuid", "inputId": "uuid", "response": "Passport.js" }

// Send keystrokes to terminal
{ "type": "terminal_input", "sessionId": "uuid", "data": "ls -la\n" }
```

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
