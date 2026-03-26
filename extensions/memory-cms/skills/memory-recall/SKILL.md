---
name: memory-recall
description: Read and write task memory and summaries for the current Agemon task
version: 0.1.0
---

# Memory Recall

Use this skill to persist and retrieve context across sessions for the current Agemon task.
The agent's working directory is always the task directory — all paths below are relative to it.

## File Locations

| File | Purpose |
|------|---------|
| `./memory/MEMORY.md` | Persistent facts, decisions, and context (written by Claude Code's auto-memory system) |
| `./TASK_SUMMARY.md` | Distilled summary of completed work (written manually or by Agemon) |

## Reading Memory

At the start of a session, read existing memory to recall prior context:

```bash
cat ./memory/MEMORY.md 2>/dev/null
cat ./TASK_SUMMARY.md 2>/dev/null
```

## Writing Memory

Append a new entry when making significant decisions or completing a phase:

```bash
mkdir -p ./memory
cat >> ./memory/MEMORY.md << 'EOF'

## YYYY-MM-DD

- Decision: <what was decided and why>
- Context: <any relevant background>
EOF
```

Update the task summary when wrapping up work:

```bash
cat > ./TASK_SUMMARY.md << 'EOF'
# Task Summary

## What Was Done
<brief description>

## Key Decisions
- <decision 1>

## Remaining Work
- <item 1>
EOF
```

## When to Use

- **Start of session**: read `./memory/MEMORY.md` to restore prior context
- **Significant decision**: append to `./memory/MEMORY.md` immediately
- **End of session / phase complete**: update `./TASK_SUMMARY.md`
