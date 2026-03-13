# Agent Settings: Detection, Login Status, and Flat-File Defaults

**Date:** 2026-03-04
**Status:** Approved

## Problem

Agemon has a basic settings page, but it does not yet expose agent-specific status or defaults. Users need to know:

- whether each supported agent exists on the machine
- whether the agent appears logged in or otherwise usable
- what command to run next if the agent is missing or not authenticated
- which agent/model/mode Agemon should prefer by default for new work

The earlier `.env`-writing and proxy-login concept is no longer the right direction. This work should stay read-only with respect to external agent authentication and should use a small Agemon-owned flat file for Agemon defaults only.

## Decisions

- **Detection:** Detect agent binaries on PATH via `Bun.which()` using the same expanded PATH logic already used for agent launch
- **Login/auth state:** Use read-only readiness checks only; do not attempt login from the UI
- **Defaults storage:** Store Agemon-owned defaults in a flat file under `~/.agemon/`
- **UI behavior:** Settings reports status and instructions; users complete install/login in their own terminal

## Goals

- Show install and login/readiness status for each supported agent in Settings
- Give users copyable install/auth instructions per agent
- Let users set Agemon defaults for agent/model/mode without touching `.env`
- Apply those defaults automatically to new sessions unless the user overrides them

## Non-Goals

- No API key entry UI
- No `.env` editor in Settings
- No proxy login flow driven through Agemon
- No persisted cache of machine-derived status beyond transient request-time computation

## Storage

Agemon should own a small JSON settings file under `~/.agemon/`, for example:

```json
{
  "defaultAgent": "claude-code",
  "agentDefaults": {
    "claude-code": {
      "model": "sonnet",
      "mode": "default"
    },
    "opencode": {
      "model": "gpt-5",
      "mode": "build"
    }
  }
}
```

- This file stores Agemon preferences only
- It does not store API keys or login tokens for external tools
- Missing file should be treated as "use built-in defaults"
- Invalid values should be ignored with a safe fallback rather than breaking session creation

Recommended path:

- `~/.agemon/settings.json`

## Backend API

### `GET /api/agents/status`

Returns supported agents with live install and readiness status, plus the current Agemon defaults:

```typescript
interface AgentStatusResponse {
  defaultAgent: AgentType;
  agentDefaults: Partial<Record<AgentType, {
    model?: string;
    mode?: string;
  }>>;
  agents: Array<{
    type: AgentType;
    label: string;
    detected: boolean;
    missingBinaries: string[];
    loginStatus: 'logged_in' | 'not_logged_in' | 'unknown';
    authCheckKind: 'env' | 'cli' | 'hybrid';
    installInstructions: string[];
    authInstructions: string[];
    notes?: string[];
  }>;
}
```

Detection logic:

- installation status is derived from required binaries present on PATH
- login status is derived from agent-specific read-only checks
- if detection is ambiguous, return `unknown` instead of guessing

Suggested read-only login/readiness checks:

- `claude-code`: detect required launch binary plus a Claude CLI login/readiness signal if available
- `opencode`: env-based readiness check for required API key
- `aider`: env-based readiness check for supported API key presence
- `gemini`: CLI or env-based readiness check depending on supported local auth flow

### `PUT /api/settings/agents`

Persist Agemon-owned defaults to the flat-file settings store.

```typescript
interface UpdateAgentSettingsRequest {
  defaultAgent?: AgentType;
  agentDefaults?: Partial<Record<AgentType, {
    model?: string;
    mode?: string;
  }>>;
}
```

Behavior:

- validate agent type keys
- store only Agemon preferences
- do not echo or mutate external secrets

## Backend Implementation Notes

- Extend `AgentConfig` with metadata needed for detection and instructions:
  - `requiredBinaries`
  - `installInstructions`
  - `authCheckKind`
  - `authInstructions`
- Keep the detection logic close to existing agent-launch configuration so status and spawn behavior do not drift apart
- Reuse the existing expanded PATH logic from `backend/src/lib/agents.ts`
- Flat-file read/write should be encapsulated in a small backend settings helper rather than scattered through routes
- If the settings file is missing or malformed, log a warning and continue with defaults

## Frontend — Settings → Agents

Settings should be restructured into:

- Appearance
- Agents
- Updates
- About

The Agents section should include:

- Default agent dropdown at top
- Optional default model/mode controls for agents that expose those options
- Agent list as cards:
  - icon + name
  - install badge: "Installed" / "Missing"
  - login badge: "Logged in" / "Not logged in" / "Unknown"
  - short explanation if status is unknown
  - install/auth instructions

Mobile requirements:

- Full-width cards, 44px touch targets
- avoid modal-heavy flows
- keep instructions copyable and readable on narrow screens

## Session and Task Behavior

- New sessions should inherit the configured default agent/model/mode when the user has not specified an override
- Existing per-task or per-session explicit choices should continue to win over global defaults
- If a saved default is not valid for the selected agent, fall back safely and surface the current available options in the UI

## Testing

- Backend tests for:
  - binary detection and missing-binary reporting
  - login status mapping for env-based and CLI-based checks
  - settings file read/write and malformed-file fallback
- Frontend tests for:
  - installed/missing status cards
  - logged-in/not-logged-in/unknown badge states
  - default selection save/load behavior
