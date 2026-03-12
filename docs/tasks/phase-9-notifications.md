## Phase 9: Notifications & OpenClaw Integration

**Goal:** Multi-gateway push notifications with actionable responses, plus OpenClaw integration for natural-language agent control from any chat app.

**Design Doc:** [`docs/notifications-and-openclaw.md`](docs/notifications-and-openclaw.md)

---

### Task 9.1: PWA Foundation & Web Push (VAPID)

**Priority:** P0 (Foundation for all notifications)
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Generate VAPID keypair on first server boot, store in DB
- [ ] Add `GET /api/push/vapid-key` endpoint (public key)
- [ ] Create PWA manifest (`manifest.json`) with icons, theme, display: standalone
- [ ] Write service worker with push event handler and notification click routing
- [ ] Add `POST /api/push-subscriptions` endpoint to store browser subscriptions
- [ ] Frontend: notification permission prompt + subscription flow
- [ ] Service worker action buttons (approve/deny) for Android/desktop
- [ ] iOS fallback: tap-to-open routes to `/tasks/{id}/respond` minimal screen

**Acceptance Criteria:**
- "Add to Home Screen" works on iOS and Android
- Push notification appears on Android when agent blocks
- Tapping action button resolves the blocker without opening app (Android/desktop)
- iOS tap opens task respond screen
- VAPID keys persist across server restarts
- Works over Tailscale/exe.dev HTTPS

**Dependencies:** None (can start immediately)

---

### Task 9.2: Notification Dispatcher & Data Model

**Priority:** P0
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Create `push_subscriptions`, `notification_gateways`, `notifications` tables (see design doc)
- [ ] Write `NotificationDispatcher` class with fan-out and first-response-wins dedup
- [ ] Add `POST /api/notifications/{id}/resolve` endpoint
- [ ] Wire dispatcher into ACP event handlers (input_requested, approval_requested, task_done, agent_crashed)
- [ ] Add notification log queries for frontend (list, mark read)
- [ ] Payload builder with smart context extraction (question text, suggested answers, tool names)

**Acceptance Criteria:**
- Notification created in DB when agent blocks/crashes/completes
- Fan-out sends to all enabled gateways simultaneously
- First response resolves; subsequent responses are no-ops
- Notification log queryable via API

**Dependencies:** Task 9.1

---

### Task 9.3: Notification Settings UI

**Priority:** P1
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Settings page: "Notifications" section with Web Push toggle
- [ ] "Add Gateway" modal — type selector + config form per gateway type
- [ ] Gateway list with enable/disable toggle and "Send Test" button
- [ ] `POST /api/gateways` / `PATCH /api/gateways/{id}` / `DELETE /api/gateways/{id}` endpoints
- [ ] `POST /api/gateways/{id}/test` — sends test notification through specific gateway
- [ ] Mobile-friendly layout (bottom sheet for gateway config on small screens)

**Acceptance Criteria:**
- User can add, configure, test, enable/disable, and remove gateways from Settings
- Test button sends a real notification and shows success/failure
- Gateway secrets are never returned in GET responses (write-only)
- Works on mobile

**Dependencies:** Task 9.2

---

### Task 9.4: Telegram Gateway

**Priority:** P1
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Telegram gateway implementation (send notification with inline keyboard)
- [ ] Setup wizard in UI: link to @BotFather, chat ID detection, test message
- [ ] Callback query handler: `POST /api/gateways/telegram/webhook` or polling via `getUpdates`
- [ ] Message update after resolution (edit original message to show "Resolved ✓")
- [ ] Markdown formatting for code snippets in agent questions

**Acceptance Criteria:**
- Agent blocker appears in Telegram with inline buttons
- Tapping button in Telegram unblocks the agent
- Resolved notification is updated in-place (not duplicated)
- Works with self-hosted Telegram Bot API (optional)

**Dependencies:** Task 9.2

---

### Task 9.5: ntfy, Gotify & Webhook Gateways

**Priority:** P2
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] ntfy gateway: POST to topic with title, priority, tags, click URL
- [ ] Gotify gateway: POST message with priority mapping
- [ ] Generic webhook gateway: POST JSON payload to arbitrary URL with configurable headers
- [ ] Config forms in Settings UI for each gateway type
- [ ] Priority mapping: `agent_crashed` → urgent, `input_requested` → high, `task_done` → normal

**Acceptance Criteria:**
- ntfy notification appears in ntfy app with correct priority and click-through URL
- Gotify message appears in Gotify web UI and Android app
- Webhook delivers correct JSON payload to configured endpoint
- All three gateways pass test notification flow

**Dependencies:** Task 9.2

---

### Task 9.6: Discord & Slack Gateways

