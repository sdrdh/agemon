# Plugin System v2 — Plan Index

**Branch:** `feat/plugin-system-v2`
**Started:** 2026-03-20
**Status:** Planning / Brainstorm

---

## Core Principle

**Core = session engine + event bridge + plugin host. Nothing else.**

Sessions are the fundamental unit. Tasks, git, agents, skills, routing — all optional enrichment via plugins.

---

## Key Decisions

1. **WorkspaceProvider is optional** — local directory is the zero-config baseline. No plugin = agent runs in specified CWD. Git worktrees, jj, remote workspaces are opt-in enrichments. See [02-workspace-provider.md](02-workspace-provider.md).

2. **Sessions are core, tasks are not** — tasks are an organizational layer built on top via the tasks plugin. `session.meta_json TEXT` decouples the two. See [06-tasks-extraction.md](06-tasks-extraction.md).

3. **JSONL over SQLite for ACP events** — append-only access pattern fits JSONL. Byte-offset replay eliminates deduplication on reconnect. See [04-jsonl-events.md](04-jsonl-events.md).

4. **Event bridge over direct imports** — blocking `hook()` vs fire-and-forget `on()`. See [03-event-bridge.md](03-event-bridge.md).

5. **Plugin-owned SQLite** — each plugin manages its own schema. Core shrinks to 3 tables. See [05-plugin-contracts.md](05-plugin-contracts.md).

---

## Documents

| File | Topic |
|------|-------|
| [01-overview.md](01-overview.md) | Goals, scope, what stays in core, pi-mono patterns |
| [02-workspace-provider.md](02-workspace-provider.md) | Optional workspace enrichment, local-dir as baseline |
| [03-event-bridge.md](03-event-bridge.md) | hook / on / emit / broadcast — blocking vs fire-and-forget |
| [04-jsonl-events.md](04-jsonl-events.md) | JSONL events replacing acp_events table |
| [05-plugin-contracts.md](05-plugin-contracts.md) | Six plugin types, PluginExports interface, ChatActions |
| [06-tasks-extraction.md](06-tasks-extraction.md) | Tasks plugin — reference extraction, event-driven status derivation |
| [07-frontend-plugin-pages.md](07-frontend-plugin-pages.md) | Plugin routing, nav bar, renderer widening, inputExtensions |
| [08-plugin-ecosystem.md](08-plugin-ecosystem.md) | Bundled vs optional plugins, plugin-builder studio |
| [09-implementation-roadmap.md](09-implementation-roadmap.md) | Step-by-step order, migration strategy, risks |

---

## Reference

- **pi-mono** (`.reference_repos/pi-mono`) — layered contracts (`ai` → `agent-core` → `coding-agent`), event bus, extension registration queue, `beforeToolCall`/`afterToolCall` hooks
- **Original v2 design** — `docs/plans/2026-03-20-plugin-system-v2-design.md`
