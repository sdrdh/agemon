# Native Chat App Navigation — Design

## Goal
Replace the top navigation bar with a bottom tab bar (iOS/Android native chat pattern). Hide the bottom nav entirely on the task detail page so it feels like a full-screen chat.

## Changes

### `frontend/src/App.tsx`

**Remove:** `NavBar` component and `NAV_LINKS` constant.

**Add `BottomNav`:**
- Fixed bottom: `fixed bottom-0 left-0 right-0 z-50 bg-background border-t pb-[env(safe-area-inset-bottom)]`
- Uses `useMatches` to detect `/tasks/$id` route — returns `null` when matched
- 4 items with lucide-react icons + text labels: Home (Tasks), KanbanSquare (Kanban), TerminalSquare (Sessions), LogOut (Logout)
- Active link styling via TanStack Router `Link` activeProps

**Update `RootLayout`:**
- Detect `isTaskDetail` via `useMatches`
- Show minimal top header ("Agemon" branding) only when `!isTaskDetail`
- Add `pb-16` to `<main>` wrapper only when `!isTaskDetail`

### `frontend/src/routes/tasks.$id.tsx`

- Change `h-[calc(100dvh-3rem)]` to `h-dvh` (full viewport — no top nav offset)
- Add `pb-[env(safe-area-inset-bottom)]` to the sticky bottom input bar container

### Unchanged
- Routing, lazy loading, error boundary, login flow, WsProvider
- Task detail internals (back button, session sidebar, chat panels)
