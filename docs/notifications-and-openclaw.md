# Notifications & OpenClaw Integration

**Status:** Proposed
**Last Updated:** March 2026

---

## 1. Overview

Agemon's mobile-first value prop depends on reaching users *instantly* when agents need attention. This document specifies a multi-gateway notification system and an OpenClaw integration that turns any chat app into a full Agemon control plane.

### Goals

1. **Push notifications** that let users unblock agents without opening the app
2. **Pluggable gateways** — Web Push, ntfy, Telegram, Discord, Slack, OpenClaw, webhooks
3. **OpenClaw as control plane** — natural language commands via any chat app
4. **First-response-wins** deduplication across gateways
5. **Zero mandatory external dependencies** — Web Push (VAPID) works out of the box

### Non-Goals (v1)

- Email notifications (too slow for agent blocking events)
- SMS gateway (cost, complexity)
- Building our own mobile app (PWA is the path)

---

## 2. Architecture

```
                          ┌──────────────────────────┐
                          │     Agemon Backend        │
                          │                           │
Agent blocks ──►          │  NotificationDispatcher   │
Agent completes ──►       │         │                 │
Agent crashes ──►         │    ┌────┴────┐            │
                          │    ▼         ▼            │
                          │  gateway   gateway  ...   │
                          └────┬─────────┬────────────┘
                               │         │
              ┌────────────────┤         ├────────────────┐
              ▼                ▼         ▼                ▼
        ┌──────────┐   ┌──────────┐  ┌────────┐   ┌──────────┐
        │ Web Push │   │ Telegram │  │  ntfy  │   │ OpenClaw │
        │ (VAPID)  │   │ Bot API  │  │        │   │          │
        └────┬─────┘   └────┬─────┘  └───┬────┘   └────┬─────┘
             │              │             │              │
             ▼              ▼             ▼              ▼
         Browser        Telegram       ntfy app      Any channel
        (Android/       inline         (Android)     (WhatsApp,
         desktop)       keyboard                      Signal, etc.)
             │              │             │              │
             └──────────────┴──────┬──────┴──────────────┘
                                   ▼
                          User responds
                                   │
                          POST /api/... (REST)
                          or OpenClaw → REST
```

### Key Design Decisions

- **Fan-out, first-response-wins:** All enabled gateways fire simultaneously. First response resolves the event; others get a "resolved" update.
- **Web Push is the default.** VAPID keys generated on first run. No accounts, no third-party services.
- **Webhook is the escape hatch.** Any gateway we don't natively support can be wired via webhook → Apprise, Home Assistant, custom scripts, etc.
- **OpenClaw is bidirectional.** It receives notifications AND sends commands back. Other gateways are notification-only (except Telegram/Discord/Slack which support inline responses).

---

## 3. Data Model

### New Tables

```sql
-- Push subscription storage (Web Push)
CREATE TABLE push_subscriptions (
  id          TEXT PRIMARY KEY,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notification gateway configuration
CREATE TABLE notification_gateways (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,  -- 'web_push' | 'telegram' | 'discord' | 'slack' | 'ntfy' | 'gotify' | 'openclaw' | 'webhook'
  name        TEXT NOT NULL,  -- user-facing label
  config      TEXT NOT NULL,  -- JSON, shape depends on type
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notification log (deduplication + audit)
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,  -- 'input_requested' | 'approval_requested' | 'task_done' | 'agent_crashed' | 'cost_alert'
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id    TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  payload       TEXT NOT NULL,  -- JSON notification payload
  resolved      INTEGER NOT NULL DEFAULT 0,
  resolved_by   TEXT,           -- gateway id that handled the response
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_notifications_task ON notifications(task_id);
CREATE INDEX idx_notifications_unresolved ON notifications(resolved) WHERE resolved = 0;
```

### Gateway Config Shapes

```typescript
// shared/types/notifications.ts

type GatewayType = 'web_push' | 'telegram' | 'discord' | 'slack' | 'ntfy' | 'gotify' | 'openclaw' | 'webhook';

interface GatewayConfigMap {
  web_push: {};  // No config needed — VAPID keys are server-level
  telegram: { botToken: string; chatId: string };
  discord: { webhookUrl: string; /* or bot token + channel */ };
  slack: { webhookUrl: string; /* or bot token + channel */ };
  ntfy: { serverUrl: string; topic: string; token?: string };
  gotify: { serverUrl: string; appToken: string };
  openclaw: { baseUrl: string; apiKey?: string };
  webhook: { url: string; headers?: Record<string, string>; method?: 'POST' | 'PUT' };
}

interface NotificationPayload {
  title: string;
  body: string;
  eventType: 'input_requested' | 'approval_requested' | 'task_done' | 'agent_crashed' | 'cost_alert';
  taskId: string;
  sessionId?: string;
  notificationId: string;  // For deduplication
  actions?: NotificationAction[];
}

interface NotificationAction {
  id: string;      // e.g. 'allow_once', 'deny', 'answer:redis'
  label: string;   // e.g. 'Approve', 'Deny', 'Redis'
}
```

