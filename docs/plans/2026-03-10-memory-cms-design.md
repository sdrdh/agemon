# Memory CMS — Design

**Date:** 2026-03-10
**Status:** Approved

## Problem

Agemon accumulates rich agent activity (thoughts, actions, tool calls, outcomes) but discards it after a session. There's no persistent memory of what was accomplished, what decisions were made, or what was learned about a codebase. This forces agents and users to rediscover context on every new task.

## Goal

A lightweight memory system that distills task activity into markdown files — per task, per project, per day, per week — accessible from the frontend as readable pages and injectable into new agent sessions as context.

## File Layout

Files live under `~/.agemon/memory/` (respects `AGEMON_DIR`):

```
~/.agemon/memory/
├── projects/
│   └── {org}--{repo}.md       # living project context, updated on each task done
├── tasks/
│   └── {taskId}-{slug}.md     # per-task summary, generated on summarize/done
├── daily/
│   └── YYYY-MM-DD.md          # daily rollup of completed tasks
└── weekly/
    └── YYYY-Www.md            # weekly rollup (ISO week)
```

### Task Summary Format

```markdown
# {task title}
**Completed:** {date} | **Agent:** {agent}

## What Was Accomplished
{LLM-generated 2-4 sentence outcome}

## Key Decisions
- {bullet}

## Files Changed
- {extracted from tool events}
```

### Project Memory Format

A living document per repo, updated (not replaced) after each completed task. The LLM merges new learnings into the existing file. This is the most valuable file — it accumulates codebase knowledge over time and is the primary context injected into new sessions on that repo.

### Daily/Weekly Rollup Format

A brief paragraph per task with links to task summary files, plus an overall summary of the period's output.

## Generation

### Triggers

- **"Summarize" button** on a task → generates task summary only
- **"Done" button** on a task → generates task summary + updates `projects/{org}--{repo}.md` for all attached repos
- **Cron jobs** → daily and weekly rollups, configurable schedule, also manually triggerable from Settings

### Flow (task summarize/done)

1. Fetch all `acp_events` for the task from SQLite
2. Call Claude API with distillation prompt → structured markdown output
3. Write `~/.agemon/memory/tasks/{taskId}-{slug}.md`
4. If "Done": for each attached repo, read existing `projects/{org}--{repo}.md` (if any), call Claude to merge new learnings, rewrite file
5. Insert/update record in `memory_files` DB table
6. Broadcast `memory_file_updated` WS event

### Flow (daily/weekly rollup)

1. Query `memory_files` for all task summaries in the period
2. Read each file, concatenate
3. Call Claude API with rollup prompt → daily/weekly markdown
4. Write to `daily/YYYY-MM-DD.md` or `weekly/YYYY-Www.md`
5. Insert record in `memory_files`

## Summarization Model & Agent

Configurable via Settings — stored as new keys in the existing settings infrastructure:

```
memory_summarize_model   # default: claude-sonnet-4-6
memory_summarize_agent   # default: direct API (not via ACP agent)
```

Exposed in the Settings page under a new "Memory" section alongside cron schedule editors.

## Database Changes

Two new tables:

```sql
-- Tracks all generated memory files
memory_files (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- task | project | daily | weekly
  task_id TEXT,                 -- nullable, references tasks(id)
  file_path TEXT NOT NULL,      -- absolute path to .md file
  period TEXT,                  -- nullable, YYYY-MM-DD or YYYY-Www for rollups
  created_at TEXT NOT NULL
)

-- Configurable cron jobs for rollups
cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- e.g. "Daily Summary", "Weekly Summary"
  schedule TEXT NOT NULL,       -- cron expression, e.g. "0 23 * * *"
  type TEXT NOT NULL,           -- daily | weekly
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL
)
```

Default cron jobs seeded on first run: daily at 23:00, weekly on Sunday at 23:30.

## Shared Types

New types added to `shared/types/index.ts`:

```typescript
MemoryFile { id, type, taskId?, filePath, period?, createdAt }
CronJob { id, name, schedule, type, enabled, lastRunAt?, createdAt }
MemoryFileUpdatedEvent  // WS broadcast
```

## API Endpoints

```
POST /api/tasks/:id/summarize      # generate task summary (non-blocking, streams progress)
POST /api/tasks/:id/done           # mark done + summarize + update project files
GET  /api/memory                   # list all memory_files records
GET  /api/memory/raw?path=...      # serve raw markdown file content
POST /api/memory/rollup            # manually trigger daily or weekly rollup
GET  /api/cron-jobs                # list cron jobs
PUT  /api/cron-jobs/:id            # update schedule or enabled flag
```

## Frontend

- **`/memory` route** — sidebar lists all memory files grouped by type (Projects, Tasks, Daily, Weekly); main panel renders selected file as markdown via `react-markdown`
- **Task detail view** — "Summarize" and "Done" buttons added to `tasks.$id.tsx`
- **Settings page** — new "Memory" section: model/agent pickers, cron schedule editors (one per job), manual rollup trigger buttons

## What This Enables

- Agents starting new tasks on a repo get the project memory file injected as context via the existing CLAUDE.md generation in `lib/context.ts`
- Users can browse what was accomplished across days/weeks from mobile
- Daily/weekly summaries serve as lightweight changelogs
