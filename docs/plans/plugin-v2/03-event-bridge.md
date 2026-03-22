# Plugin System v2 — Event Bridge

## Why an Event Bridge?

Plugins need to react to things that happen in core (session spawned, tool called, input needed) and in other plugins (task created, diff ready). Without a bridge, this requires direct imports — which creates coupling and makes plugin extraction impossible.

The bridge is the single seam between core and plugins, and between plugins themselves.

---

## Design

Four methods on `PluginContext`:

```ts
interface PluginContext {
  // Blocking hook — core awaits ALL hooks before proceeding.
  // Use for: workspace preparation, task status update, approval gates.
  hook(event: string, handler: (payload: unknown) => Promise<void>, opts?: { priority?: number }): void;

  // Fire-and-forget listener — core does NOT await.
  // Use for: notifications, logging, analytics, side effects.
  on(event: string, handler: (payload: unknown) => void): void;

  // Plugin-to-plugin event — does NOT go to WebSocket clients.
  // Use for: tasks plugin emitting "task:created" for other plugins to react to.
  emit(event: string, payload: unknown): void;

  // Broadcast to all connected WebSocket clients.
  // Use for: live UI updates (task status changed, diff ready, workspace progress).
  broadcast(wsEvent: object): void;
}
```

**`hook()`** — core awaits all registered hooks for an event in priority order before proceeding. If any hook throws, the operation is aborted. Use this when the plugin must complete work before the next step (e.g. `session:before_spawn` must finish workspace prep before the process is spawned).

**`on()`** — registered on the same event bus. Core fires and forgets. Plugin crash here doesn't affect session. Use this for side effects that don't gate the core operation.

**`emit()`** — plugin-to-plugin only. Goes through the same bus but is not broadcast to WebSocket. Prevents plugins from accidentally coupling to internal events.

**`broadcast()`** — goes to WebSocket clients. Plugins use this to push live updates to the UI without needing a REST endpoint.

---

## Inspiration: pi-mono Event Bus

pi-mono's `createEventBus()` in `coding-agent`:

```ts
export function createEventBus(): EventBusController {
  const listeners = new Map<string, Set<HandlerFn>>();
  return {
    on: (event, handler) => { listeners.get(event)?.add(handler) ?? listeners.set(event, new Set([handler])); },
    emit: (event, data) => { listeners.get(event)?.forEach(fn => fn(data)); },
  };
}
```

Simple and effective. Agemon extends this with:
- Async hooks (await all)
- Priority ordering for hooks
- Separate `hook` vs `on` distinction
- `broadcast` shortcut

---

## Core Event Catalogue

These are the events core emits. Plugins react to them.

| Event | Payload | Type | Notes |
|-------|---------|------|-------|
| `session:before_spawn` | `{ sessionId, agentType, meta }` | hookable | WorkspaceProvider hooks here at priority 0 |
| `session:spawned` | `{ sessionId, pid }` | listener | Process is running |
| `session:state_changed` | `{ sessionId, from, to }` | both | `to` = starting/ready/running/stopped/crashed/interrupted |
| `session:awaiting_input` | `{ sessionId, questionId, question }` | both | Tasks plugin derives task status here |
| `session:input_received` | `{ sessionId, questionId, response }` | both | |
| `session:ended` | `{ sessionId, exitCode, state }` | both | state = stopped/crashed/interrupted |
| `approval:requested` | `{ sessionId, approvalId, tool, input }` | both | |
| `approval:resolved` | `{ sessionId, approvalId, decision }` | both | decision = approved/rejected/modified |
| `workspace:prepared` | `{ sessionId, cwd, meta }` | listener | Fired by workspace plugin after prepare() |
| `workspace:diff_ready` | `{ sessionId, diff }` | listener | Fired by workspace plugin after getDiff() |

---

## Plugin-Emitted Events (convention)

Plugins should namespace their events with their plugin ID:

| Plugin | Event | Notes |
|--------|-------|-------|
| `tasks` | `task:created` | `{ taskId, title }` |
| `tasks` | `task:status_changed` | `{ taskId, from, to }` |
| `tasks` | `task:marked_done` | `{ taskId }` |
| `git-workspace` | `workspace:clone_progress` | `{ sessionId, message, percent }` — broadcast |
| `notifications` | `notification:sent` | `{ channel, message }` |

---

## Hook Priority for `session:before_spawn`

Multiple plugins may hook `session:before_spawn`. Order matters:

| Priority | Plugin | Does |
|----------|--------|------|
| 0 | `git-workspace` / workspace plugin | prepare() → sets `meta.cwd` |
| 10 | `tasks` | write CLAUDE.md (needs cwd from above) |
| 20 | any other | safe to run after workspace + context are ready |

---

## Error Handling

- **Hook throws** → session spawn is aborted. Error is broadcast as a `session:state_changed` event with state `crashed` and the error message in `meta`.
- **Listener throws** → logged but ignored. Core doesn't see it.
- **emit() throws** → propagated to the calling plugin only.

---

## Implementation Notes

The event bridge lives in `backend/src/lib/plugins/event-bridge.ts`. The `PluginContext` object passed to each plugin's `onLoad()` includes bound `hook`, `on`, `emit`, `broadcast` methods. The bridge itself is a singleton owned by the plugin host.

```ts
// Each plugin gets a context bound to its plugin ID for namespacing/debug
function createPluginContext(pluginId: string, bridge: EventBridge): PluginContext {
  return {
    hook: (event, handler, opts) => bridge.registerHook(pluginId, event, handler, opts),
    on: (event, handler) => bridge.registerListener(pluginId, event, handler),
    emit: (event, payload) => bridge.emit(event, payload),
    broadcast: (wsEvent) => bridge.broadcast(wsEvent),
    // ... db, logger, getSetting, etc.
  };
}
```

Plugin ID in the hook registration enables debug logging ("tasks plugin hook for session:before_spawn took 342ms") and cleanup on plugin unload (remove all hooks/listeners registered by a plugin).
