# Frontend Suggestions & TODOs

**From: Jules**

## Overview
Based on a review of the Agemon frontend codebase, here are some suggestions and TODOs to improve styling, UX/UI, routing flow, and code maintainability.

## 1. Styling & UX Improvements

### General
*   **TODO:** Consider a consistent max-width for desktop views. The application currently seems to stretch fully across wide screens (except maybe where panels are fixed). Adding a `max-w-7xl mx-auto` or similar wrapper for the main content area could improve readability on ultrawide monitors.
*   **TODO:** The touch targets are explicitly mentioned in `AGENTS.md` to be at least 44x44px for mobile. Double-check all custom interactive elements (like custom task cards or smaller icon buttons in the session list) to ensure they strictly adhere to this rule, particularly on the session chat panel header.
*   **TODO:** Dark mode implementation uses standard Tailwind `dark:` classes, but verify contrast ratios on some of the custom badge colors (e.g., `bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300` in `sessions.tsx`), ensuring they remain legible in dark mode.

### Kanban Board (`kanban.tsx`)
*   **TODO:** Mobile collapsible columns currently default to closed if we follow standard state (`useState({})`), although the comment says "default-open columns that have tasks". To actually implement that, the initial state of `collapsed` should be derived from the data once it loads, or use a `useEffect` to open columns that have items.
*   **TODO:** Provide visual feedback when dragging tasks (if drag-and-drop is ever added). For now, since tasks are system-controlled, maybe add a subtle visual cue explaining why they aren't draggable if users try to interact with them that way.

### Task Details & Chat (`tasks.$id.tsx`)
*   **TODO:** The chat panel auto-scrolls to the bottom on every new message or activity. This can be disruptive if the user has manually scrolled up to read older messages. Consider implementing a "sticky scroll" behavior where it only auto-scrolls if the user is already near the bottom, and perhaps show a "New messages below" floating button otherwise.
*   **TODO:** The Markdown rendering inside chat bubbles (`ChatBubble`) might benefit from syntax highlighting for code blocks (using something like `rehype-prism-plus` or `highlight.js` alongside `react-markdown`).
*   **TODO:** The `ActivityGroup` component could use a slightly smoother animation when expanding/collapsing. Right now it appears instantly.

## 2. Flow & Routing Architecture

### Navigation
*   **TODO:** The bottom navigation bar (`BottomNav` in `App.tsx`) disappears completely when inside a task detail view (`/tasks/$id`). While this maximizes screen real estate for the chat, it forces the user to use the top-left "Back" arrow. Consider if there's a need for a quicker way to jump between open tasks or the Kanban board directly from the task view on desktop.
*   **TODO:** The routing uses `@tanstack/react-router`, which is excellent. Ensure that loader functions are utilized effectively for data prefetching to prevent the UI from showing skeletons on initial navigations where possible. Currently, queries are just fetched inside the components.

### Authentication Flow
*   **TODO:** The `LoginScreen` stores the API key using a `setApiKey` function (presumably in `localStorage` or similar). Ensure there is a mechanism to handle unauthorized (401) errors globally in the API client and gracefully redirect the user back to the login screen, clearing the invalid key.

## 3. State Management & Data Fetching

### TanStack Query Usage
*   **TODO:** Error handling in components like `index.tsx` and `kanban.tsx` shows the raw error message to the user (`error.message`). It might be better to show a more user-friendly default message and log the technical error to the console or an error tracking service.
*   **TODO:** Ensure `staleTime` and `gcTime` are configured appropriately for queries like `tasksListQuery` and `sessionsListQuery`. Given it's a real-time app with WebSockets, perhaps relying more heavily on WS events to invalidate these queries automatically rather than standard polling/stale times.

### WebSocket Store (`lib/store.ts`)
*   **TODO:** The `WsProvider` is a great pattern. Ensure that the WebSocket connection automatically reconnects with exponential backoff if the connection is lost. The UI should ideally show a small "Reconnecting..." indicator if the socket drops, as chat messages rely heavily on it.

## 4. Code Organization

*   **TODO:** Extract the `ChatBubble` and `ActivityGroup` components from `tasks.$id.tsx` into their own files in `components/custom/`. `tasks.$id.tsx` is very large (~900 lines) and refactoring these out would significantly improve readability.
*   **TODO:** The `parseActivityMessages` and `groupMessages` utility functions in `tasks.$id.tsx` could also be moved to a separate utility file (`lib/chat-utils.ts`) and unit tested independently.

---
*Generated by Jules after a codebase review.*