---

## 4. Web Push (VAPID) — Default Gateway

### Setup (automatic on first run)

1. Server generates VAPID keypair on first boot, stores in `agemon.db` (settings table or file)
2. Frontend requests notification permission via `Notification.requestPermission()`
3. Service worker subscribes via `PushManager.subscribe({ applicationServerKey: vapidPublicKey })`
4. Subscription sent to `POST /api/push-subscriptions`

### Service Worker

```typescript
// frontend/public/sw.js

self.addEventListener('push', (event) => {
  const data = event.data?.json();
  if (!data) return;

  const options: NotificationOptions = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: data.notificationId,  // Dedup — replaces existing with same tag
    renotify: true,
    data: {
      taskId: data.taskId,
      sessionId: data.sessionId,
      notificationId: data.notificationId,
      resolveToken: data.resolveToken,  // Single-use token for auth, valid until notification is resolved
    },
  };

  // Add action buttons (Android/desktop only — iOS ignores these)
  if (data.actions?.length) {
    options.actions = data.actions.slice(0, 2).map((a) => ({
      action: a.id,
      title: a.label,
    }));
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { taskId, sessionId, notificationId } = event.notification.data;

  if (event.action) {
    // User tapped an action button — resolve without opening app.
    // Auth: notification resolve endpoint uses a short-lived, single-use
    // token embedded in the push payload (NOT the long-lived AGEMON_KEY).
    // The server generates this token when dispatching the notification
    // and stores its hash in the notifications table. Token expires after
    // 10 minutes or first use, whichever comes first.
    const { resolveToken } = event.notification.data;
    event.waitUntil(
      fetch(`/api/notifications/${notificationId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: event.action, token: resolveToken }),
      })
    );
  } else {
    // Default tap — open task detail
    event.waitUntil(
      clients.openWindow(`/tasks/${taskId}`)
    );
  }
});
```

### Platform Behavior

| Platform | Push | Action Buttons | Install Requirement |
|----------|------|---------------|---------------------|
| Android Chrome | Yes | Yes (2 max) | None |
| Desktop Chrome/Firefox/Edge | Yes | Yes | None |
| iOS Safari 16.4+ | Yes | **No** (ignored) | Must "Add to Home Screen" first |
| iOS Safari <16.4 | No | No | N/A |

**iOS fallback:** Notification tap opens the app to `/tasks/{id}/respond` — a minimal purpose-built response screen that loads in <500ms.

---

## 5. Telegram Gateway

Telegram has the best inline keyboard support of any chat platform. Users respond to agents directly in Telegram without opening Agemon.

### Setup

1. User creates a Telegram bot via @BotFather
2. User messages the bot to get their `chatId`
3. User adds gateway in Agemon settings: bot token + chat ID

### Notification with Inline Keyboard

```typescript
// backend/src/lib/gateways/telegram.ts