**Priority:** P2
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Discord gateway: webhook with embeds + Button components (requires bot for interactions)
- [ ] Slack gateway: webhook with Block Kit + button actions
- [ ] Interaction endpoints for receiving button clicks from Discord/Slack
- [ ] Config forms in Settings UI

**Acceptance Criteria:**
- Discord embed shows agent question with action buttons
- Slack message shows Block Kit with approve/deny buttons
- Button responses resolve the notification in Agemon

**Dependencies:** Task 9.2

---

### Task 9.7: Webhook Registration API

**Priority:** P1
**Estimated Time:** 4 hours

**Deliverables:**
- [ ] `webhooks` table: id, url, events (JSON array), secret, enabled, created_at
- [ ] `POST /api/webhooks` — register webhook with URL, events filter, HMAC secret
- [ ] `DELETE /api/webhooks/{id}` — remove webhook
- [ ] `GET /api/webhooks` — list registered webhooks
- [ ] Webhook delivery on events: POST JSON with HMAC-SHA256 signature in `X-Agemon-Signature` header
- [ ] Retry with exponential backoff (3 attempts, then disable webhook)

**Acceptance Criteria:**
- External services can register for specific event types
- Webhook payloads include HMAC signature for verification
- Failed webhooks retry 3 times then auto-disable with warning in logs
- OpenClaw can register as a webhook consumer

**Dependencies:** Task 9.2

---

### Task 9.8: New API Endpoints for OpenClaw

**Priority:** P1
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] `GET /api/status` — quick overview (running/blocked/done counts, cost today, task list)
- [ ] `GET /api/tasks/{id}/diff-summary` — human-readable change summary (files changed, insertions, deletions, description)
- [ ] `GET /api/tasks/{id}/cost` — token usage and estimated cost per session
- [ ] Ensure all error responses are structured JSON (no HTML, no stack traces)
- [ ] Verify all existing endpoints return consistent error shapes

**Acceptance Criteria:**
- `/api/status` returns a concise overview suitable for a chat message
- `/api/tasks/{id}/diff-summary` returns a 1-2 sentence summary, not raw diff
- `/api/tasks/{id}/cost` returns per-session and total cost estimates
- All 4xx/5xx responses are `{ "error": "message" }` JSON

**Dependencies:** Task 4.19 (token usage tracking) for cost endpoint; others independent

---

### Task 9.9: OpenClaw Skill & Integration

**Priority:** P1
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Ship `openclaw-skill/agemon.yaml` skill definition file in repo
- [ ] OpenClaw gateway in notification dispatcher (sends to OpenClaw's webhook/API)
- [ ] OpenClaw setup wizard in Settings UI: base URL, connection test, skill install instructions
- [ ] Documentation: step-by-step OpenClaw setup guide
- [ ] Test end-to-end: create task via WhatsApp → agent runs → respond to blocker via WhatsApp → approve via WhatsApp

**Acceptance Criteria:**
- User can install the Agemon skill in OpenClaw
- Natural language commands via any OpenClaw channel (WhatsApp, Telegram, Signal, etc.) control Agemon
- Agent blockers appear in user's preferred chat app with response options
- Full task lifecycle works without opening Agemon web UI
- Setup guide is clear enough for a non-expert to follow

**Dependencies:** Task 9.7 (webhooks), Task 9.8 (new endpoints)

---

### Phase 9 Summary

| Task | Priority | Hours | Depends On |
|------|----------|-------|------------|
| 9.1 PWA & Web Push | P0 | 10 | None |
| 9.2 Dispatcher & Data Model | P0 | 8 | 9.1 |
| 9.3 Settings UI | P1 | 6 | 9.2 |
| 9.4 Telegram | P1 | 6 | 9.2 |
| 9.5 ntfy/Gotify/Webhook | P2 | 6 | 9.2 |
| 9.6 Discord/Slack | P2 | 6 | 9.2 |
| 9.7 Webhook Registration | P1 | 4 | 9.2 |
| 9.8 OpenClaw API Endpoints | P1 | 6 | 4.19 |
| 9.9 OpenClaw Skill | P1 | 8 | 9.7, 9.8 |
| **Total** | | **60h** | |

**Parallelization:** After 9.2, tasks 9.3–9.7 can all run in parallel. 9.8 can start independently (only depends on existing task infrastructure + 4.19). 9.9 is the final integration task.

```
9.1 (PWA + Web Push)
 └─► 9.2 (Dispatcher)
      ├─► 9.3 (Settings UI)      ─┐
      ├─► 9.4 (Telegram)          │
      ├─► 9.5 (ntfy/Gotify/WH)   ├── all parallel
      ├─► 9.6 (Discord/Slack)     │
      └─► 9.7 (Webhooks)         ─┘──► 9.9 (OpenClaw)
                                        ▲
9.8 (New API endpoints) ───────────────┘
```

---
