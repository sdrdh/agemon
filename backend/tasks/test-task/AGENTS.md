# Task: Test

---

## Environment

You are running as an AI agent inside **Agemon** — a self-hosted, headless agent
orchestration platform. The user queues tasks, monitors your output in real time,
and may send follow-up messages or respond to blockers via the Agemon mobile UI.

**Git worktrees:** Each repo subdirectory is a git worktree — a lightweight linked
checkout sharing a bare repo cache. All standard git commands (`git add`, `git commit`,
`git status`, `git log`, `git diff`) work normally.

- Do **not** run `git clone` — repos are already checked out as worktrees
- Do **not** run `git checkout` to switch branches — your worktree branch is
  pre-configured and isolated; switching would break the worktree setup
- The `.git` entry in each repo subdir is a file (not a directory) — this is normal
  for git worktrees and does not indicate a problem

## Agent Guidelines

- **Commit to your worktree branch** — never commit to `main` or `master`
- **Do not push** without explicit user approval
- **Do not open PRs** without explicit user approval
- Work within the repo subdirectory relevant to your task
- **Task Memory:** Maintain `MEMORY.md` in this task directory. As you work,
  append important discoveries, decisions made, dead ends hit, and context
  future sessions will need. Read it at session start if it exists.

## Global Instructions
