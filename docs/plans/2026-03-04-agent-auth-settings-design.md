# Agent Authentication & Configuration Settings — Design

**Date:** 2026-03-04
**Status:** Approved

## Problem

Agemon currently requires all agent API keys to be set as env vars before starting the server, and Claude Code / Gemini login must be run from a terminal. There is no way to configure agents from the mobile UI — defeating the mobile-first philosophy.

## Decisions

- **Key storage:** `.env` file (UI writes, server reads, hot-reloads)
- **CLI auth:** Proxy login flow (backend drives `claude /login` / `gemini login`, streams prompts to UI)
- **Detection:** Auto-detect binaries on PATH via `Bun.which()`
- **Default agent:** Configurable in Settings, stored in `.env`

## Storage

The project-root `.env` file stores all agent config:

```
OPENCODE_API_KEY=sk-...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
DEFAULT_AGENT=claude-code
```

- Backend reads `.env` on startup
- Settings UI writes via `POST /api/agents/config` — backend writes `.env` and hot-reloads `process.env`
- API keys are never sent to the frontend in full — only masked (`sk-...xxxx`)
- No DB schema changes

## Backend API

### `GET /api/agents/status`

Returns all supported agents with detection and auth status:

```typescript
interface AgentStatusResponse {
  defaultAgent: AgentType;
  agents: Array<{
    type: AgentType;
    label: string;
    detected: boolean;
    authMethod: 'login' | 'api_key';
    authStatus: 'authenticated' | 'configured' | 'not_configured' | 'unknown';
    requiredEnvVars: string[];
    configuredVars?: Record<string, string>; // masked values
    installUrl: string;
  }>;
}
```

**Auth status logic:**
- `api_key` agents: check env vars non-empty → `configured` / `not_configured`
- `login` agents: lightweight health-check (e.g. `claude --version`) → `authenticated` / `not_authenticated` / `unknown`

### `POST /api/agents/config`

Save API keys and default agent. Writes to `.env`, hot-reloads.

```typescript
interface AgentConfigRequest {
  defaultAgent?: AgentType;
  envVars?: Record<string, string>; // e.g. { OPENAI_API_KEY: "sk-..." }
}
```

### `POST /api/agents/:type/login`

Start proxy login flow for Claude Code or Gemini.

## Proxy Login Flow

For agents requiring interactive login (`claude /login`, `gemini login`):

1. Frontend sends `POST /api/agents/claude-code/login`
2. Backend spawns login command with `stdin: 'pipe'`
3. Backend parses stdout, extracts URLs and prompts
4. Backend streams to frontend via WebSocket as `agent_login` events:
   ```typescript
   { type: "agent_login", agentType: "claude-code", step: "url", content: "https://..." }
   { type: "agent_login", agentType: "claude-code", step: "prompt", content: "Enter the code:" }
   { type: "agent_login", agentType: "claude-code", step: "success", content: "Logged in successfully" }
   ```
5. Frontend renders guided card flow: tappable URL, prompt input, sends response via WS
6. On success, backend re-checks auth status

Scope: Claude Code and Gemini only. OpenCode/Aider use API key inputs.

## Frontend — Settings → Agents

Extends the existing Settings page with an "Agents" section:

**Layout:**
- Default agent dropdown at top
- Agent list as cards:
  - Icon + name + external link
  - Status badge: green "Detected" / red "Not detected"
  - Auth badge: green "Authenticated" / amber "Key set" / red "Not configured"
  - Configure button → expands inline config panel

**Agent config panel (expanded):**
- API key agents: masked input field with show/hide toggle, save button
- Login agents: "Login" button → inline guided card flow (no modal)
- Undetected agents: install command + docs link

**Mobile:**
- Full-width cards, 44px touch targets
- `type="password"` inputs with toggle
- Login flow cards inline, scroll naturally
