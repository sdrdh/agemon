# Dashboard Overview Page — Design Spec

## Context

Agemon currently lands on a project-grouped task list (`/`). Users open the app primarily to respond to agent blockers (approvals, questions) — but the task list doesn't surface these. Users must tap into individual tasks to discover what needs attention. This dashboard replaces `/` as the landing page, giving users an instant answer to "do I need to do anything?" and "what are my agents doing?"

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Route | Replace `/` | One less tap to reach what matters. Project list absorbed into dashboard. |
| Layout | Stacked collapsible sections | Clear mental model — three buckets sorted by urgency |
| Input items | Inline cards with actions | Approve/reject/reply without navigating away. Key value prop. |
| Active sessions | Activity cards | Live activity line + token usage. Glanceable progress. |
| Navigation | Bottom nav: Home, Kanban, Sessions, Settings | Dashboard replaces Tasks nav item |
| Scale target | 1-3 concurrent tasks/agents | Richer cards acceptable; density not a priority |

## Page Structure (top to bottom)

### 1. Header
- "Agemon" title left-aligned
- Connection status indicator right-aligned (green dot + "Connected" / red "Disconnected")
- Same header pattern as existing pages

### 2. Summary Strip
Horizontal row of 4 count tiles immediately below the header:
- **Blocked** (amber) — count of pending approvals + pending inputs
- **Active** (green) — count of sessions in `running` state
- **Completed** (muted) — count of sessions that stopped/finished in the last 24 hours
- **Tasks** (neutral) — total active (non-archived) task count

Updated in real-time via WebSocket events. Provides a sub-1-second answer to "do I need to act?"

### 3. Needs Your Input Section
- **Visibility:** Only renders when there are pending items. No header, no empty state — the section simply doesn't exist when there's nothing to act on.
- **Header:** "Needs Your Input" in amber + count badge
- **Items:** Two card types, both with inline actions:

#### Approval Card
- Left border: amber (3px)
- Type badge: "⚡ APPROVAL" in amber
- Subtitle: task name · agent type
- Content: tool name + truncated context (e.g., "Run `bun test auth.test.ts`")
- Actions: **Allow** (green) + **Always Allow** (muted) + **Deny** (muted) — matches existing `ApprovalCard` three-button pattern
- When disconnected, all action buttons are disabled (uses `connected` prop from WS store)
- Timestamp: relative ("2m ago")
- Tapping the card body (not buttons) navigates to session chat for full context

#### Question Card
- Left border: blue (3px)
- Type badge: "💬 QUESTION" in blue
- Subtitle: task name · agent type
- Content: the agent's question text
- Actions: text input + send button
- Timestamp: relative
- Tapping card body navigates to session chat

#### Data Sources
- `useWsStore.pendingApprovals` (filtered to `status === 'pending'`) — populated by `approval_requested` WS events
- `useWsStore.pendingInputs` — populated by `awaiting_input` WS events
- No REST endpoint needed — these are purely real-time/store-driven
- Task name + agent type resolved by cross-referencing `taskId`/`sessionId` against TanStack Query caches (`tasksListQuery`, `sessionsListQuery`)
- Real-time: `approval_requested` and `awaiting_input` WS events add items; `approval_resolved` removes them

### 4. Active Sessions Section
- **Visibility:** Always visible. Shows "No agents running" empty state with a prompt when empty.
- **Header:** "Active Sessions" in green + count badge
- **Items:** One card per session in `running` state

#### Session Activity Card
- Task name (bold) + agent type + running duration (updating)
- Green dot + "Running" status right-aligned
- **Activity line:** dark inner box showing current tool/action (e.g., "📝 Editing src/auth/middleware.ts"). Uses the existing `agentActivity` from the Zustand store, updated in real-time.
- Token count + cost below (from `sessionUsage` Zustand store when available, falling back to `session.usage` from REST response for continuity across page reloads)
- Tapping the card navigates to the session chat (`/tasks/$taskId` with session selected)

#### Data Sources
- `agent_sessions` where `state = 'running'`
- Real-time: `session_started`, `session_state_changed`, `agent_thought` (for activity label), `session_usage_update`
- Duration: computed from `started_at` to now, updated every ~30s or on activity events

### 5. Recently Completed Section
- **Visibility:** Only renders when there are recently completed sessions (last 24 hours). Disappears when empty.
- **Header:** "Recently Completed" in muted gray + count badge
- **Items:** One card per session that transitioned to `stopped` state in the last 24 hours

#### Completed Session Card
- Slightly dimmed (opacity 0.7) to visually de-prioritize
- Task name + "Finished Xm ago · Ran Ym" subtitle
- Status badge right-aligned: green "✓ Done" for `stopped` sessions, red "✗ Crashed" for `crashed` sessions
- Token count + cost (from `session.usage` in REST response, not Zustand `sessionUsage` which may be stale after reload)
- Tapping navigates to the session chat for full review

#### Data Sources
- `GET /api/sessions` response, filtered client-side to `state === 'stopped'` and `ended_at` within last 24 hours
- Sorted by `ended_at` descending (most recent first)
- The 24-hour rolling window is re-evaluated on each render cycle (triggered by WS events or query refetches). No separate timer needed — session state changes are the natural trigger.

### 6. Floating Action Button (FAB)
- Purple "+" button, bottom-right corner, above bottom nav
- 52x52px with 16px border-radius, subtle shadow
- Tapping navigates to `/tasks/new` (existing task creation form)
- Positioned to avoid overlapping the last list item (80px bottom padding on content)

### 7. Bottom Navigation
Updated from current 4 items:
- **Home** (dashboard icon) — `/` — *active on this page*
- **Kanban** — `/kanban`
- **Sessions** — `/sessions`
- **Settings** — `/settings`