async function sendTelegramNotification(config: TelegramConfig, payload: NotificationPayload) {
  const message = `*${escapeMarkdown(payload.title)}*\n\n${escapeMarkdown(payload.body)}`;

  const inlineKeyboard = payload.actions?.length
    ? {
        inline_keyboard: [
          payload.actions.map((a) => ({
            text: a.label,
            callback_data: JSON.stringify({ nid: payload.notificationId, action: a.id }),
          })),
        ],
      }
    : undefined;

  await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: message,
      parse_mode: 'MarkdownV2',
      reply_markup: inlineKeyboard,
    }),
  });
}
```

### Receiving Responses

Agemon runs a lightweight Telegram webhook receiver (or polls via `getUpdates`).

The webhook URL is **per-gateway** so multiple Telegram bots can be configured independently. When a gateway is created, Agemon calls Telegram's `setWebhook` with the gateway-specific URL.

```typescript
// Webhook: Telegram POSTs callback_query when user taps inline button.
// URL includes gateway_id so we can look up the correct bot token.
app.post('/api/gateways/telegram/webhook/:gatewayId', async (c) => {
  const gatewayId = c.req.param('gatewayId');
  const gateway = db.getGateway(gatewayId);
  if (!gateway || gateway.type !== 'telegram') return c.json({ error: 'Not found' }, 404);

  const config = gateway.config as TelegramConfig;
  const update = await c.req.json();

  if (update.callback_query) {
    const { nid, action } = JSON.parse(update.callback_query.data);
    await resolveNotification(nid, action, gatewayId);

    // Acknowledge to Telegram + update message
    await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: update.callback_query.id,
        text: 'Done!',
      }),
    });
  }
});
```

---

## 6. ntfy / Gotify / Webhook Gateways

These are simpler — notification-only, no inline responses.

### ntfy

```typescript
async function sendNtfyNotification(config: NtfyConfig, payload: NotificationPayload) {
  await fetch(`${config.serverUrl}/${config.topic}`, {
    method: 'POST',
    headers: {
      'Title': payload.title,
      'Priority': payload.eventType === 'agent_crashed' ? '5' : '3',
      'Tags': payload.eventType,
      'Click': `${agemonBaseUrl}/tasks/${payload.taskId}`,
      ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
    },
    body: payload.body,
  });
}
```

### Webhook (generic)

```typescript
async function sendWebhookNotification(config: WebhookConfig, payload: NotificationPayload) {
  await fetch(config.url, {
    method: config.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: JSON.stringify(payload),
  });
}
```

The webhook gateway is the universal escape hatch. Users can wire it to Apprise, Home Assistant, custom scripts, or any service that accepts HTTP.

---

## 7. OpenClaw Integration

OpenClaw is not just a notification gateway — it's a **bidirectional control plane**. Users talk to OpenClaw in natural language on any chat app, and OpenClaw operates Agemon's REST API on their behalf.

### 7.1 Architecture

```
User (WhatsApp/Signal/Telegram/Discord/iMessage/...)
  │
  ▼
OpenClaw (self-hosted)
  │
  ├── Receives natural language
  ├── Maps to Agemon API calls via "agemon" skill
  ├── Executes REST calls against Agemon
  └── Returns formatted results to user
  │
  ▼
Agemon Backend (REST API)
  │
  ├── Processes request
  ├── Returns result
  └── Pushes events via webhook to OpenClaw
```

### 7.2 OpenClaw Skill Definition

OpenClaw uses skill files to understand external APIs. Agemon ships an OpenClaw skill definition:

```yaml
# openclaw-skill/agemon.yaml
name: agemon
description: |
  Manage AI coding agent tasks. You can create tasks, start/stop agent sessions,
  respond to agent questions, approve diffs, and create pull requests.
version: 1.0.0
api_base: "${AGEMON_URL}"  # e.g. http://localhost:3000
auth:
  type: bearer
  token: "${AGEMON_KEY}"

capabilities:
  - name: list_tasks
    description: List all tasks, optionally filtered by status
    method: GET
    path: /api/tasks
    params:
      - name: status
        in: query
        type: string
        enum: [todo, working, awaiting_input, done]
        required: false

  - name: get_status_overview
    description: Get a quick overview of what's happening — running tasks, blocked tasks, recent completions
    method: GET
    path: /api/status

  - name: create_task
    description: Create a new task with a title, description, and optional repos
    method: POST
    path: /api/tasks
    body:
      title: string (required)
      description: string
      repos: string[] (repo URLs)

  - name: start_session
    description: Start an agent session on a task
    method: POST
    path: /api/tasks/{taskId}/sessions
    body:
      agentType: string (required) — e.g. "claude-code", "opencode", "goose"
      name: string — optional display name

  - name: send_prompt
    description: Send the initial prompt or a follow-up message to a running session
    method: POST
    path: /api/tasks/{taskId}/sessions/{sessionId}/prompt
    body:
      text: string (required)

  - name: respond_to_input
    description: Answer a question the agent is waiting on
    method: POST
    path: /api/tasks/{taskId}/sessions/{sessionId}/input
    body:
      response: string (required)

  - name: resolve_approval
    description: Approve or deny a tool use the agent is requesting
    method: POST
    path: /api/tasks/{taskId}/sessions/{sessionId}/approval
    body:
      decision: string (required) — "allow_once" | "allow_always" | "deny"

  - name: stop_session
    description: Stop a running agent session
    method: POST
    path: /api/tasks/{taskId}/sessions/{sessionId}/stop

  - name: get_diff_summary
    description: Get a human-readable summary of changes in a task
    method: GET
    path: /api/tasks/{taskId}/diff-summary

  - name: mark_done
    description: Mark a task as done
    method: PATCH
    path: /api/tasks/{taskId}
    body:
      status: "done"

  - name: get_cost
    description: Get token usage and estimated cost for a task
    method: GET
    path: /api/tasks/{taskId}/cost

