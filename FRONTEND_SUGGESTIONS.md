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

## 5. Theme Color Suggestions

Given that Agemon is an "AI agent orchestration platform," its theme should convey efficiency, intelligence, and modern dev tools. Here are three theme color palettes that could be implemented in `index.css`:

### Palette 1: "Cyber Indigo" (Modern & Tech-Forward)
This leans into a high-tech "AI" vibe without being overwhelmingly bright.
*   **Examples in the wild:** Linear (when using the Indigo/Violet theme), Stripe dashboard, Supabase (dark mode accents).
*   **Primary (Light Mode):** Indigo-600 (`#4f46e5`) — Trustworthy, slightly energetic.
*   **Primary (Dark Mode):** Indigo-400 (`#818cf8`) — Glows well against dark backgrounds.
*   **Background (Dark):** Slate-900 (`#0f172a`) — Softer than pure black (`#000`), easier on the eyes for terminal-heavy apps.
*   **Accents:**
    *   **Success (Working):** Emerald-500 (`#10b981`)
    *   **Warning (Awaiting Input):** Amber-500 (`#f59e0b`)

### Palette 2: "Terminal Green" (Hacker / CLI Nostalgia)
A nod to classic terminal interfaces, very fitting for a headless, developer-centric agent tool.
*   **Examples in the wild:** Oh My Zsh (default themes), iTerm2 (default colors), classic Matrix terminals, HTB (Hack The Box).
*   **Primary:** Emerald-500 (`#10b981`) or a slightly neon green.
*   **Background (Dark):** Zinc-950 (`#09090b`) or pure black.
*   **Muted Elements:** Zinc-500 (`#71717a`)
*   **Accents:**
    *   Use a vibrant Cyan (`#06b6d4`) for "working" states to differentiate from the primary green.
    *   Use a bold Red (`#ef4444`) for errors/crashed sessions.

### Palette 3: "Monochrome Stealth" (Minimalist & Focused)
Focuses entirely on the content (the agent's thought stream and output) rather than the UI. Similar to Vercel's stark aesthetic.
*   **Examples in the wild:** Vercel (dashboard & docs), Next.js documentation, shadcn/ui (default theme), GitHub (in high-contrast or standard dark modes).
*   **Primary:** Pure Black (`#000`) for light mode, Pure White (`#fff`) for dark mode.
*   **Background:** True White (`#ffffff`) for light mode, Zinc-950 (`#09090b`) for dark.
*   **Borders:** Very subtle grays (e.g., Zinc-200 / Zinc-800).
*   **Accents (Status Indication only):**
    *   Keep agent status dots bright (Blue for starting, Green for running, Yellow for interrupted).

### Palette 4: "Graphite Line Indigo" (Professional & Subtly Bold)
A clean, minimal, and typography-driven palette. It is perfect when you want the content itself to shine while maintaining a modern vibe.
*   **Background (Light Mode):** Soft off-white (`#f3f4f8`)
*   **Background (Dark Mode):** Deep graphite (`#070810`)
*   **Primary Elements / Borders:** Graphite grays (`#252734`, `#44475c`)
*   **Text (Light Mode):** Deep graphite (`#070810`)
*   **Text (Dark Mode):** Soft off-white (`#f3f4f8`) or light gray (`#b1b5c4`)
*   **Accents:** Indigo can be used as a highlight color for headings, important metrics, or active states to stand out against the graphite tones.

### Classic IDE Themes (Familiar & Developer-Centric)
Because Agemon is a tool used heavily by developers working with code and terminals, pulling inspiration directly from the most popular IDE and code editor themes is a safe and highly requested approach.

#### "Dracula" (Vibrant & High Contrast)
A beloved dark theme across almost every editor.
*   **Background:** Deep Purple/Charcoal (`#282a36`)
*   **Current Line / UI Surfaces:** Muted Purple (`#44475a`)
*   **Foreground / Text:** Soft White (`#f8f8f2`)
*   **Accents:**
    *   Cyan (`#8be9fd`) for active items or primary buttons
    *   Green (`#50fa7b`) for "running" or success states
    *   Pink (`#ff79c6`) or Purple (`#bd93f9`) for keywords/tags

#### "One Dark Pro" (Atom / VS Code Default Style)
A balanced, slightly cooler dark theme that feels native to modern development.
*   **Background:** Dark Slate (`#282c34`)
*   **UI Surfaces / Borders:** Slightly lighter slate (`#21252b` to `#3e4451`)
*   **Foreground / Text:** Soft Gray (`#abb2bf`)
*   **Accents:**
    *   Blue (`#61afef`) for primary actions
    *   Green (`#98c379`) for "running" states
    *   Red (`#e06c75`) for "crashed" or errors

#### "GitHub Light / Dark" (Utilitarian & Clean)
Extremely readable and instantly familiar for anyone reviewing PRs or issues.
*   **Light Background:** Pure White (`#ffffff`)
*   **Light UI Surfaces:** Soft Gray (`#f6f8fa`)
*   **Light Borders:** Gray (`#d0d7de`)
*   **Dark Background:** Deep Navy/Black (`#0d1117`)
*   **Dark UI Surfaces:** Darker Navy (`#161b22`)
*   **Dark Borders:** Muted Gray/Blue (`#30363d`)
*   **Accents:**
    *   GitHub Blue (`#0969da` light / `#58a6ff` dark)
    *   GitHub Green (`#1a7f37` light / `#238636` dark)

---
*Generated by Jules after a codebase review.*
