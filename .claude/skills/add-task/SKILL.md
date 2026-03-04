---
name: add-task
description: Use when the user wants to add a new feature, enhancement, task, or idea to the project backlog in TASKS.md. Also use when user says "add a todo", "new task", "we should build X", "let's add Y", or discusses a feature they want to track. Brainstorms the idea first, then captures it as lightweight bullet points.
---

# Add Task to Project Backlog

## Overview

Capture new feature ideas into `TASKS.md` through a lightweight brainstorming process. The goal is to explore the idea just enough to write clear, actionable bullet points — not to create a full design or implementation plan. That happens later when the task is actually picked up.

Why this matters: jumping straight to writing a task entry produces vague or over-specified tasks. A few focused questions surface the real intent, uncover constraints, and identify which parts of the system are affected. The result is bullet points that give the implementer enough context without boxing them in.

## Process

### 1. Understand Current State

Before anything else, read the project's current state:

- Read `TASKS.md` — understand existing phases, task numbering, what's done vs. pending
- Read `PRD.md` — product context and constraints
- Read `CLAUDE.md` — conventions, architecture, data model
- Scan recent git log — what's been built recently, what branch you're on

This grounds the brainstorm in reality. A feature that sounds new might already be partially built, or conflict with something in progress.

### 2. Lightweight Brainstorm

**REQUIRED:** Invoke `superpowers:brainstorming` skill for the ideation phase. However, communicate upfront that the goal here is task capture, not full design. The brainstorming should be scoped to:

- Understanding user intent and desired outcome
- Exploring 2-3 possible approaches at a high level
- Identifying constraints and non-obvious requirements
- Determining scope (is this one task or should it be broken into multiple?)

**Adapt the brainstorming output:** Instead of producing a full design doc, the brainstorming should conclude with a concise summary of:
- The agreed-upon direction (not a detailed design)
- Key bullet points that capture the essence
- Any constraints or considerations worth noting

If the idea is simple and the user has a clear picture, the brainstorm can be brief (1-2 questions). Don't over-interview for straightforward additions.

### 3. Architectural Reconnaissance

Before writing the task entry, quickly assess which parts of the system the feature touches. Read relevant existing code — don't deep-dive, just enough to know what's affected.

**Check each layer:**
- **Backend:** New routes? Schema changes? New lib modules?
- **Frontend:** New routes/pages? New components? State changes?
- **Shared:** New types needed in `shared/types/`?
- **Infrastructure:** New env vars? External dependencies?

This prevents writing a task that unknowingly conflicts with existing architecture or misses a dependency.

### 4. Synthesize Into Task Entry

Write the task entry following the established `TASKS.md` format:

```markdown
### Task X.Y: [Feature Name]

**Priority:** P0/P1/P2
**Estimated Time:** [rough estimate]

**Deliverables:**
- [ ] [What to build, not how to build it]
- [ ] [Focused on outcomes and capabilities]
- [ ] [Each bullet = one verifiable deliverable]

**Key Considerations:**
- [Architectural note or constraint discovered during recon]
- [Relationship to existing features]
- [Any non-obvious requirement from brainstorm]

**Affected Areas:** [backend, frontend, shared, etc.]

**Dependencies:** [Task X.Y, etc. or None]
```

**Writing good bullet points — this is the whole point:**

- Describe WHAT, not HOW — "Add real-time notifications for task status changes" not "Create a WebSocket event handler in server.ts that broadcasts..."
- Each bullet should be independently verifiable
- Include enough context that someone picking this up months later understands the intent
- Leave implementation decisions open — the implementer plans based on current project state at that time
- Don't specify exact file paths, function names, or technical approach unless there's a genuine hard constraint

### 5. Place in TASKS.md

- Determine the right phase/section for the new task
- Assign the next available task number within that phase
- If it doesn't fit an existing phase, propose adding it to the most relevant one or creating a new section
- Update the dependency table at the bottom if one exists
- Update the "Last Updated" date and status line at the end of the file

**Always show the user the proposed entry before writing it.** Let them adjust wording, priority, or scope before committing to the file.

## What This Skill Does NOT Do

- Create implementation plans — that's for `superpowers:writing-plans` when the task is picked up
- Write full design docs — that's for `superpowers:brainstorming` at implementation time
- Specify exact file paths or function signatures in deliverables
- Over-constrain the technical approach
- Skip the brainstorm — even "obvious" ideas benefit from 1-2 clarifying questions

## Example

**User says:** "We need to add notifications so users know when an agent needs input"

**After brainstorm (1-2 questions about scope and delivery) and architectural recon:**

```markdown
### Task 5.4: Push Notifications for Agent Input Requests

**Priority:** P1
**Estimated Time:** 1 day

**Deliverables:**
- [ ] Notify user when agent is awaiting input (browser push notification)
- [ ] Show unread/pending count badge in mobile nav
- [ ] Tapping notification navigates to the relevant task chat
- [ ] Respect notification permissions and provide settings toggle

**Key Considerations:**
- Builds on existing WebSocket event system for real-time delivery
- Service worker needed for push notifications when app is backgrounded
- Mobile-first: notification UX should work well on phone lock screens

**Affected Areas:** frontend (service worker, nav badge), backend (notification triggers)

**Dependencies:** Task 2.3 (WebSocket events)
```

Notice: no file paths, no function names, no implementation details. Just clear outcomes and enough context to plan properly when the work begins.