The "Tasks" nav item is removed. The project-grouped task list view is accessible via a link in the dashboard or through the Kanban view.

## Real-Time Update Strategy

| WebSocket Event | Dashboard Action |
|-----------------|-----------------|
| `approval_requested` | Add to Needs Input section |
| `approval_resolved` | Remove from Needs Input section |
| `awaiting_input` | Add to Needs Input section |
| `session_started` | Add to Active Sessions |
| `session_state_changed` (→ running) | Move to Active Sessions |
| `session_state_changed` (→ stopped) | Move from Active to Recently Completed |
| `session_state_changed` (→ crashed) | Move from Active to Recently Completed (with error indicator) |
| `agent_thought` | Update activity line in Active Sessions |
| `session_usage_update` | Update token/cost in Active Sessions |
| `task_updated` | Update summary strip counts |
| `turn_completed` | Clear activity line |

All updates are optimistic from the Zustand store — no refetch needed for most events. Summary strip counts recompute from local state.

## Empty States

| State | Behavior |
|-------|----------|
| No pending inputs | "Needs Input" section not rendered at all |
| No active sessions | Section shows: "No agents running" + "Create a task to get started" link |
| No recently completed | Section not rendered |
| All three empty | Full-page empty state: illustration + "Create your first task" CTA |

## Component Hierarchy

```
DashboardPage (route: /)
├── SummaryStrip
│   └── SummaryTile × 4 (blocked, active, completed, tasks)
├── NeedsInputSection (conditional)
│   ├── SectionHeader ("Needs Your Input" + count)
│   └── InputCard[] (reuses existing ApprovalCard + new QuestionInputCard)
│       ├── ApprovalCard (existing component, adapted for dashboard context)
│       └── QuestionInputCard (new — inline text input + send)
├── ActiveSessionsSection
│   ├── SectionHeader ("Active Sessions" + count)
│   └── SessionActivityCard[] (new)
├── RecentlyCompletedSection (conditional)
│   ├── SectionHeader ("Recently Completed" + count)
│   └── CompletedSessionCard[] (new)
└── FAB (Create Task button)
```

## Reusable Existing Components
- **ApprovalCard** (`frontend/src/components/custom/approval-card.tsx`) — already handles Allow/Always Allow/Deny with expandable context. Create a `DashboardApprovalCard` wrapper that adds task name subtitle and adjusts layout for the non-chat context (no chat bubble wrapper, standalone card styling).
- **StatusBadge** (`frontend/src/components/custom/StatusBadge.tsx`) — for session state indicators
- **Badge** (`frontend/src/components/ui/badge.tsx`) — for count badges in section headers
- **ConnectionBanner** (`frontend/src/components/custom/ConnectionBanner.tsx`) — connection status (may adapt for header indicator)

## Reusable Existing State
- `pendingApprovals` from Zustand store — already tracks all pending approvals globally
- `pendingInputs` from Zustand store — already tracks pending agent questions
- `agentActivity` from Zustand store — live activity labels per session
- `sessionUsage` from Zustand store — token/cost per session
- TanStack Query `sessionsQuery()` — fetches all sessions
- TanStack Query `tasksQuery()` — fetches all tasks

## New API Endpoint
**None required.** All data is available through existing endpoints and the Zustand store. The dashboard computes its views from:
- `GET /api/sessions` (with client-side filtering by state)
- `GET /api/tasks` (for counts)
- Zustand store for real-time state (approvals, inputs, activity, usage)

## Navigation Changes

### Route Changes
- `/` route: `ProjectListView` → `DashboardPage`
- `/projects` (new route): reuses existing `ProjectListView` component unchanged. Add to `App.tsx` route tree.
- Bottom nav in `App.tsx` `NAV_ITEMS` array: change first item from `{ label: 'Tasks', path: '/', icon: ... }` to `{ label: 'Home', path: '/', icon: Home }`
- All existing links to `/` continue to work (they now land on dashboard)

### Deliverables
1. New `DashboardPage` component at `frontend/src/routes/index.tsx` (replaces current `ProjectListView`)
2. New `/projects` route at `frontend/src/routes/projects.tsx` (move `ProjectListView` here)
3. Update `NAV_ITEMS` in `App.tsx`: "Tasks" → "Home", icon change
4. Add `/projects` to `App.tsx` route tree

### Connection Status
Replace the existing `ConnectionBanner` (full-width red banner on disconnect) with a compact header indicator on the dashboard. Since `ConnectionBanner` is rendered globally in `App.tsx` (outside the router), make it route-aware: hide it on `/` where the dashboard header handles connection status, keep it on all other pages.

## Loading & Error States

### Loading
On initial mount, the dashboard depends on `tasksListQuery` and `sessionsListQuery` (both TanStack Query). Show a skeleton layout matching the section structure: summary strip with placeholder tiles, 2 skeleton cards in the active sessions area. Follow the existing skeleton pattern from `ProjectListView` (`frontend/src/routes/index.tsx`).

### Errors
If REST queries fail, show a full-page error with retry button (matching existing `ProjectListView` pattern). Sections that depend only on Zustand store data (Needs Input) remain functional even if REST fails, since they're populated via WebSocket events.

## Accessibility
- All interactive elements meet 44×44px minimum touch targets
- Section headers are semantic `<h2>` elements
- Cards use `role="button"` with keyboard handlers for navigation
- Approve/Deny buttons are properly labeled
- Text input in question cards has proper label association
- Summary strip tiles have `aria-label` with full text (e.g., "2 sessions blocked on your input")
