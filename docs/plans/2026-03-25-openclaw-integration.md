# OpenClaw Integration — Implementation Brief

**Branch:** `feature/openclaw-integration`
**Status:** Deferred — implementation complete, pending integration

---

## What It Is

An Agemon extension that bridges Agemon task/session events to OpenClaw via webhook. Allows OpenClaw to create Agemon tasks and receive real-time status notifications back.

---

## What's Built (on the branch)

- `extensions/openclaw-integration/` — full extension with:
  - Event listener for `task:created`, `task:updated`, `task:deleted`, `session:state_changed`
  - Webhook forwarding with configurable URL + token
  - REST API: `POST /configure`, `GET /mappings`, `DELETE /mappings/:taskId`, `GET /status`
  - Bundled skill (`skills/agemon/SKILL.md`) auto-symlinked to `~/.agemon/skills/openclaw-integration--agemon`
- Routing design: `configure` takes `{ taskId, metadata }` — metadata is opaque and forwarded verbatim so OpenClaw owns the schema
- Thread-aware routing: OpenClaw passes its `sessionKey` in metadata so notifications route back to the originating Slack thread

---

## Integration Points

- Extension loads via the standard extension system — no core changes needed
- Settings configurable via UI: `OPENCLAW_WEBHOOK_URL`, `OPENCLAW_WEBHOOK_TOKEN`
- Skill is auto-discovered by agents via the symlink on extension load

---

## Before Merging

- [ ] Test webhook delivery end-to-end with a real OpenClaw instance
- [ ] Confirm skill content is accurate against current Agemon API (especially session/task routes)
- [ ] Consider adding retry logic or dead-letter queue for failed webhook deliveries
- [ ] UI settings panel for webhook URL/token (currently env-var only)
