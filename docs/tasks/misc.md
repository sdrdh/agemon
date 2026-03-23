## Settings: Agent Detection & Configuration Page

This work is tracked in **Task 4.15: Settings Page Restructure & Agent Configuration** above.

Implementation notes:
- Use live backend detection for agent installation and login/readiness status
- Store Agemon-owned defaults in a flat file under `~/.agemon/`
- Keep setup/auth flows terminal-driven; the UI reports status and shows instructions only

---

## Phase 10: Memory CMS

**Goal:** Persistent memory system that distills task activity into markdown files — per task, per project, per day, per week — readable from a frontend viewer and injectable into new agent sessions as context.

**Design Doc:** [`docs/plans/2026-03-10-memory-cms-design.md`](docs/plans/2026-03-10-memory-cms-design.md)

**Summary of scope:**
- "Summarize" and "Done" buttons on tasks trigger LLM distillation of all ACP events into a task summary `.md` file
- "Done" also updates a living per-project memory file (`~/.agemon/memory/projects/{org}--{repo}.md`) by merging new learnings
- Daily and weekly rollups via configurable cron jobs (auto-scheduled + manually triggerable from Settings)
- Summarization model/agent configurable in Settings (default: `claude-sonnet-4-6`)
- New memory file metadata stored in task plugin data dir; new settings keys for model/agent
- `/memory` frontend route: sidebar + markdown reader
- Project memory file injected into new agent sessions via existing CLAUDE.md context generation

---

**Last Updated:** March 2026
**Status:** Core infrastructure, ACP integration, session-centric chat UI with multi-session tabs, unread activity indicators, nav bar, kanban, sessions page, slash command menu, MCP server config, approval persistence, turn cancellation, archiving, copy message, back gesture nav, markdown rendering, interrupted session resume, dynamic slash commands, token usage tracking (Task 4.19), context window monitoring (Task 4.20), speech-to-text input (Task 4.28), auto-resize chat textarea (Task 4.29), slash command persistence (Task 4.30), agent context harness (Phase 3.5), offline behavior + WS event sequencing (Task 4.32), plugin system v2 implemented. DB cleanup for archived sessions (Task 4.31), speech-to-text (Task 4.28 — partial), Terminal PTY, diff viewer, GitHub PR flow, and notifications + OpenClaw integration (Phase 9) remaining.
