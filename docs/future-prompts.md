# Future Feature Prompts

Ready-to-execute prompts for upcoming features. Each prompt is self-contained and can be handed directly to an agent or used as a task description.

---

## Prompt 1: Native Chat App Bottom Navigation

**Priority:** P1
**Affects:** `frontend/src/App.tsx`, `frontend/src/routes/tasks.$id.tsx`

Implement a "Native Chat App" navigation pattern in our mobile-first React app. Please execute these changes directly in the codebase.

### 1. Modify `frontend/src/App.tsx`
* Remove the existing `NavBar` component.
* Create a new `BottomNav` component fixed to the bottom (`fixed bottom-0 left-0 right-0 z-50 bg-background border-t pb-[env(safe-area-inset-bottom)]`).
* Use the `useMatches` hook from `@tanstack/react-router` to check if the active route matches `/tasks/$id`. If it does, the `BottomNav` should return `null`.
* The `BottomNav` should use `lucide-react` icons for the links (`Home` for Tasks, `KanbanSquare` for Kanban, `TerminalSquare` for Sessions, and `LogOut` for the logout button) with small text labels underneath.
* Update `RootLayout` to include a minimal top header just for branding on non-detail pages (`if (!isTaskDetail)`).
* Update the `<main>` wrapper in `RootLayout` to add bottom padding (e.g., `pb-16`) *only* if `isTaskDetail` is false, preventing content from being hidden behind the bottom nav.

### 2. Modify `frontend/src/routes/tasks.$id.tsx`
* Locate the sticky bottom input bar container: `<div className="sticky bottom-0 z-40 bg-background border-t px-4 py-3">`
* Add Tailwind classes to handle mobile safe areas so the keyboard and iOS home indicator don't overlap the input: `pb-[env(safe-area-inset-bottom)]` (or use a custom `pb-safe` utility if it exists in the Tailwind config).

---

## Prompt 2: Activity-Specific Icons in Chat

**Priority:** P2
**Affects:** `frontend/src/routes/tasks.$id.tsx`

We need to visually distinguish the different types of agent activities in our chat interface by adding specific icons for thoughts, tool calls, and skills.

Please make the following changes directly in `frontend/src/routes/tasks.$id.tsx`:

### 1. Import New Icons
* Import appropriate icons from `lucide-react` to represent different activities. For example, use `Brain` (or `Lightbulb`) for thoughts, `Wrench` (or `Terminal`) for standard tool calls, and `Zap` (or `Code`) for skills.

### 2. Update the Parsing Logic
* If "skills" are currently grouped generically under "tool calls" in `parseActivityMessages`, update the regex or parsing logic to identify and categorize them distinctly so they can be rendered with their specific icon.

### 3. Update the `ActivityGroup` Component
* Modify the rendering loop for tool calls/skills so that the new activity-specific icon is displayed alongside the existing status icons (`Check`, `X`, `Loader2`).
* Update the rendering section for `thoughts`. Add the designated thought icon inline with the text or just to the left of the thought content.
* Ensure the spacing, alignment, and icon sizes (e.g., `h-3.5 w-3.5`) remain consistent with the clean, mobile-friendly design of the rest of the component.

---

## Prompt 3: Component Splitting

**Priority:** P2
**Affects:** `frontend/src/routes/tasks.$id.tsx` → `frontend/src/components/custom/task-detail/`

Extract the sub-components from `tasks.$id.tsx` into separate files to reduce file complexity:

* `TaskInfoDrawer` → `src/components/custom/task-detail/task-info-drawer.tsx`
* `SessionListPanel` → `src/components/custom/task-detail/session-list-panel.tsx`
* `SessionChatPanel` → `src/components/custom/task-detail/session-chat-panel.tsx`
* `ActivityGroup`, `ChatBubble`, and helper functions → `src/components/custom/task-detail/chat-components.tsx`
* Reduce `tasks.$id.tsx` to layout composition, state management, and mutations only.