examples:
  - user: "what's running"
    action: list_tasks with status=working

  - user: "start auth task on backend with claude"
    action: create_task + start_session

  - user: "what does it need"
    action: list_tasks with status=awaiting_input

  - user: "use redis"
    action: respond_to_input

  - user: "approve it"
    action: resolve_approval with decision=allow_once

  - user: "how much has it cost"
    action: get_cost

  - user: "stop everything"
    action: stop all running sessions
```

### 7.3 Webhook Registration (Agemon → OpenClaw)

OpenClaw registers a webhook so Agemon pushes events proactively instead of OpenClaw polling:

```
POST /api/webhooks
{
  "url": "http://localhost:3200/hooks/agemon",
  "events": ["input_requested", "approval_requested", "task_done", "agent_crashed", "cost_alert"],
  "secret": "hmac-secret-for-verification"
}
```

When an event fires, Agemon POSTs:

```json
{
  "event": "input_requested",
  "timestamp": "2026-03-08T14:30:00Z",
  "task": { "id": "abc", "title": "Add auth" },
  "session": { "id": "def", "agentType": "claude-code" },
  "data": {
    "question": "Which session store — Redis or SQLite?",
    "notificationId": "notif-123"
  },
  "signature": "hmac-sha256-of-body"
}
```

OpenClaw receives this, formats it for the user's chat channel, and sends it with inline response options.

### 7.4 New API Endpoints (Required)

These endpoints don't exist yet and are needed for the OpenClaw integration:

#### `GET /api/status` — Quick overview

```json
{
  "running": 2,
  "blocked": 1,
  "done_today": 3,
  "total_cost_today": "$4.23",
  "tasks": [
    { "id": "abc", "title": "Add auth", "status": "awaiting_input", "agent": "claude-code" },
    { "id": "def", "title": "Fix tests", "status": "working", "agent": "opencode" }
  ]
}
```

#### `GET /api/tasks/{id}/diff-summary` — Summarized diff

Returns a concise human-readable summary of changes instead of raw diff content. Suitable for chat messages.

```json
{
  "taskId": "abc",
  "summary": "Changed 4 files: added JWT middleware (src/middleware/auth.ts), updated 3 route handlers to require auth, added 12 tests",
  "filesChanged": 4,
  "insertions": 187,
  "deletions": 12
}
```

#### `GET /api/tasks/{id}/cost` — Token usage and cost

```json
{
  "taskId": "abc",
  "sessions": [
    {
      "sessionId": "def",
      "agentType": "claude-code",
      "inputTokens": 45200,
      "outputTokens": 12300,
      "estimatedCost": "$1.84"
    }
  ],
  "totalCost": "$1.84"
}
```

#### `POST /api/webhooks` — Register webhook

#### `DELETE /api/webhooks/{id}` — Remove webhook

#### `POST /api/notifications/{id}/resolve` — Resolve notification from any gateway

---

## 8. Notification Dispatcher

The central dispatcher fans out to all enabled gateways and handles deduplication.

```typescript
// backend/src/lib/notifications.ts

interface NotificationGateway {
  type: GatewayType;
  send(payload: NotificationPayload): Promise<void>;
  supportsActions: boolean;
}

class NotificationDispatcher {
  private gateways: Map<string, NotificationGateway> = new Map();

