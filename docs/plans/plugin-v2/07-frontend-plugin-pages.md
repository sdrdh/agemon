# Plugin System v2 — Frontend Plugin Pages

## Core Frontend After Extraction

Three routes survive in core:

```
/login              → auth gate
/sessions/:id       → session chat view
/p/:pluginId/*      → plugin page host
```

No hardcoded domain routes. No `/kanban`, no `/tasks/:id`, no `/settings`. If a plugin isn't loaded, its routes don't exist.

---

## Plugin Page Host (`/p/:pluginId/*`)

Already partially implemented (v1). v2 tightens the contract and handles edge cases.

```tsx
// frontend/src/routes/plugin.tsx
export function PluginPage() {
  const { pluginId } = useParams();
  const subPath = useWildcard(); // everything after /p/:pluginId/

  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abortController = new AbortController();

    fetchPluginPage(pluginId, subPath, abortController.signal)
      .then(mod => {
        if (!abortController.signal.aborted) setComponent(() => mod.default);
      })
      .catch(err => {
        if (!abortController.signal.aborted) setError(err.message);
      });

    return () => abortController.abort();
  }, [pluginId, subPath]);

  if (error) return <PluginErrorBoundary error={error} />;
  if (!Component) return <PluginLoadingSpinner />;
  return <Component />;
}
```

**Blob URL import** (unchanged from v1): fetch built JS → Blob → `createObjectURL` → `import(blobUrl)`. Required because `import()` doesn't handle query-param URLs directly.

**Lazy fetch** — plugin JS is only fetched when navigating to `/p/:pluginId/*`. Not on app load. Keeps startup fast regardless of how many plugins are installed.

**TanStack Router needs two route registrations** (v1 issue, carry forward):
```
/p/$pluginId         ← exact root match
/p/$pluginId/$       ← sub-paths
```
TanStack's `/*` doesn't match paths without a trailing segment.

---

## Plugin-Driven Nav Bar

Bottom nav reads from the plugin registry. No hardcoded links (except possibly `/sessions` as a permanent core link).

```tsx
function BottomNav() {
  const { connected, pluginsRevision } = useStore();

  const { data: plugins } = useQuery({
    queryKey: ['plugins', pluginsRevision],
    queryFn: () => fetch('/api/plugins').then(r => r.json()),
  });

  const navPlugins = plugins?.filter(p => p.navLabel) ?? [];

  return (
    <nav>
      {navPlugins.map(p => (
        <NavLink key={p.id} to={`/p/${p.id}/`} icon={p.navIcon} label={p.navLabel} />
      ))}
      <NavLink to="/sessions" icon="terminal" label="Sessions" />  {/* core, always last */}
    </nav>
  );
}
```

`pluginsRevision` increments on `plugins_changed` WS event (hot reload) and on reconnect (server restart). Nav refetches automatically.

**Nav ordering**: plugins declare `navOrder: number` in their manifest. Tasks = 0, system = 100, user plugins fill in between.

---

## window.__AGEMON__ Globals (unchanged from v1)

Plugin bundles externalize React, ReactDOM, lucide-react via the `@agemon/externals` Bun plugin. These are resolved at runtime from `window.__AGEMON__`:

```ts
// main.tsx
window.__AGEMON__ = {
  React,
  ReactDOM,
  jsxRuntime: { ...jsxRuntimeProd, ...jsxRuntimeDev },
  LucideReact,
};
```

Plugins don't bundle React — they reference `window.__AGEMON__.React`. Keeps plugin bundle sizes small.

---

## `ChatActions` — Interactive Renderers

v1 renderers get `{ message }` only — read-only. v2 widens to `{ message, actions }`:

```ts
interface ChatActions {
  sendMessage: (text: string) => void;
  sendMessageWithAttachment: (text: string, file: File) => void;
  showToast: (message: string, variant?: "default" | "destructive") => void;
  navigate: (path: string) => void;
  openModal: (content: React.ReactNode) => void;
}
```

Passed to renderers and `InputExtension` components. The core session chat view wires these to actual implementations and passes them down.

**Use cases:**
- `diff_ready` renderer: "Approve / Reject" buttons call `sendMessage("approve")` / `sendMessage("reject")`
- `task_created` renderer: "View Task" button calls `navigate("/p/tasks/abc123")`
- `approval_requested` renderer: displays tool input, sends approval/rejection

---

## `inputExtensions` — Chat Toolbar

New slot in the chat input area, left of the textarea:

```
[ 📎 ] [ 🎤 ] [ message textarea                  ] [ ▶ ]
  ↑      ↑
  file   voice  (from plugins)
  attach input
```

Core renders extension buttons in order. On click, the extension's component mounts as a popover or modal.

```ts
interface InputExtension {
  id: string;
  icon: string;          // lucide icon name
  tooltip: string;
  component: React.ComponentType<InputExtensionProps>;
}

interface InputExtensionProps {
  sessionId: string;
  disabled: boolean;
  inputText: string;
  onSetInputText: (text: string) => void;
  actions: ChatActions;
}
```

**file-attachment plugin example:**
```tsx
function FileAttachExtension({ onSetInputText, actions }: InputExtensionProps) {
  const handleFile = async (file: File) => {
    const b64 = await fileToBase64(file);
    actions.sendMessageWithAttachment("See attached file.", file);
  };

  return <FilePicker onSelect={handleFile} />;
}
```

---

## Settings Page

Settings is a plugin page (`/p/system/settings`), not a core route. The system plugin renders it.

Each other plugin can contribute a settings section by exporting a `settingsSection` component:

```ts
// In plugin exports:
settingsSection?: {
  title: string;
  icon: string;
  component: React.ComponentType;
}
```

The system plugin's settings page queries all loaded plugins for `settingsSection` exports and renders them as accordion sections. No core involvement.

---

## Session List

`/sessions` is the only core frontend route beyond `/login` and `/sessions/:id`. It shows all sessions regardless of plugin state — a raw list with session ID, agent type, state, and started_at.

If the tasks plugin is loaded, it adds a column showing the associated task (via its own enrichment endpoint). The core session list doesn't know about tasks.

---

## Error States

- **Plugin fails to load** (JS error during `import()`): show `PluginErrorBoundary` with error message and a "Reload" button. Don't crash the whole app.
- **Plugin not found** (navigating to `/p/nonexistent/`): 404 page with "This plugin is not installed."
- **Plugin slow to load** (large bundle): skeleton/spinner with timeout. After 10s, show "Taking a while..." with cancel option.
