# Reference Repo Analysis & Improvement Recommendations

Analysis of [Shelley](https://github.com/boldsoftware/shelley), [Pi-mono](https://github.com/badlogic/pi-mono), and [OpenClaw](https://github.com/openclaw/openclaw) — compared against Agemon's architecture to identify integration opportunities and harness patterns worth adopting.

## TL;DR — Harness Patterns

| # | Pattern | Action | Priority |
|---|---------|--------|----------|
| 1 | **LF-only JSONL framing** | Audit `backend/src/lib/jsonrpc.ts` — replace readline with LF-only buffer split | P2 |
| 2 | **WS event sequencing & replay** | Add `seq` to `ServerEvent`, ring buffer on server, `resume` client event — see `docs/plans/2026-03-12-offline-behaviour-design.md` | P1 |
| 3 | **Steering & follow-up queues** | Add `steer` / `follow_up` ClientEvent types; steer = cancel + new prompt via ACP | P2 |
| 4 | **Distillation / context compaction** | Track token usage per session; auto-compact on overflow using Shelley's operational briefing format | P2 |
| 5 | **Mock ACP agent for testing** | Build `scripts/mock-acp-agent.ts` implementing ACP handshake + scripted responses | P2 |
| 6 | **Agent type registry** | Create `backend/src/lib/agents/registry.ts` with `AgentDriver` interface; makes `agent` DB field functional | P2 |
| 7 | **In-memory session cache** | Cache hot session data in front of `db/client.ts`; write-through to SQLite | P3 |
| 8 | **Separated tool output** | Extend `acp_events` with `display_content`; prefer it in UI over raw LLM content | P3 |
| 9 | **Per-tool UI components** | Add `ToolCallCard` + specialized `BashTool`/`PatchTool` components to chat UI; two-state (running/complete) collapsible cards with execution time — see "UI Patterns" section below | P2 |

Full details for each pattern below.

---

## Repo Overview

| Aspect | **Shelley** | **Pi-mono** | **OpenClaw** | **Agemon** |
|--------|------------|-------------|-------------|-----------|
| **Purpose** | Coding agent for exe.dev | CLI coding agent + SDK | Personal AI assistant (25+ channels) | Headless task orchestration |
| **Language** | Go | TypeScript (ESM) | TypeScript (ESM) | TypeScript (Bun) |
| **DB** | SQLite + sqlc | JSONL files | SQLite | bun:sqlite |
| **Real-time** | SSE | RPC over stdio (JSONL) | WebSocket (EventFrame) | WebSocket |
| **Agent model** | In-process LLM calls | In-process agent loop | ACP over stdio + Gateway WS | ACP over stdio |
| **Git worktrees** | No (single CWD) | No (manual) | No | Yes (per-task) |
| **Multi-agent** | Parent-child conversations | Single session | Multi-session, channel-scoped | Multiple sessions per task |
| **Task queue** | No | No | No | Yes |
| **UI** | React (embedded in Go binary) | Terminal TUI | Web + iOS + macOS + Android | Mobile-first React web |

---

## Harness Patterns Worth Adopting

### 1. Strict LF-Only JSONL Framing

**Source:** Pi-mono (`packages/coding-agent/src/modes/rpc/jsonl.ts`)

**Problem:** Node's `readline` splits on Unicode line separators (U+2028, U+2029) which can appear inside JSON string values. This causes silent parse failures in ACP stdio communication.

**Pattern:**
```typescript
// WRONG — readline splits on U+2028/U+2029 inside JSON strings
const rl = readline.createInterface({ input: process.stdin });

// RIGHT — LF-only splitting
function attachJsonlLineReader(stream: ReadableStream, onLine: (line: string) => void) {
  let buffer = "";
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim()) onLine(line);
    }
  });
}
```

**Action:** Audit `backend/src/lib/jsonrpc.ts` and replace any readline-based parsing with LF-only splitting.

---

### 2. WebSocket Event Sequencing & Resumability

**Source:** Shelley (`subpub/subpub.go`), OpenClaw (`src/gateway/protocol/index.ts`)

**Problem:** When a WebSocket reconnects, Agemon refetches all chat history. Events emitted during the disconnect window are lost.

**Pattern:** Both Shelley and OpenClaw assign monotonic sequence numbers to every event. On reconnect, the client sends its `lastSeq` and the server replays only missed events.

```typescript
// Server-side
type ServerEvent = {
  seq: number;          // monotonic sequence number
  runId?: string;       // idempotency key for deduplication
  type: "chat" | "activity" | "status" | ...;
  payload: unknown;
};

// Client reconnect
ws.send(JSON.stringify({ type: "resume", lastSeq: 4217 }));

// Server replays events where seq > 4217 from a ring buffer
```

**OpenClaw's EventFrame separation** is also worth noting — they split WebSocket traffic into three frame types:
- `EventFrame` — server-pushed events (seq numbered)
- `RequestFrame` — client RPC calls (id correlated)
- `ResponseFrame` — server replies to requests (id correlated)

This is more structured than our current flat `ServerEvent` / `ClientEvent` approach.

**Action:** Add `seq` field to `ServerEvent` in `shared/types/index.ts`. Maintain a ring buffer (last N events) in the backend. On WebSocket reconnect, replay missed events instead of refetching full history.

---

### 3. Steering & Follow-Up Queues

**Source:** Pi-mono (`packages/agent/src/agent-loop.ts`)

**Problem:** Agemon only supports `send_message` — users must wait for the agent to finish or hit a blocker before interacting. There's no way to redirect an agent mid-execution.

**Pattern:** Pi implements two interrupt mechanisms:
- **Steering:** Interrupts the agent mid-tool-execution. Remaining queued tool calls are skipped (returned as errors). The steering message becomes the next user turn.
- **Follow-up:** Queues a message to send after the current turn completes. Useful for chaining instructions.

```typescript
// Steering — interrupt now
agent.steer({
  role: "user",
  content: "Stop! Focus on the API routes instead.",
  mode: "one-at-a-time"  // or "all"
});

// Follow-up — queue for after current turn
agent.followUp({
  role: "user",
  content: "Also run the tests when you're done.",
  mode: "one-at-a-time"
});
```

**Action:** Add `steer` and `follow_up` as new `ClientEvent` types. In ACP, steering maps to sending a cancel + new prompt. Follow-up queues the message and sends it when the current session update completes.

---

### 4. Distillation / Context Compaction

**Source:** Shelley (`server/distill.go`), Pi-mono (`packages/agent/src/agent-loop.ts`)

**Problem:** Long-running agent sessions exceed the LLM context window. Currently Agemon has no strategy for this.

**Shelley's approach:**
- LLM generates an "operational briefing" summarizing the conversation state
- A new continuation conversation is created with the briefing as the initial system message
- Includes structured "Retained Facts" for machine readability
- Original conversation preserved for reference

**Pi's approach:**
- Append-only JSONL with compaction entries
- Compaction summarizes older turns into a single entry
- Full history preserved — users can navigate the tree via `/tree`
- Auto-triggers when approaching token limits (proactive) or on overflow (recovery)

**Action:** Implement compaction in `backend/src/lib/acp.ts`:
1. Track token usage per session (from ACP `session/update` events)
2. When approaching limit, auto-trigger compaction:
   - Send a summarization prompt to the agent
   - Store the summary as a new `acp_events` entry with `type: "compaction"`
   - Start a new session continuation with the summary as context
3. Preserve original events for audit trail

---

### 5. PredictableService / Mock ACP Agent

**Source:** Shelley (`loop/predictable.go`)

**Problem:** Agemon's smoke tests (`scripts/test-api.sh`) test REST endpoints but can't test ACP agent interactions without a real `claude-agent-acp` binary and API keys.

**Pattern:** Shelley implements a `PredictableService` — a deterministic mock LLM that:
- Records all requests for assertions
- Returns canned responses in order
- Supports tool calls with predetermined outputs
- Enables full E2E testing without API keys

```go
// Shelley's approach
predictable := NewPredictableService()
predictable.AddResponse(Response{
  Content: []Content{{Type: "text", Text: "I'll fix that bug."}},
  ToolCalls: []ToolCall{{Name: "bash", Input: `{"cmd": "echo fixed"}`}},
})
```

**Action:** Build a mock ACP agent (`scripts/mock-acp-agent.ts`) that:
- Implements ACP JSON-RPC handshake (`initialize`, `session/new`)
- Responds to `session/prompt` with scripted responses
- Emits realistic `session/update` notifications (thought chunks, tool calls)
- Configurable via a scenario file (JSON/YAML)

This enables testing the full pipeline: REST → spawn agent → ACP handshake → streaming → WebSocket broadcast → frontend rendering.

---

### 6. Agent Type Registry

**Source:** Pi-mono (`packages/ai/src/api-registry.ts`)

**Problem:** Agemon currently hardcodes `claude-agent-acp` as the agent spawning mechanism. Adding new agent types (e.g., `pi`, `opencode`) requires modifying `lib/acp.ts` directly.

**Pattern:** Pi registers providers dynamically:
```typescript
// Registration
registerApiProvider({
  api: "anthropic-messages",
  stream: streamAnthropic,
  streamSimple: streamSimpleAnthropic,
});

// Lookup
const provider = getApiProvider("anthropic-messages");
await provider.stream(request);
```

**Action:** Create an agent registry in `backend/src/lib/agents/`:
```
agents/
├── registry.ts       # registerAgent(), getAgent()
├── types.ts          # AgentDriver interface
├── claude-acp.ts     # Current ACP implementation
├── pi-rpc.ts         # Pi RPC mode (future)
└── mock.ts           # Mock agent for testing
```

```typescript
interface AgentDriver {
  name: string;
  spawn(taskId: string, cwd: string): Promise<AgentProcess>;
  sendPrompt(session: AgentProcess, prompt: string): Promise<void>;
  stop(session: AgentProcess): Promise<void>;
  steer?(session: AgentProcess, message: string): Promise<void>;
}

registerAgent("claude-code", new ClaudeAcpDriver());
registerAgent("pi", new PiRpcDriver());
registerAgent("mock", new MockDriver());
```

The `agent` field on tasks already exists in the DB schema — this makes it functional.

---

### 7. In-Memory Session Cache with TTL

**Source:** OpenClaw (`src/acp/session.ts`)

**Problem:** Every WebSocket event and API request hits SQLite for session/task state. For active sessions with high event throughput, this adds unnecessary latency.

**Pattern:** OpenClaw maintains an in-memory session store with:
- Idle-based TTL (24h default, configurable)
- LRU eviction when capacity reached (5000 max)
- Per-session `AbortController` for cancellation
- Auto-reap on interval

```typescript
class SessionStore {
  private sessions = new Map<string, CachedSession>();
  private maxSessions = 5000;
  private idleTtlMs = 24 * 60 * 60 * 1000;

  get(id: string): CachedSession | undefined {
    const s = this.sessions.get(id);
    if (s) s.lastAccess = Date.now();
    return s;
  }

  reap() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastAccess > this.idleTtlMs) {
        s.abort.abort();
        this.sessions.delete(id);
      }
    }
  }
}
```

**Action:** Add an in-memory cache layer in front of `db/client.ts` for hot session data (active tasks, running sessions, recent events). Write-through to SQLite, read from cache first.

---

### 8. Separated Tool Output (LLM vs Display)

**Source:** Shelley (`loop/loop.go`)

**Problem:** Tool outputs in our chat interface show the same raw text that gets sent to the LLM. Large outputs (diffs, logs) clutter the UI.

**Pattern:** Shelley's tools return a three-part result:
```go
type ToolOut struct {
  LLMContent []Content  // What the LLM sees (may be truncated/summarized)
  Display    []Content  // What the UI renders (rich: syntax highlighting, diff viewer)
  Error      error      // Separate error channel
}
```

This allows the UI to show a rich diff viewer while the LLM gets a compact text summary. Or show a screenshot preview while the LLM gets OCR text.

**Action:** Extend our `acp_events` schema to store both `content` (LLM-facing) and `display_content` (UI-facing). When rendering tool results in the chat interface, prefer `display_content` if present.

---

## Integration Opportunities

### Pi as an Agent Backend

Pi's RPC mode (`pi --mode rpc`) speaks strict JSONL over stdio with commands: `prompt`, `steer`, `abort`, `compact`, `get_state`, `switch_session`, `fork`, `get_messages`. This maps well to Agemon's agent model. Adding a `PiRpcDriver` (see pattern 6) would let users choose Pi as their agent.

### OpenClaw's ACP Translation Layer

OpenClaw already has a production ACP↔Gateway bridge:
- `src/acp/translator.ts` — event translation with rate limiting
- `src/acp/session.ts` — session mapping with TTL
- `src/acp/event-mapper.ts` — tool kind inference

These files are directly useful as reference for hardening our `lib/acp.ts`.

### Shelley's Conversation Manager Lifecycle

Shelley's `ConversationManager` pattern — lazy hydration, explicit `SetAgentWorking()` state, auto-timeout — is a clean model for managing active task sessions without keeping everything in memory.

---

## Prompting Techniques

### System Prompt Architecture Comparison

| Aspect | **Shelley** | **Pi-mono** | **OpenClaw** |
|--------|------------|-------------|-------------|
| **Construction** | Go `text/template` with conditional sections | TypeScript `buildSystemPrompt()` with option flags | TypeScript modular section builder with `promptMode` |
| **Persona** | "You are Shelley, a coding agent. Experienced software engineer and architect. Communicate with brevity." | "You are an expert coding assistant operating inside pi, a coding agent harness." | "You are a personal assistant running inside OpenClaw." |
| **Dynamic sections** | Git info, exe.dev env, codebase guidance, skills XML | Selected tools, guidelines, context files, skills, APPEND_SYSTEM.md | 20+ toggleable sections based on channel, capabilities, sandbox, ACP mode |
| **Context files** | AGENTS.md, CLAUDE.md, DEAR_LLM.md (case-insensitive) | CLAUDE.md, AGENTS.md (ancestor walk from cwd to root) | SOUL.md, AGENTS.md, TOOLS.md, IDENTITY.md, USER.md, MEMORY.md, HEARTBEAT.md, BOOTSTRAP.md |
| **Skill injection** | XML blocks with SKILL.md references | `<available_skills>` section if read tool available | XML `<available_skills>` with "read only after selecting" rule |

### Pattern 1: Compositional System Prompts

All three repos build system prompts from composable sections rather than monolithic strings. The most mature approach is **OpenClaw's section builder** — each section is a function that returns `string[]` and is conditionally included based on runtime state.

**Pi's approach** (recommended for Agemon):
```typescript
// system-prompt.ts — composable layers
function buildSystemPrompt(options: {
  customPrompt?: string;         // Full override
  selectedTools: string[];       // Controls which tool docs are included
  toolSnippets?: Record<string, string>;  // One-line tool summaries
  promptGuidelines?: string[];   // Additional bullet points
  appendSystemPrompt?: string;   // Appended verbatim
  cwd: string;
  contextFiles?: ContextFile[];  // CLAUDE.md, AGENTS.md content
  skills?: Skill[];              // Discovered skills
}): string {
  const sections: string[] = [];

  sections.push(PERSONA);
  sections.push(buildToolSection(options.selectedTools, options.toolSnippets));
  sections.push(buildGuidelines(options.selectedTools, options.promptGuidelines));
  if (options.appendSystemPrompt) sections.push(options.appendSystemPrompt);
  if (options.contextFiles?.length) sections.push(buildContextSection(options.contextFiles));
  if (options.skills?.length) sections.push(buildSkillsSection(options.skills));
  sections.push(`Current working directory: ${options.cwd}`);

  return sections.join("\n\n");
}
```

**Action for Agemon:** When we build task-level CLAUDE.md files (per worktree convention), use a section-based builder that composes: global instructions + per-repo instructions + task-specific context + skill definitions.

---

### Pattern 2: Hierarchical Context File Discovery

All three repos walk the filesystem to discover instruction files, but with different strategies:

**Shelley** — Root files injected into system prompt; subdirectory files listed for on-demand reading:
```
<customization>
Root-level contents included below; read subdirectory guidance files before editing there.
Deeper files take precedence; user instructions override all.
</customization>

<guidance>
<root_guidance file="AGENTS.md">
[Full content injected here]
</root_guidance>
</guidance>

Subdirectory guidance files (read before editing in these directories):
- src/api/AGENTS.md
- src/utils/AGENTS.md
```

**Pi** — Walks ancestor directories from cwd to root, deduplicated, global-first then ancestors:
```
# Project Context

## ~/.pi/agent/CLAUDE.md
[global instructions]

## /project/CLAUDE.md
[project instructions]

## /project/src/CLAUDE.md
[subdirectory instructions]
```

**OpenClaw** — Recognizes 8+ file types with special handling (SOUL.md for persona, HEARTBEAT.md for polling):
```
If SOUL.md is present, embody its persona and tone. Avoid stiff, generic
replies; follow its guidance unless higher-priority instructions override it.
```

**Action for Agemon:** Our worktree convention already plans for `~/.agemon/CLAUDE.md` (global) + per-repo CLAUDE.md. Adopt Shelley's pattern of injecting root-level content directly but only listing subdirectory files — keeps the prompt compact while letting agents drill into specifics on demand.

---

### Pattern 3: Conditional Tool Descriptions

All three repos adapt tool descriptions based on the model and available tools.

**Shelley** — Schema complexity varies by model strength:
```go
// Weaker models get simplified patch schema (no clipboard operations)
// Strong models (sonnet/opus) get full schema with clipboard, reindent, cut/copy/paste
func isStrongModel(modelID string) bool {
  return strings.Contains(modelID, "sonnet") || strings.Contains(modelID, "opus")
}
```

**Pi** — Guidelines auto-adapt to available tools:
```typescript
// If bash exists but grep/find/ls don't:
"Use bash for file operations"

// If bash AND grep/find/ls exist:
"Prefer grep/find/ls tools over bash for file exploration"

// If edit exists:
"Use read to examine files before editing. You must use this tool instead of cat or sed."
```

**OpenClaw** — ACP-aware tool descriptions change based on deployment mode:
```typescript
// When acpEnabled:
sessions_spawn: 'Spawn an isolated sub-agent or ACP coding session (runtime="acp" requires agentId...)'

// When !acpEnabled:
sessions_spawn: "Spawn an isolated sub-agent session"
```

**Action for Agemon:** When generating the task-level CLAUDE.md, include agent-specific tool guidance. Claude Code gets different instructions than Pi or OpenCode. The agent registry (pattern 6 above) should carry prompt metadata per agent type.

---

### Pattern 4: Distillation & Compaction Prompts

Both Shelley and Pi have mature approaches to summarizing long conversations.

**Shelley's distillation prompt** — operational, second-person, structured:
```
OPERATIONAL DISTILLATION — not a narrative summary.

Write as: "You were working on...", "You created...", "You decided..."

Include:
- File paths modified or referenced
- Decisions made and their rationale
- Current task state (what's done, what remains)
- Specific values: URLs, ports, config, env vars, schemas, versions, commands
- Error resolutions
- Working directory and git state

Exclude:
- Dead-end debugging attempts
- Verbose tool output
- Abandoned tangents
- Thinking blocks
- Intermediate file states

Compression: Recent activity (~last 20%) gets more detail.
Short conversations (<20 messages): preserve more.
Long conversations (>100 messages): aggressively compress old activity.

Target: 500-2000 words.
Output: "This is a continuation of conversation SLUG" + 2-6 sentences + "## Retained Facts"
```

**Pi's compaction** — token-aware, identifier-preserving:
```
Preserve all opaque identifiers exactly as written (no shortening or reconstruction),
including UUIDs, hashes, IDs, tokens, API keys, hostnames, IPs, ports, URLs, and file names.
```

**OpenClaw's compaction** — chunk-based with tool failure tracking:
```typescript
BASE_CHUNK_RATIO = 0.4;    // Compact oldest 40% of context window
MIN_CHUNK_RATIO = 0.15;    // Never compact less than 15%
SAFETY_MARGIN = 1.2;       // 20% buffer for token underestimation

// Tracks up to 8 tool failures (240 chars each) across compaction boundaries
```

**Action for Agemon:** Adopt Shelley's distillation prompt format (operational, second-person, with Retained Facts) combined with Pi's identifier preservation rule. Use OpenClaw's chunk ratio approach for deciding when to trigger compaction.

---

### Pattern 5: Subagent Delegation Prompts

Both Shelley and Pi handle multi-agent delegation with distinct prompt patterns.

**Shelley's subagent system prompt** — deliberately minimal:
```
You are a subagent of Shelley, a coding agent. You have been delegated a specific task
by the parent agent.

Key constraints:
- Complete your assigned task thoroughly
- Your final message will be returned to the parent agent as the result
- Write important findings to files if the parent may need them later
- Be concise in your final response — summarize what you did and the outcome
- If you encounter blocking issues, explain them clearly so the parent can help
```

**Shelley's subagent tool description** — instructs the parent on how to delegate:
```
When writing prompts for subagents, convey intent, nuance, and operational
details — not just prescriptive instructions. The subagent has no context
beyond what you put in the prompt, so share the "why" alongside the "what".
```

**OpenClaw** — uses `promptMode: "minimal"` for subagents, stripping most system prompt sections but keeping Tooling, Workspace, Runtime, and Safety.

**Action for Agemon:** When a task has multiple sessions, the second session's CLAUDE.md should reference the first session's progress. Use Shelley's pattern of injecting a "continuation context" from the first session's distillation.

---

### Pattern 6: Prompt Injection Protection

**OpenClaw** has the most robust approach:
```typescript
// sanitize-for-prompt.ts
function sanitizeForPromptLiteral(value: string): string {
  // Strip Unicode control (Cc), format (Cf), and line/paragraph separators (Zl/Zp)
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "");
}
```

Applied to all user-provided values before insertion into system prompts (workspace dir, hostnames, channel names, owner identifiers).

**Shelley** — Guidance file paths are case-insensitively deduplicated to prevent double-injection on case-insensitive filesystems.

**Pi** — Prompt templates use positional argument substitution (`$1`, `$@`) rather than string interpolation, avoiding injection through template variables.

**Action for Agemon:** Sanitize all user-provided values (task titles, repo URLs, workspace paths) before injecting into the generated CLAUDE.md. Strip Unicode control characters and validate against injection patterns.

---

### Pattern 7: Error Recovery Prompting

**Shelley** — Truncation recovery with explicit system error injection:
```
[SYSTEM ERROR: Your previous response was truncated because it exceeded the maximum
output token limit. Any tool calls in that response were lost. Please retry with
smaller, incremental changes. For file operations, break large changes into multiple
smaller patches. The user can ask you to continue if needed.]
```
The truncated response is stored with `ExcludedFromContext = true` (for billing) but not sent back to the LLM, preventing confusion.

**Pi** — Auto-retry with compaction on context overflow:
```typescript
// On context overflow error:
// 1. Trigger auto-compaction
// 2. Retry with compacted context
// 3. Track overflow recovery attempts to avoid infinite loops
```

**Shelley's retry logic:**
```
- Max retries: 2 (3 total attempts)
- Exponential backoff: sleep(attempt * 1 second)
- Only retry on transient errors (EOF, connection reset, timeout)
- Permanent failures fail immediately
```

**Action for Agemon:** Add error recovery metadata to ACP events. When a session hits a context overflow, auto-trigger compaction and resume. Store error events with enough context for the UI to show what happened.

---

### Pattern 8: Prompt Caching

**Shelley** implements Anthropic prompt caching by marking strategic cache breakpoints:
```go
// Mark last tool definition with Cache = true
tools[len(tools)-1].Cache = true

// Mark last content block of last user message with Cache = true
lastMsg.Content[len(lastMsg.Content)-1].Cache = true
```

This ensures the system prompt + tool definitions + conversation prefix are cached across turns, dramatically reducing input token costs for long conversations.

**Action for Agemon:** When building the generated CLAUDE.md, structure it so stable content (global instructions, repo conventions) comes first and volatile content (task-specific state) comes last. This maximizes cache hit rates when the agent makes multiple LLM calls within a session.

---

### Pattern 9: Skills Discovery & Activation

All three repos use a "scan then read" pattern for skills:

**OpenClaw** (most explicit):
```
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.
```

**Shelley** — Skills discovered from `.skills/` directories, converted to XML:
```xml
<skills>
  <skill name="deploy" description="Deploy to production" location="/path/to/SKILL.md" />
  <skill name="test" description="Run test suite" location="/path/to/SKILL.md" />
</skills>
```

**Pi** — Skills validated with strict frontmatter (name must match directory, max 1024 char description):
```yaml
---
name: skill-name
description: "What this skill does"
disable-model-invocation: false
---
```

**Action for Agemon:** Our worktree convention already plans for `~/.agemon/skills/` (global) and per-task `.agemonskills/`. Use OpenClaw's "scan then read" instruction pattern in the generated CLAUDE.md. Include skill descriptions in the system prompt but not full content — let the agent read SKILL.md on demand.

---

### Pattern 10: Channel/Context-Adaptive Prompting

**OpenClaw** adapts prompts significantly based on the messaging channel:
- **Telegram**: Adds reaction guidance (emoji), inline button support
- **Discord**: Defaults ACP sessions to thread-bound persistent mode
- **Voice/TTS**: Adds pronunciation and pacing hints
- **Sandbox**: Adds dual-workspace path mapping (host vs container)

**Shelley** adapts based on the hosting platform:
- **exe.dev**: Adds port access patterns, sudo availability, systemd management
- **Local**: Simpler prompt without platform-specific sections

**Action for Agemon:** Agemon is mobile-first web only (v1), but we should design the CLAUDE.md builder to accept context parameters. When we add Slack/Discord notifications later, the agent instructions should adapt (e.g., "format responses for Slack markdown" vs "format for web rendering").

---

## Prompting Reference Files

### Shelley
- `server/system_prompt.txt` — Main agent system prompt template
- `server/subagent_system_prompt.txt` — Minimal subagent prompt
- `server/distill.go` (lines 18-57) — Distillation instruction text
- `claudetool/keyword_system_prompt.txt` — File search relevance evaluation
- `claudetool/bash.go` (lines 105-139) — Bash tool description with `slow_ok` pattern
- `claudetool/patch.go` (lines 72-100) — Patch tool with clipboard recipes
- `claudetool/subagent.go` (lines 51-81) — Subagent delegation guidance

### Pi-mono
- `packages/coding-agent/src/core/system-prompt.ts` — Dynamic system prompt builder
- `packages/coding-agent/src/core/resource-loader.ts` — Context file discovery (ancestor walk)
- `packages/coding-agent/src/core/skills.ts` — Skill discovery & validation
- `packages/coding-agent/src/core/prompt-templates.ts` — Template system with argument substitution
- `packages/coding-agent/src/core/compaction/compaction.ts` — Summarization prompts
- `packages/coding-agent/src/core/extensions/types.ts` — `before_agent_start` hook for prompt modification

### OpenClaw
- `src/agents/system-prompt.ts` — 704-line modular section builder
- `src/agents/bootstrap-files.ts` — Context file loading with truncation
- `src/agents/compaction.ts` — Token-aware chunk compaction
- `src/agents/sanitize-for-prompt.ts` — Prompt injection protection
- `src/agents/skills.ts` — Skill snapshot builder with XML format
- `src/agents/pi-embedded-helpers/turns.ts` — Provider-aware turn validation

---

## UI Patterns: Shelley Tool Call Rendering

**Source:** `ui/src/components/` — `Message.tsx`, `GenericTool.tsx`, `BashTool.tsx`, `PatchTool.tsx`, `ThinkingContent.tsx`, `AGENTS.md`

Shelley has a mature, mobile-aware tool call UI worth adopting for Agemon's chat interface.

### Pattern: Per-tool Specialized Components with Shared Interface

Every tool gets its own React component. All share the same props contract:

```typescript
interface ToolProps {
  toolInput?: unknown;      // LLM-facing input (shown during tool_use / running phase)
  isRunning?: boolean;      // true = still executing, false = complete
  toolResult?: LLMContent[]; // result content (tool_result phase)
  hasError?: boolean;
  executionTime?: string;   // e.g. "1.2s" or "340ms"
  display?: unknown;        // rich UI-specific data (separate from LLM content — Pattern 8)
}
```

Falls back to `GenericTool` for unknown tool names. `GenericTool` shows `toolName`, input JSON, output text, and error state — a sensible baseline.

**Registration rule (from `AGENTS.md`):** Each tool component must be registered in **two places**:
1. `ChatInterface.tsx` (`TOOL_COMPONENTS` map) — for real-time streaming rendering
2. `Message.tsx` (`renderContent()` switch) — for stored message rendering

Missing either causes inconsistent rendering (generic during stream, specialized after reload, or vice versa).

### Pattern: Two-State Collapsible Cards

Each tool renders a clickable header + collapsible detail panel:

- **Header (always visible):** emoji icon, primary info (command or filename truncated to ~300 chars), working dir, `✓` / `✗` / `✗ cancelled` status indicator, execution time
- **Detail (collapsed by default):** full input, full output, error text
- `isRunning=true` → emoji animates, detail shows "running...", no result yet
- `isRunning=false` → result shown, timing shown, errors highlighted

Special case: `PatchTool` defaults to **expanded** on success (diff is the main thing to see), collapsed on error (agent typically self-recovers).

### Pattern: Execution Time from Timestamps

Execution time is calculated from `ToolUseStartTime` / `ToolUseEndTime` on the `tool_result` content block:

```typescript
const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime();
executionTime = diffMs < 1000 ? `${diffMs}ms` : `${(diffMs / 1000).toFixed(1)}s`;
```

### Pattern: Rich Diff Viewer in PatchTool

`PatchTool` uses `@pierre/diffs` for syntax-highlighted side-by-side / unified diff rendering:
- Desktop default: side-by-side; mobile forced to unified (detects `window.innerWidth < 768`)
- Preference saved to localStorage
- `DiffErrorBoundary` catches crashes and falls back to `<pre>` raw diff
- Supports two payload formats: `{path, diff}` (new) and `{path, oldContent, newContent}` (legacy)

### Pattern: Thinking Content

`ThinkingContent` component — expand/collapse, defaults **expanded**, header shows first 80 chars when collapsed. `💭` emoji indicator.

### How This Maps to Agemon

| Shelley | Agemon today | Gap |
|---------|-------------|-----|
| Per-tool components (`BashTool`, `PatchTool`, etc.) | Generic activity text in `session-chat-panel.tsx` | No per-tool rendering |
| Two-state (running / complete) card | `turnsInFlight` in store, activity string | No visual tool card |
| `display` field (rich UI data) | `acp_events.content` only (LLM-facing) | Pattern 8 not yet implemented |
| Execution time | Not tracked | ACP events have timestamps — could derive |
| Thinking content component | Thought type in activity | No expand/collapse |

**Action:** Add a `ToolCallCard` component to Agemon's chat UI. Start with `GenericTool`-equivalent (collapsible header + input/output), then specialize for `bash` (show command + cwd) and file edits (diff viewer). Requires Pattern 8 (`display_content` on `acp_events`) for rich display data.

**Reference files:** `.reference_repos/shelley/ui/src/components/` — all files listed above are shallow-cloned and readable locally.

---

## Priority Order

| # | Improvement | Effort | Impact | Risk if Skipped |
|---|------------|--------|--------|-----------------|
| 1 | Fix JSONL framing (LF-only) | Small | Medium | Silent parse failures in production |
| 2 | Mock ACP agent for testing | Medium | High | Can't test agent pipeline without API keys |
| 3 | Agent type registry | Medium | High | Blocks multi-agent support |
| 4 | WebSocket event sequencing | Medium | Medium | Lost events on reconnect |
| 5 | Steering & follow-up | Medium | High | Users can't redirect agents |
| 6 | Distillation / compaction | Large | High | Long tasks fail at context limit |
| 7 | In-memory session cache | Small | Medium | Unnecessary DB pressure |
| 8 | Separated tool output | Small | Medium | Cluttered chat UI |

---

## Reference Files

### Shelley (shallow clone at `.reference_repos/shelley/`)
- `server/convo.go` — ConversationManager lifecycle
- `loop/loop.go` — Agent loop state machine
- `loop/predictable.go` — Mock LLM for testing
- `subpub/subpub.go` — Pub/sub with index-based resumability
- `server/distill.go` — Context distillation

### Pi-mono
- `packages/coding-agent/src/modes/rpc/jsonl.ts` — LF-only JSONL framing
- `packages/coding-agent/src/modes/rpc/rpc-types.ts` — RPC protocol definition
- `packages/ai/src/api-registry.ts` — Provider registry pattern
- `packages/agent/src/agent-loop.ts` — Steering & follow-up queues
- `packages/coding-agent/src/core/session-manager.ts` — Append-only session storage

### OpenClaw
- `src/acp/translator.ts` — ACP↔Gateway event translation
- `src/acp/session.ts` — In-memory session store with TTL
- `src/gateway/protocol/index.ts` — EventFrame protocol with sequencing
- `src/agents/acp-spawn.ts` — Thread binding & spawn modes
