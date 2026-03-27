# ACP Agent Integration Guide

> ACP (Agent Client Protocol) is the session engine powering Agemon. JSON-RPC 2.0 over stdin/stdout is fully implemented in `backend/src/lib/acp/`.

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
- Exits with code 0 if stdin closes

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
- Pass `OPENCODE_API_KEY` in the subprocess env

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

## Implementation Status

The ACP JSON-RPC 2.0 session engine is fully implemented in `backend/src/lib/acp/`:

| Component | File | Status |
|-----------|------|--------|
| Process spawning + stdin/stdout | `lifecycle.ts` | ✅ Implemented |
| JSON-RPC handshake (`initialize` → `session/new`) | `handshake.ts` | ✅ Implemented |
| Prompt turns (`session/prompt`) | `prompt.ts` | ✅ Implemented |
| Session resume (`session/load`) | `resume.ts` | ✅ Implemented |
| Event stream parsing | `event-log.ts` | ✅ Implemented |
| Event log (JSONL) | `event-log.ts` | ✅ Implemented |
| Auto-resume on startup | `lifecycle.ts` | ✅ Implemented |
| Approval handling | `lifecycle.ts` | ✅ Implemented |
| Turn cancellation | `prompt.ts` | ✅ Implemented |

### JSON-RPC Message Format (reference)
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

## Agent Support Status

| Agent | Auth | Notes |
|-------|------|-------|
| claude-agent-acp | CLI login (`claude /login`) | Primary agent; subprocess-based SDK |
| opencode | `OPENCODE_API_KEY` | Simplest integration; env var auth |
| gemini | `GOOGLE_API_KEY` / OAuth | Experimental `--experimental-acp` flag |

---

## Environment Variables per Agent

| Agent | Required Env Vars | Auth Method |
|-------|------------------|-------------|
| claude-agent-acp | None (uses `claude /login` session) | CLI login |
| opencode | `OPENCODE_API_KEY` | Env var |
| gemini | `GOOGLE_API_KEY` or Google OAuth | CLI login or env var |

Agent subprocess environments inherit the machine's git/SSH credentials. No special env var handling is needed for GitHub access.
