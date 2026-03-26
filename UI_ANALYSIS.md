# Agemon UI & Extension System Analysis

**Date:** March 2026
**Focus:** Semantic Layouts, Mobile-First UX, and Plugin Integration

---

## 1. Information Architecture (Urgency vs. State)

### The "Inbox" Model for Blockers
*   **Observation:** The dashboard (`index.tsx`) uses an Accordion to group items by state ("Needs Your Input", "Active Sessions", "Idle Sessions", "Completed").
*   **Semantic Issue:** An Accordion implies all sections have roughly equal hierarchical importance and can be tucked away. However, "Needs Your Input" is a **blocking state** where the AI is literally waiting for the human to unblock it (costing time and money).
*   **Recommendation:** Remove "Needs Your Input" from the accordion entirely. Display these as **persistent, high-priority Action Cards** pinned to the top of the dashboard (an "Inbox" model). Only secondary states like "Active" or "Idle" should be collapsible.

---

## 2. Signal-to-Noise Ratio

### Chat Feed vs. Thought Chains
*   **Observation:** A session's terminal/chat feed streams everything linearly, combining "Thoughts" (internal reasoning) and "Actions" (executing commands, writing files).
*   **Semantic Issue:** For a human reviewing on mobile, 50 lines of an agent's internal monologue is low-value data compared to the actual Action or Question. It forces excessive scrolling.
*   **Recommendation:** Group contiguous "Thought" events into a visually distinct, collapsed block (e.g., a muted gray pill that says _"Agent reasoned for 45s... [Expand]"_). This ensures the chat timeline primarily highlights **what the agent actually did** and **what it is asking you**, drastically reducing cognitive load on mobile.

### Diff Reviewing Cognitive Load
*   **Observation:** The user is asked to approve file changes via diffs.
*   **Semantic Issue:** Standard side-by-side or raw unified diffs break down on vertical mobile screens.
*   **Recommendation:** Ensure the `DiffViewer` component heavily prioritizes **Inline/Unified Diffs** by default. Use sticky headers for filenames so as the user scrolls down a long file change, they don't forget which file they are looking at. Use full-bleed background colors for additions (green) and deletions (red) to maximize readability.

---

## 3. Task Context

### Task vs. Session Hierarchy
*   **Observation:** A single Task can have multiple active Sessions running in parallel.
*   **Semantic Issue:** When drilling into a task, flattening sessions might confuse the user about who is doing what.
*   **Recommendation:** In the `Task Detail` view, implement a horizontal, swipeable "Avatar/Pill" bar at the very top (just under the header). This allows the user to quickly swipe between active agent sessions working on the same task without losing the context of the overarching goal.

---

## 4. Layout Constraints & Structural UX

### Task Session List Full-Height Viewport
*   **Observation:** The layout in the task session list page (`/tasks/$id` or equivalent) doesn't fill the whole viewport if there are no sessions or very few.
*   **Structural Issue:** The separator line (usually a border on the side panel or between list items) stops abruptly instead of extending cleanly down to the `BottomNav`.
*   **Recommendation:** Ensure the container for the session list (likely a sidebar or a flex column) has `flex-grow` or `h-full` applied so it consistently fills the available vertical space down to the navigation bar.

### Mobile Navigation Padding for Plugins
*   **Observation:** The `BottomNav` relies on `pb-[env(safe-area-inset-bottom)]`. Standard routes accommodate this using `pb-16` on the `<main>` tag.
*   **Structural Issue:** Third-party plugins may not know to add this padding, resulting in their bottom content being obscured by the navigation bar.
*   **Recommendation:** Pass a standard CSS variable (e.g., `--bottom-nav-height`) or layout property to plugins so they can dynamically adjust their padding.

---

## 5. Plugin & Extension Architecture

### Slot Injection vs. Full Pages
*   **Observation:** Plugins (`/p/pluginId`) currently take over the full page routing.
*   **Semantic Issue:** Many plugins semantically relate to specific contexts. For example, a `voice-input` plugin shouldn't be a separate page; it belongs next to the chat text box. `server-logs` might make sense as a dashboard widget.
*   **Recommendation:** Evolve the `PluginKit` to support **Slot Injection**. Allow plugins to register React components into predefined UI slots like `ChatInputSuffix`, `DashboardWidgetArea`, or `TaskDetailHeader`. This changes extensions from being disconnected pages to being deeply contextual enhancements.

### Plugin Error Isolation
*   **Observation:** Plugin loading/compilation errors are caught nicely, but if a React component inside a plugin crashes *during render*, the error propagates up.
*   **Structural Issue:** The crash hits the global `<ErrorBoundary>` in `App.tsx`, replacing the entire dashboard UI instead of just the broken plugin.
*   **Recommendation:** Add an `<ErrorBoundary>` explicitly within `plugin.tsx` (`PluginPage`) so that a single misbehaving plugin doesn't break the host application's navigation.

### Dynamic Plugin Asset Loading
*   **Observation:** Fetching and parsing plugin icons dynamically via `fetchPluginIcon` executes remote JS blobs.
*   **Structural Issue:** While functional and safe within the trusted server environment, it adds overhead.
*   **Recommendation:** Rely primarily on the bundled `lucide-react` string resolution for plugin icons where possible to ensure maximum performance and stability on mobile clients.
