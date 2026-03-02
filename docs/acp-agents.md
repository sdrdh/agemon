# ACP Agent Integration Guide

> **Priority: HIGH** — Current `acp.ts` treats agents as simple JSONL-on-stdout processes.
> Real ACP agents use **JSON-RPC 2.0 over stdin/stdout** and require bidirectional communication.
> This must be fixed in Task 4.3 before any agent can actually work end-to-end.

---

## Protocol Overview

ACP (Agent Client Protocol) uses **JSON-RPC 2.0** over stdio (stdin/stdout). The lifecycle:

1. **Initialize** — client sends `initialize` request, agent responds with capabilities
2. **Session setup** — client sends `acp/setSessionInfo` notification
3. **Prompt turns** — client sends `acp/promptTurn` requests, agent streams responses
4. **Shutdown** — client sends `shutdown` request, then `exit` notification

All messages are newline-delimited JSON-RPC objects. Both sides can send requests and notifications.

Full spec: https://agentclientprotocol.com

---

## Supported Agents

### 1. claude-agent-acp (Claude Code)

**Binary:** `claude-agent-acp`
**Install:** `npm install -g @zed-industries/claude-agent-acp`
**Source:** https://github.com/zed-industries/claude-agent-acp

**Spawn command:**
```bash
claude-agent-acp --agent claude-code
```

**Authentication:**
- Uses `@anthropic-ai/claude-agent-sdk` internally
- Authenticates via `claude /login` session (subscription-based, NOT an API key)
- The SDK spawns `claude` CLI as a subprocess
- Third-party integrations using the Agent SDK directly should use `ANTHROPIC_API_KEY`
- For our use case (spawning the binary), users must have run `claude /login` first

**Key behaviors:**
- Calls `process.stdin.resume()` — **stdin must remain open** or the process exits immediately
- Communicates via ACP protocol (JSON-RPC 2.0) on stdin/stdout
- Outputs a session ID on startup that can be used for `--resume`
- Exits with code 0 if stdin closes (this is why our current implementation sees instant exit)

**Current issue in acp.ts:**
Our code spawns with `stdout: 'pipe'` but does NOT pipe stdin. The agent calls `process.stdin.resume()`, gets EOF on stdin, and exits immediately with code 0. We need `stdin: 'pipe'` and must implement the JSON-RPC handshake.

---

### 2. OpenCode ACP

**Binary:** `opencode`
**Install:** `go install github.com/nichochar/opencode@latest` or download from GitHub releases
**Source:** https://github.com/nichochar/opencode

**Spawn command:**
```bash
opencode acp
```

**Authentication:**
- Requires `OPENCODE_API_KEY` environment variable
- Supports multiple LLM providers (OpenAI, Anthropic, etc.) depending on key format
- Simple env var auth — no login flow needed

**Key behaviors:**
- Implements standard ACP protocol (JSON-RPC 2.0 over stdio)
- Simpler than claude-agent-acp — no subprocess spawning, direct API calls
- Stays alive as long as stdin is open
- Good candidate for initial ACP integration testing

**Integration notes:**
- Pass `OPENCODE_API_KEY` in the subprocess env (but still filter `AGEMON_KEY` and `GITHUB_PAT`)
- Should work once we implement JSON-RPC stdin/stdout communication

---

### 3. Gemini CLI ACP

**Binary:** `gemini`
**Install:** `npm install -g @anthropic-ai/gemini-cli` (or via Google's distribution)
**Source:** Google's Gemini CLI

**Spawn command:**
```bash
gemini --experimental-acp
```

**Authentication:**
- Uses Google authentication (OAuth or service account)
- User must have authenticated with `gemini login` or set `GOOGLE_API_KEY`
- No Anthropic keys needed

**Key behaviors:**
- Implements ACP protocol (JSON-RPC 2.0 over stdio)
- `--experimental-acp` flag required — ACP support is not yet stable
- Known issues in v0.18.0+ with subprocess mode
- When it works, follows standard ACP lifecycle

**Integration notes:**
- Similar to OpenCode in terms of integration complexity
- Auth is different (Google vs API key) but communication protocol is identical
- May need version pinning until ACP support stabilizes

---

## What Needs to Change in `acp.ts`

### Current (broken)
```typescript
// Spawns process but only reads stdout — no stdin, no JSON-RPC
const proc = Bun.spawn([binaryPath, '--agent', agentType], {
  stdout: 'pipe',
  stderr: 'inherit',
  env: safeEnv,
});
// Reads stdout line-by-line expecting JSONL events
// Agent exits immediately because stdin is not piped
```

### Required (Task 4.3)
```typescript
// Must pipe stdin for bidirectional JSON-RPC communication
const proc = Bun.spawn([binaryPath, '--agent', agentType], {
  stdin: 'pipe',   // <-- CRITICAL: keeps agent alive
  stdout: 'pipe',
  stderr: 'inherit',
  env: safeEnv,
});

// Must implement JSON-RPC 2.0 handshake:
// 1. Send initialize request → wait for response
// 2. Send acp/setSessionInfo notification
// 3. Send acp/promptTurn with the task description
// 4. Read streaming responses (thoughts, actions, results)
// 5. Send shutdown request when stopping
```

### JSON-RPC Message Format
```json
// Request (client → agent)
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {"name": "agemon", "version": "1.0.0"}}}

// Response (agent → client)
{"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "claude-agent-acp"}, "capabilities": {}}}

// Notification (no response expected)
{"jsonrpc": "2.0", "method": "acp/setSessionInfo", "params": {"sessionId": "..."}}

// Prompt turn
{"jsonrpc": "2.0", "id": 2, "method": "acp/promptTurn", "params": {"messages": [{"role": "user", "content": "..."}]}}
```

---

## Recommended Integration Order

1. **OpenCode** — simplest auth (env var), standard ACP, good for developing the JSON-RPC layer
2. **claude-agent-acp** — primary agent, but more complex (needs `claude /login`, subprocess architecture)
3. **Gemini CLI** — experimental flag, known issues, lowest priority

---

## Environment Variables per Agent

| Agent | Required Env Vars | Auth Method |
|-------|------------------|-------------|
| claude-agent-acp | None (uses `claude /login` session) | CLI login |
| opencode | `OPENCODE_API_KEY` | Env var |
| gemini | `GOOGLE_API_KEY` or Google OAuth | CLI login or env var |

All agents should NOT receive `AGEMON_KEY` or `GITHUB_PAT` in their environment (already filtered in current code).