  async dispatch(event: AgemonEvent): Promise<void> {
    const payload = this.buildPayload(event);

    // Store notification for dedup tracking
    const notificationId = db.createNotification(payload);
    payload.notificationId = notificationId;

    // Fan out to all enabled gateways
    const enabledGateways = db.getEnabledGateways();
    const results = await Promise.allSettled(
      enabledGateways.map((gw) => {
        const gateway = this.gateways.get(gw.type);
        if (!gateway) return Promise.resolve();

        // Strip actions for gateways that don't support them
        const gwPayload = gateway.supportsActions
          ? payload
          : { ...payload, actions: undefined };

        return gateway.send(gwPayload);
      })
    );

    // Log failures
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[notify] ${enabledGateways[i].type} failed:`, r.reason);
      }
    });
  }

  async resolve(notificationId: string, action: string, gatewayId: string): Promise<void> {
    const notification = db.getNotification(notificationId);
    if (!notification || notification.resolved) return;  // Already handled

    db.resolveNotification(notificationId, gatewayId);

    // Route the action to the appropriate handler
    switch (notification.eventType) {
      case 'input_requested':
        await respondToInput(notification.sessionId, action);
        break;
      case 'approval_requested':
        await resolveApproval(notification.sessionId, action as ApprovalDecision);
        break;
    }
  }

  private buildPayload(event: AgemonEvent): NotificationPayload {
    switch (event.type) {
      case 'input_requested':
        return {
          title: `Agent blocked: ${event.task.title}`,
          body: truncate(event.data.question, 120),
          eventType: 'input_requested',
          taskId: event.task.id,
          sessionId: event.session.id,
          notificationId: '',  // Set after DB insert
          actions: event.data.suggestedAnswers?.slice(0, 2).map((a) => ({
            id: `answer:${a}`,
            label: a,
          })),
        };

      case 'approval_requested':
        return {
          title: `Approval needed: ${event.task.title}`,
          body: truncate(event.data.description, 120),
          eventType: 'approval_requested',
          taskId: event.task.id,
          sessionId: event.session.id,
          notificationId: '',
          actions: [
            { id: 'allow_once', label: 'Approve' },
            { id: 'deny', label: 'Deny' },
          ],
        };

      case 'task_done':
        return {
          title: `Task complete: ${event.task.title}`,
          body: event.data.summary ?? 'Agent finished successfully.',
          eventType: 'task_done',
          taskId: event.task.id,
          notificationId: '',
        };

      case 'agent_crashed':
        return {
          title: `Agent crashed: ${event.task.title}`,
          body: `${event.session.agentType} exited with code ${event.data.exitCode}`,
          eventType: 'agent_crashed',
          taskId: event.task.id,
          sessionId: event.session.id,
          notificationId: '',
        };
    }
  }
}
```

---

## 9. Frontend: Notification Settings UI

### Settings Page

Add a "Notifications" section to Settings:

- **Web Push** — toggle on/off, shows permission status
- **Add Gateway** button — opens modal to configure Telegram, ntfy, Discord, etc.
- **Gateway list** — shows configured gateways with enable/disable toggle and test button
- **OpenClaw** — special section with setup instructions + connection status

### Gateway Setup Flow

1. User taps "Add Gateway"
2. Selects type (Telegram, ntfy, Discord, etc.)
3. Fills in config (bot token, server URL, etc.)
4. Taps "Test" — sends a test notification
5. If test succeeds, saves gateway

---

## 10. Security Considerations

- **Gateway configs contain secrets** (bot tokens, API keys). Store encrypted in SQLite or at minimum ensure DB file permissions are restrictive.
- **Webhook endpoints** must verify HMAC signatures to prevent spoofing.
- **Telegram webhook** should validate the `X-Telegram-Bot-Api-Secret-Token` header.
- **OpenClaw auth** — if OpenClaw is on the same machine, localhost-only binding is sufficient. If remote, require API key.
- **Web Push subscriptions** are per-browser, not per-user. Since Agemon is single-user, this is fine. The subscription endpoint URL itself is a capability — don't log it.
- **Service worker auth** — the notification resolve endpoint does NOT use the long-lived `AGEMON_KEY`. Instead, each push payload includes a single-use `resolveToken` generated by the server. The server stores the token hash in the `notifications` table. The token is valid until the notification is resolved or the task is deleted — there is no fixed time limit. This is safe because Web Push payloads are E2E encrypted (P256DH + auth keys); only the subscribed browser can decrypt the payload, making token interception infeasible. When an already-resolved notification's action button is tapped, the server returns `409 Already resolved` rather than silently failing. This avoids storing secrets in the service worker's global scope.
- **Telegram webhook URLs** are per-gateway (`/api/gateways/telegram/webhook/{gatewayId}`) so each bot's token is looked up from the database, not stored globally. Additionally, Telegram's `secret_token` parameter should be set when calling `setWebhook` and validated via the `X-Telegram-Bot-Api-Secret-Token` header on incoming requests.

---

## 11. Migration Path from Task 8.4

Task 8.4 currently includes "implement push notifications" as a bullet point. This document supersedes that with a full notification system. Task 8.4 should be updated to reference Phase 9 instead.
