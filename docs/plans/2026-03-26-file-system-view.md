# File System View

**Status:** Implemented

File tree browser surfaced in two places: session panel (alongside diff viewer) and Settings → Files.

## API

- `GET /api/sessions/:id/fs?path=&depth=` — tree rooted at `session.meta.cwd`
- `GET /api/fs?path=&depth=` — tree rooted at `~`
- `GET /api/fs/file?path=` — file read relative to `~`; `GET /api/sessions/:id/file` — `repo` param now optional (no repo = plain read, no diff)

Shared `readFsTree(root, relPath, depth)` in `backend/src/lib/fs-tree.ts`. Excludes `.git`, `node_modules`, `dist`, `.cache`. Path traversal guard on all endpoints.

## Component

`FileTreeViewer` in `frontend/src/components/custom/file-tree-viewer.tsx`:
- `mode="session"` — uses session endpoints, "Changed only" filter from `diffRepos` prop
- `mode="fs"` — uses general endpoints, plain file view

Tree state is `Map<path, FsEntry[]>`. Initial fetch depth=2, lazy background fetch on expand.

## Integration

- `sessions.$id.tsx` — Files modal alongside diff modal, diff repos fetched once and shared
- `SessionMobileHeader` / `ChatPanel` / `SessionChatPanel` — `onFiles` prop chain
- `settings.tsx` — Files section with `FileTreeViewer mode="fs"`
- Tasks plugin (`extensions/tasks/renderers/page.tsx`) — Files button in task header, `FileTreeViewer` exposed via `window.__AGEMON__.host`
