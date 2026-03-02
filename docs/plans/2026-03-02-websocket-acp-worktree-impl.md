# WebSocket Real-Time + ACP JSON-RPC + Git Worktrees Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire frontend to WebSocket events via TanStack Query + Zustand, implement ACP JSON-RPC 2.0 handshake so agents actually work, and create git worktree isolation per task.

**Architecture:** Three independent streams executed in parallel. Stream A adds state management + real-time UI. Stream B rewrites the ACP transport layer to use JSON-RPC 2.0. Stream C creates the git worktree manager. Integration happens after all three complete.

**Tech Stack:** TanStack Query v5, Zustand v5, simple-git, Bun test runner, JSON-RPC 2.0

---

## Stream A: WebSocket Real-Time + State Management

### Task A1: Install TanStack Query + Zustand

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install dependencies**

Run from repo root:
```bash
cd frontend && bun add @tanstack/react-query zustand
```

**Step 2: Verify install**

Run: `cd frontend && bun run build`
Expected: Build succeeds with 0 errors.

**Step 3: Commit**

```bash
git add frontend/package.json frontend/bun.lockb
git commit -m "feat: add @tanstack/react-query and zustand dependencies"
```

---

### Task A2: Create QueryClient setup + query key factories

**Files:**
- Create: `frontend/src/lib/query.ts`

**Step 1: Create the query client module**

```typescript
// frontend/src/lib/query.ts
import { QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, TasksByProject, ACPEvent } from '@agemon/shared';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s — WS events keep data fresh between refetches
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

// ─── Query Key Factories ──────────────────────────────────────────────────────
// Hierarchical keys enable granular invalidation.
// invalidate(['tasks']) busts all task-related queries.
// setQueryData(['tasks', 'detail', id]) updates one task without refetch.

export const taskKeys = {
  all: ['tasks'] as const,
  byProject: () => [...taskKeys.all, 'by-project'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  events: (id: string) => [...taskKeys.all, 'events', id] as const,
};

// ─── Query Options Factories ──────────────────────────────────────────────────
// Used with useQuery({ ...tasksByProjectQuery() })

export function tasksByProjectQuery() {
  return {
    queryKey: taskKeys.byProject(),
    queryFn: (): Promise<TasksByProject> => api.listTasksByProject(),
  };
}

export function taskDetailQuery(id: string) {
  return {
    queryKey: taskKeys.detail(id),
    queryFn: (): Promise<Task> => api.getTask(id),
    enabled: !!id,
  };
}

export function taskEventsQuery(id: string, limit = 500) {
  return {
    queryKey: taskKeys.events(id),
    queryFn: (): Promise<ACPEvent[]> => api.listEvents(id, limit),
    enabled: !!id,
  };
}
```

Note: `api.listEvents` doesn't exist yet. We'll add it in a later step.

**Step 2: Verify TS compiles**

Run: `cd frontend && bunx tsc --noEmit`
Expected: Error about `api.listEvents` not existing. That's fine — we'll fix in Step 3.

**Step 3: Add listEvents to api.ts**

Add to `frontend/src/lib/api.ts` at the end of the `api` object (line 66, before the closing `}`):

```typescript
  listEvents: (id: string, limit = 500) => request<ACPEvent[]>(`/tasks/${id}/events?limit=${limit}`),
```

Also add `ACPEvent` to the import on line 1:

```typescript
import type { Task, CreateTaskBody, UpdateTaskBody, Repo, TasksByProject, AgentSession, ACPEvent } from '@agemon/shared';
```

**Step 4: Verify TS compiles clean**

Run: `cd frontend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 5: Commit**

```bash
git add frontend/src/lib/query.ts frontend/src/lib/api.ts
git commit -m "feat: add TanStack Query client with query key factories"
```

---

### Task A3: Create Zustand store for WebSocket state

**Files:**
- Create: `frontend/src/lib/store.ts`

**Step 1: Create the Zustand store**

This store holds ephemeral state that comes from WebSocket events and doesn't need to survive page refresh: live thought streams, connection status, and pending input prompts.

```typescript
// frontend/src/lib/store.ts
import { create } from 'zustand';

interface PendingInput {
  inputId: string;
  taskId: string;
  question: string;
  receivedAt: number;
}

interface WsState {
  connected: boolean;
  /** Live thought stream per task. Keyed by taskId. Most recent last. */
  thoughts: Record<string, string[]>;
  /** Pending input prompts from agents. */
  pendingInputs: PendingInput[];

  // ── Actions ──
  setConnected: (connected: boolean) => void;
  appendThought: (taskId: string, content: string) => void;
  clearThoughts: (taskId: string) => void;
  addPendingInput: (input: PendingInput) => void;
  removePendingInput: (inputId: string) => void;
}

const MAX_THOUGHTS_PER_TASK = 500;

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  thoughts: {},
  pendingInputs: [],

  setConnected: (connected) => set({ connected }),

  appendThought: (taskId, content) =>
    set((state) => {
      const existing = state.thoughts[taskId] ?? [];
      const updated = [...existing, content];
      // Cap buffer to prevent memory issues on long-running agents
      const trimmed = updated.length > MAX_THOUGHTS_PER_TASK
        ? updated.slice(updated.length - MAX_THOUGHTS_PER_TASK)
        : updated;
      return { thoughts: { ...state.thoughts, [taskId]: trimmed } };
    }),

  clearThoughts: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...rest } = state.thoughts;
      return { thoughts: rest };
    }),

  addPendingInput: (input) =>
    set((state) => ({
      pendingInputs: [...state.pendingInputs, input],
    })),

  removePendingInput: (inputId) =>
    set((state) => ({
      pendingInputs: state.pendingInputs.filter((p) => p.inputId !== inputId),
    })),
}));
```

**Step 2: Verify TS compiles**

Run: `cd frontend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add frontend/src/lib/store.ts
git commit -m "feat: add Zustand store for WebSocket state (thoughts, inputs, connection)"
```

---

### Task A4: Create WsProvider — bridges WebSocket to TQ + Zustand

**Files:**
- Create: `frontend/src/components/custom/ws-provider.tsx`

**Step 1: Create the provider component**

This component subscribes to `onServerEvent()` on mount and dispatches events to both TanStack Query cache and Zustand store. It also tracks connection status.

```typescript
// frontend/src/components/custom/ws-provider.tsx
import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onServerEvent, onConnectionChange } from '@/lib/ws';
import { useWsStore } from '@/lib/store';
import { taskKeys } from '@/lib/query';
import type { ServerEvent, Task, TasksByProject } from '@agemon/shared';

export function WsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const setConnected = useWsStore((s) => s.setConnected);
  const appendThought = useWsStore((s) => s.appendThought);
  const addPendingInput = useWsStore((s) => s.addPendingInput);

  useEffect(() => {
    const unsubEvent = onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case 'task_updated': {
          const task = event.task;
          // Update detail cache in-place (no refetch)
          qc.setQueryData(taskKeys.detail(task.id), task);
          // Invalidate list queries so they refetch
          qc.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'agent_thought': {
          appendThought(event.taskId, event.content);
          // Also invalidate events query so historical view stays fresh
          qc.invalidateQueries({ queryKey: taskKeys.events(event.taskId) });
          break;
        }
        case 'awaiting_input': {
          addPendingInput({
            inputId: event.inputId,
            taskId: event.taskId,
            question: event.question,
            receivedAt: Date.now(),
          });
          // Task status changed — invalidate
          qc.invalidateQueries({ queryKey: taskKeys.detail(event.taskId) });
          qc.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
        case 'session_started':
        case 'session_state_changed': {
          // These affect task status — invalidate relevant queries
          const taskId = 'taskId' in event ? event.taskId : undefined;
          if (taskId) {
            qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
          }
          qc.invalidateQueries({ queryKey: taskKeys.byProject() });
          break;
        }
      }
    });

    const unsubConn = onConnectionChange(setConnected);

    return () => {
      unsubEvent();
      unsubConn();
    };
  }, [qc, setConnected, appendThought, addPendingInput]);

  return <>{children}</>;
}
```

**Step 2: Verify TS compiles**

Run: `cd frontend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add frontend/src/components/custom/ws-provider.tsx
git commit -m "feat: add WsProvider bridging WebSocket events to TQ + Zustand"
```

---

### Task A5: Wire providers into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx:1-137`

**Step 1: Add imports and wrap the authed UI**

Add imports at top of `App.tsx`:

```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query';
import { WsProvider } from './components/custom/ws-provider';
```

Then wrap the authed return (lines 120-136) so the router is inside both providers. Replace the authed return block:

```typescript
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WsProvider>
          <Suspense fallback={<SuspenseFallback />}>
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="absolute top-2 right-2 z-50 min-h-[44px] min-w-[44px] text-xs text-muted-foreground"
              >
                Logout
              </Button>
              <RouterProvider router={router} />
            </div>
          </Suspense>
        </WsProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
```

**Step 2: Verify build**

Run: `cd frontend && bun run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wrap App with QueryClientProvider + WsProvider"
```

---

### Task A6: Refactor ProjectListView to use TanStack Query

**Files:**
- Modify: `frontend/src/routes/index.tsx:1-103`

**Step 1: Rewrite using useQuery**

Replace the entire file. Remove manual useState/useEffect fetch, use `useQuery` instead. The WsProvider handles cache updates via `task_updated` events, so the list auto-updates.

```typescript
// frontend/src/routes/index.tsx
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskCard } from '@/components/custom/task-card';
import { tasksByProjectQuery } from '@/lib/query';

export default function ProjectListView() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery(tasksByProjectQuery());

  if (isLoading) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Agemon</h1>
          <Button size="icon" aria-label="Create new task" onClick={() => navigate({ to: '/tasks/new' })}>
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="h-10 w-1/3 rounded-md bg-muted animate-pulse" />
          <div className="h-24 rounded-md bg-muted animate-pulse" />
          <div className="h-24 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{error instanceof Error ? error.message : 'Failed to load tasks'}</p>
        <Button variant="link" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const projectNames = Object.keys(data?.projects ?? {}).sort();
  const hasUngrouped = (data?.ungrouped ?? []).length > 0;

  return (
    <div className="pb-20">
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agemon</h1>
        <Button size="icon" aria-label="Create new task" onClick={() => navigate({ to: '/tasks/new' })}>
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {projectNames.length === 0 && !hasUngrouped && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No tasks yet.</p>
            <Button variant="link" onClick={() => navigate({ to: '/tasks/new' })}>
              Create your first task
            </Button>
          </div>
        )}

        {projectNames.map(name => (
          <section key={name}>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">{name}</h2>
            <div className="space-y-2">
              {(data?.projects[name] ?? []).map(task => (
                <TaskCard
                  key={`${name}-${task.id}`}
                  task={task}
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: task.id } })}
                />
              ))}
            </div>
          </section>
        ))}

        {hasUngrouped && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">No repository</h2>
            <div className="space-y-2">
              {(data?.ungrouped ?? []).map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: task.id } })}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd frontend && bun run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/routes/index.tsx
git commit -m "feat: refactor ProjectListView to use TanStack Query (auto-updates via WS)"
```

---

### Task A7: Refactor TaskDetailView — TQ + live thought stream

**Files:**
- Modify: `frontend/src/routes/tasks.$id.tsx:1-158`

**Step 1: Rewrite with useQuery + Zustand thoughts**

Replace the entire file. Uses `useQuery` for task data, `useWsStore` for live thought stream. Adds a scrollable thought panel below the task metadata. Also adds `useMutation` for start/stop so TQ cache stays consistent.

```typescript
// frontend/src/routes/tasks.$id.tsx
import { useRef, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/custom/status-badge';
import { RepoSelector } from '@/components/custom/repo-selector';
import { api } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { taskDetailQuery, taskKeys } from '@/lib/query';
import { useWsStore } from '@/lib/store';

export default function TaskDetailView() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const thoughtsEndRef = useRef<HTMLDivElement>(null);

  const { data: task, isLoading, error } = useQuery(taskDetailQuery(id ?? ''));
  const thoughts = useWsStore((s) => s.thoughts[id ?? ''] ?? []);
  const pendingInputs = useWsStore((s) =>
    s.pendingInputs.filter((p) => p.taskId === id)
  );

  // Auto-scroll to latest thought
  useEffect(() => {
    thoughtsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thoughts.length]);

  const startMutation = useMutation({
    mutationFn: () => api.startTask(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(id!) });
      showToast({ title: 'Agent started' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to start agent', description: err.message, variant: 'destructive' });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopTask(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.detail(id!) });
      showToast({ title: 'Stop signal sent' });
    },
    onError: (err: Error) => {
      showToast({ title: 'Failed to stop agent', description: err.message, variant: 'destructive' });
    },
  });

  async function handleRepoChange(urls: string[]) {
    if (!task) return;
    try {
      const updated = await api.updateTask(task.id, { repos: urls });
      qc.setQueryData(taskKeys.detail(task.id), updated);
    } catch (err) {
      showToast({ title: 'Failed to update repos', description: (err as Error).message, variant: 'destructive' });
    }
  }

  if (isLoading) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="h-6 w-1/3 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="p-4 space-y-4">
          <div className="h-8 w-2/3 rounded-md bg-muted animate-pulse" />
          <div className="h-20 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div>
        <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
          <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-4 text-center">
          <p className="text-destructive">{error instanceof Error ? error.message : 'Task not found'}</p>
          <Button variant="link" onClick={() => navigate({ to: '/' })}>Back to tasks</Button>
        </div>
      </div>
    );
  }

  const isRunning = task.status === 'working' || task.status === 'awaiting_input';
  const actionLoading = startMutation.isPending || stopMutation.isPending;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button size="icon" variant="ghost" aria-label="Back to tasks" onClick={() => navigate({ to: '/' })}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold flex-1 truncate">{task.title}</h1>
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="flex items-center gap-3">
          <StatusBadge status={task.status} />
          <span className="text-sm text-muted-foreground">{task.agent}</span>
        </div>

        {task.description && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1">Description</h2>
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        <RepoSelector
          selected={task.repos.map(r => r.url)}
          onChange={handleRepoChange}
        />

        {/* Action buttons */}
        <div>
          {task.status === 'todo' && (
            <Button className="w-full gap-2" onClick={() => startMutation.mutate()} disabled={actionLoading}>
              <Play className="h-4 w-4" />
              {startMutation.isPending ? 'Starting...' : 'Start Agent'}
            </Button>
          )}
          {isRunning && (
            <Button className="w-full gap-2" variant="destructive" onClick={() => stopMutation.mutate()} disabled={actionLoading}>
              <Square className="h-4 w-4" />
              {stopMutation.isPending ? 'Stopping...' : 'Stop Agent'}
            </Button>
          )}
          {task.status === 'done' && (
            <p className="text-center text-sm text-muted-foreground">Task completed</p>
          )}
        </div>

        {/* Pending input prompts */}
        {pendingInputs.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Agent needs input</h2>
            {pendingInputs.map((pi) => (
              <div key={pi.inputId} className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-3">
                <p className="text-sm font-medium mb-2">{pi.question}</p>
                <p className="text-xs text-muted-foreground">Input handling coming in next update</p>
              </div>
            ))}
          </div>
        )}

        {/* Live thought stream */}
        {(isRunning || thoughts.length > 0) && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Agent thoughts {isRunning && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse ml-1" />}
            </h2>
            <div className="rounded-lg border bg-muted/30 p-3 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
              {thoughts.length === 0 && isRunning && (
                <p className="text-muted-foreground">Waiting for agent output...</p>
              )}
              {thoughts.map((t, i) => (
                <p key={i} className="break-all whitespace-pre-wrap">{t}</p>
              ))}
              <div ref={thoughtsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd frontend && bun run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/routes/tasks.\$id.tsx
git commit -m "feat: refactor TaskDetailView with TQ + live thought stream from Zustand"
```

---

### Task A8: Wire send_input handler on backend

**Files:**
- Modify: `backend/src/server.ts:98-124`

**Step 1: Handle send_input events from WebSocket clients**

Currently `server.ts` line 115 emits `ws:client_event` to the eventBus but nothing listens. Add a handler that processes `send_input` events: looks up the awaiting_input row, marks it answered, and writes the response back. For now, the actual stdin write to the agent will be wired in Stream B (JSON-RPC). Here we close the DB loop and update task status.

Add this block after line 131 (after the `broadcast` function), before the Routes section:

```typescript
// ─── Client Event Handlers ───────────────────────────────────────────────────
eventBus.on('ws:client_event', (ev: ClientEvent) => {
  if (ev.type === 'send_input') {
    const { db } = require('./db/client.ts');
    const input = db.answerInput(ev.inputId, ev.response);
    if (!input) {
      console.warn(`[ws] send_input: unknown inputId ${ev.inputId}`);
      return;
    }
    // If no more pending inputs, move task back to working
    const pending = db.listPendingInputs(ev.taskId);
    if (pending.length === 0) {
      db.updateTask(ev.taskId, { status: 'working' });
      const task = db.getTask(ev.taskId);
      if (task) broadcast({ type: 'task_updated', task });
    }
    console.info(`[ws] send_input answered for task=${ev.taskId} input=${ev.inputId}`);
  }
});
```

Wait — `require` won't work in ESM context. Use the already-imported `db` instead. Actually, `db` is imported in `routes/tasks.ts` but not in `server.ts`. We need to import it.

Add to server.ts imports (after line 8):

```typescript
import { db } from './db/client.ts';
```

Then use `db` directly in the handler (no `require`).

**Step 2: Verify build**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors. (The `db` import may cause a circular dep warning but should be fine since server.ts already dynamically imports routes/tasks.ts which imports db.)

**Step 3: Run smoke tests**

```bash
# Terminal 1: start backend
cd backend && rm -f agemon.db* && AGEMON_KEY=test bun run src/server.ts

# Terminal 2: run tests
./scripts/test-api.sh
```

Expected: All 21 tests pass.

**Step 4: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: wire send_input WS handler — marks input answered, updates task status"
```

---

## Stream B: ACP JSON-RPC 2.0

### Task B1: Create JSON-RPC 2.0 transport layer

**Files:**
- Create: `backend/src/lib/jsonrpc.ts`

**Step 1: Implement the transport**

This is a generic JSON-RPC 2.0 transport that works over any stdin/stdout pair. It handles:
- Newline-delimited JSON framing
- Request/response correlation by auto-incrementing `id`
- Notification dispatch (messages without `id`)
- Request timeouts

```typescript
// backend/src/lib/jsonrpc.ts

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg);
}

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg;
}

type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>;

export class JsonRpcTransport {
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private notificationHandlers: NotificationHandler[] = [];
  private requestHandlers: RequestHandler[] = [];
  private stdin: { write(data: Uint8Array | string): number | Promise<number> };
  private closed = false;
  private buffer = '';
  private encoder = new TextEncoder();

  constructor(
    stdin: { write(data: Uint8Array | string): number | Promise<number> },
    stdout: ReadableStream<Uint8Array>,
    private timeoutMs = 30_000,
  ) {
    this.stdin = stdin;
    this.readLoop(stdout);
  }

  /** Send a request and wait for the response. */
  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw new Error('Transport is closed');
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request ${method} (id=${id}) timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.send(msg);
    });
  }

  /** Send a notification (no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, ...(params !== undefined && { params }) };
    this.send(msg);
  }

  /** Register a handler for incoming notifications from the agent. */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandlers.push(handler);
  }

  /** Register a handler for incoming requests from the agent (agent → client). */
  onRequest(handler: RequestHandler): void {
    this.requestHandlers.push(handler);
  }

  /** Close the transport and reject all pending requests. */
  close(): void {
    this.closed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Transport closed'));
    }
    this.pending.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private send(msg: JsonRpcMessage): void {
    const line = JSON.stringify(msg) + '\n';
    this.stdin.write(this.encoder.encode(line));
  }

  private async readLoop(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += decoder.decode(value, { stream: true });
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg: JsonRpcMessage = JSON.parse(line);
            if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
              // Not a JSON-RPC message — emit as raw line
              for (const h of this.notificationHandlers) h('__raw__', line);
              continue;
            }
            this.dispatch(msg);
          } catch {
            // Non-JSON line — emit as raw
            for (const h of this.notificationHandlers) h('__raw__', line);
          }
        }
      }
    } catch (err) {
      if (!this.closed) {
        console.error('[jsonrpc] read loop error:', err);
      }
    } finally {
      reader.releaseLock();
      this.close();
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if (isResponse(msg)) {
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
        } else {
          entry.resolve(msg.result);
        }
      }
    } else if (isNotification(msg)) {
      for (const h of this.notificationHandlers) h(msg.method, msg.params);
    } else if (isRequest(msg)) {
      // Agent sending a request to the client (rare, but part of spec)
      this.handleIncomingRequest(msg);
    }
  }

  private async handleIncomingRequest(msg: JsonRpcRequest): Promise<void> {
    for (const h of this.requestHandlers) {
      try {
        const result = await h(msg.method, msg.params);
        if (result !== undefined) {
          const response: JsonRpcResponse = { jsonrpc: '2.0', id: msg.id, result };
          this.send(response);
          return;
        }
      } catch (err) {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: (err as Error).message },
        };
        this.send(response);
        return;
      }
    }
    // No handler matched — respond with method not found
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    };
    this.send(response);
  }
}
```

**Step 2: Verify TS compiles**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add backend/src/lib/jsonrpc.ts
git commit -m "feat: add JSON-RPC 2.0 transport layer for ACP communication"
```

---

### Task B2: Add agent spawn config map

**Files:**
- Create: `backend/src/lib/agents.ts`

**Step 1: Create agent configuration**

Each agent type has a different binary, args, and env var requirements. Extract this into a config map so `acp.ts` can look up spawn details per agent type.

```typescript
// backend/src/lib/agents.ts
import type { AgentType } from '@agemon/shared';

export interface AgentConfig {
  /** Command to spawn. First element is binary, rest are args. */
  command: string[];
  /** Environment variables to pass from the host to the agent process. */
  passEnvVars: string[];
  /** Human-readable label. */
  label: string;
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  'claude-code': {
    command: ['claude-agent-acp', '--agent', 'claude-code'],
    passEnvVars: [], // Uses `claude /login` session — no env vars needed
    label: 'Claude Code (via claude-agent-acp)',
  },
  'opencode': {
    command: ['opencode', 'acp'],
    passEnvVars: ['OPENCODE_API_KEY'],
    label: 'OpenCode',
  },
  'aider': {
    command: ['aider', '--acp'], // placeholder — aider ACP support TBD
    passEnvVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    label: 'Aider',
  },
  'gemini': {
    command: ['gemini', '--experimental-acp'],
    passEnvVars: ['GOOGLE_API_KEY'],
    label: 'Gemini CLI',
  },
};

/**
 * Build a safe environment for spawning an agent.
 * Strips AGEMON_KEY and GITHUB_PAT, then adds agent-specific env vars.
 */
export function buildAgentEnv(agentType: AgentType): Record<string, string | undefined> {
  const { AGEMON_KEY: _, GITHUB_PAT: __, ...safeEnv } = process.env;
  const config = AGENT_CONFIGS[agentType];

  // Only pass through explicitly allowed env vars
  const agentEnv: Record<string, string | undefined> = { ...safeEnv };
  for (const key of config.passEnvVars) {
    if (process.env[key]) {
      agentEnv[key] = process.env[key];
    }
  }
  return agentEnv;
}

/**
 * Resolve the binary path for an agent. Throws if not found.
 */
export function resolveAgentBinary(agentType: AgentType): string {
  const config = AGENT_CONFIGS[agentType];
  const binary = config.command[0];
  const path = Bun.which(binary);
  if (!path) {
    throw new Error(`${binary} not found on PATH. Agent type: ${agentType} (${config.label})`);
  }
  return path;
}
```

**Step 2: Verify TS compiles**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add backend/src/lib/agents.ts
git commit -m "feat: add per-agent spawn config map (binary, env, args)"
```

---

### Task B3: Rewrite acp.ts to use JSON-RPC handshake

**Files:**
- Modify: `backend/src/lib/acp.ts:1-237` (full rewrite)

**Step 1: Rewrite acp.ts**

Replace the entire file. The new version:
1. Uses `JsonRpcTransport` for all communication
2. Performs the ACP handshake: `initialize` → `acp/setSessionInfo` → `acp/promptTurn`
3. Parses JSON-RPC notifications as agent events
4. Sends `shutdown` + `exit` on stop
5. Uses the agent config map from `agents.ts`

```typescript
// backend/src/lib/acp.ts
import { db } from '../db/client.ts';
import { broadcast } from '../server.ts';
import { randomUUID } from 'crypto';
import { JsonRpcTransport } from './jsonrpc.ts';
import { AGENT_CONFIGS, buildAgentEnv, resolveAgentBinary } from './agents.ts';
import type { AgentSession, AgentType } from '@agemon/shared';

interface RunningSession {
  proc: ReturnType<typeof Bun.spawn>;
  transport: JsonRpcTransport;
  sessionId: string;
}

const sessions = new Map<string, RunningSession>();
const userStopped = new Set<string>();
const KILL_TIMEOUT_MS = 5_000;

export function spawnAgent(taskId: string, agentType: AgentType): AgentSession {
  const binaryPath = resolveAgentBinary(agentType);
  const sessionId = randomUUID();
  const config = AGENT_CONFIGS[agentType];

  db.insertSession({
    id: sessionId,
    task_id: taskId,
    agent_type: agentType,
    pid: null,
  });

  const agentEnv = buildAgentEnv(agentType);
  const args = config.command.slice(1); // args after binary name

  const proc = Bun.spawn([binaryPath, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
    env: agentEnv,
  });

  db.updateSessionState(sessionId, 'starting', { pid: proc.pid });

  // Create JSON-RPC transport over the process stdio
  const transport = new JsonRpcTransport(
    proc.stdin!,
    proc.stdout as ReadableStream<Uint8Array>,
    30_000,
  );

  sessions.set(sessionId, { proc, transport, sessionId });

  // Run the ACP lifecycle asynchronously
  runAcpLifecycle(transport, proc, sessionId, taskId, agentType).catch((err) => {
    console.error(`[acp] lifecycle error for session ${sessionId}:`, err);
  });

  // Handle process exit
  handleExit(proc, transport, sessionId, taskId);

  return db.getSession(sessionId)!;
}

async function runAcpLifecycle(
  transport: JsonRpcTransport,
  proc: ReturnType<typeof Bun.spawn>,
  sessionId: string,
  taskId: string,
  agentType: AgentType,
): Promise<void> {
  // Register notification handler for agent events
  transport.onNotification((method, params) => {
    handleAgentNotification(method, params, sessionId, taskId);
  });

  try {
    // Step 1: Initialize handshake
    const initResult = await transport.request('initialize', {
      clientInfo: { name: 'agemon', version: '1.0.0' },
      protocolVersion: '2025-draft',
    });
    console.info(`[acp] session ${sessionId} initialized:`, JSON.stringify(initResult));

    // Extract external session ID if provided
    const extra: { external_session_id?: string } = {};
    if (initResult && typeof initResult === 'object' && 'sessionId' in (initResult as Record<string, unknown>)) {
      extra.external_session_id = (initResult as Record<string, unknown>).sessionId as string;
    }

    // Transition to running
    db.updateSessionState(sessionId, 'running', extra);
    broadcast({
      type: 'session_started',
      taskId,
      session: db.getSession(sessionId)!,
    });

    // Update task to working
    db.updateTask(taskId, { status: 'working' });
    const task = db.getTask(taskId);
    if (task) broadcast({ type: 'task_updated', task });

    // Step 2: Set session info
    transport.notify('acp/setSessionInfo', { sessionId });

    // Step 3: Send initial prompt turn with task description
    const taskData = db.getTask(taskId);
    if (!taskData) throw new Error(`Task ${taskId} not found`);

    const promptContent = buildPrompt(taskData.title, taskData.description);

    const turnResult = await transport.request('acp/promptTurn', {
      messages: [
        { role: 'user', content: promptContent },
      ],
    });

    // Process the prompt turn result
    if (turnResult) {
      db.insertEvent({
        id: randomUUID(),
        task_id: taskId,
        session_id: sessionId,
        type: 'result',
        content: JSON.stringify(turnResult),
      });
      broadcast({
        type: 'agent_thought',
        taskId,
        content: typeof turnResult === 'string' ? turnResult : JSON.stringify(turnResult),
      });
    }
  } catch (err) {
    if (!transport.isClosed) {
      console.error(`[acp] handshake/prompt error for session ${sessionId}:`, err);
      // Don't crash the session — the process exit handler will clean up
    }
  }
}

function buildPrompt(title: string, description: string | null): string {
  let prompt = title;
  if (description) {
    prompt += `\n\n${description}`;
  }
  return prompt;
}

function handleAgentNotification(
  method: string,
  params: unknown,
  sessionId: string,
  taskId: string,
): void {
  // Map ACP notification methods to our event types
  const p = params as Record<string, unknown> | undefined;

  if (method === '__raw__') {
    // Non-JSON-RPC line from agent — treat as raw thought
    const content = typeof params === 'string' ? params : JSON.stringify(params);
    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'thought',
      content,
    });
    broadcast({ type: 'agent_thought', taskId, content });
    return;
  }

  // Standard ACP notifications
  const content = p?.content ?? p?.message ?? p?.text ?? JSON.stringify(params);
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

  if (method === 'acp/thought' || method === 'acp/progress') {
    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'thought',
      content: contentStr,
    });
    broadcast({ type: 'agent_thought', taskId, content: contentStr });
  } else if (method === 'acp/action') {
    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'action',
      content: contentStr,
    });
    broadcast({ type: 'agent_thought', taskId, content: contentStr });
  } else if (method === 'acp/awaitInput' || method === 'acp/requestInput') {
    const question = contentStr;
    const inputId = randomUUID();
    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'await_input',
      content: question,
    });
    db.insertAwaitingInput({
      id: inputId,
      task_id: taskId,
      session_id: sessionId,
      question,
    });
    db.updateTask(taskId, { status: 'awaiting_input' });
    const task = db.getTask(taskId);
    if (task) broadcast({ type: 'task_updated', task });
    broadcast({ type: 'awaiting_input', taskId, question, inputId });
  } else {
    // Unknown notification — log as thought
    db.insertEvent({
      id: randomUUID(),
      task_id: taskId,
      session_id: sessionId,
      type: 'thought',
      content: `[${method}] ${contentStr}`,
    });
    broadcast({ type: 'agent_thought', taskId, content: `[${method}] ${contentStr}` });
  }
}

async function handleExit(
  proc: ReturnType<typeof Bun.spawn>,
  transport: JsonRpcTransport,
  sessionId: string,
  taskId: string,
): Promise<void> {
  const exitCode = await proc.exited;
  transport.close();

  const state = exitCode === 0 ? 'stopped' : 'crashed';
  db.updateSessionState(sessionId, state, { exit_code: exitCode, pid: null });
  sessions.delete(sessionId);

  broadcast({ type: 'session_state_changed', sessionId, state });

  const runningSessions = db.listSessions(taskId).filter(s => s.state === 'running' || s.state === 'starting');
  if (runningSessions.length === 0) {
    const wasUserStopped = userStopped.has(sessionId);
    userStopped.delete(sessionId);

    if (state === 'stopped' && !wasUserStopped) {
      db.updateTask(taskId, { status: 'done' });
    } else {
      db.updateTask(taskId, { status: 'todo' });
    }
    const task = db.getTask(taskId);
    if (task) broadcast({ type: 'task_updated', task });
  }

  console.info(`[acp] session ${sessionId} exited with code ${exitCode} (${state})`);
}

export function stopAgent(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error(`No running session found with id ${sessionId}`);
  }

  userStopped.add(sessionId);

  // Try graceful JSON-RPC shutdown first
  entry.transport.request('shutdown', {}).then(() => {
    entry.transport.notify('exit');
  }).catch(() => {
    // If shutdown request fails, force kill
    console.warn(`[acp] shutdown request failed for session ${sessionId}, sending SIGTERM`);
  });

  // Fallback: SIGTERM after giving shutdown a moment
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      entry.proc.kill('SIGTERM');
    }
  }, 2_000);

  // Hard kill if still alive
  setTimeout(() => {
    if (sessions.has(sessionId)) {
      console.warn(`[acp] session ${sessionId} did not exit, sending SIGKILL`);
      entry.proc.kill('SIGKILL');
    }
  }, KILL_TIMEOUT_MS);
}

export function getRunningSession(taskId: string): AgentSession | null {
  const taskSessions = db.listSessions(taskId);
  return taskSessions.find(s => s.state === 'running' || s.state === 'starting') ?? null;
}

export function recoverInterruptedSessions(): void {
  const startingSessions = db.listSessionsByState('starting');
  const runningSessions = db.listSessionsByState('running');

  for (const session of [...startingSessions, ...runningSessions]) {
    db.updateSessionState(session.id, 'interrupted', { pid: null });
    console.info(`[acp] marked session ${session.id} as interrupted (crash recovery)`);
  }
}

export async function shutdownAllSessions(): Promise<void> {
  const promises: Promise<number>[] = [];
  for (const [sessionId, entry] of sessions) {
    console.info(`[acp] shutting down session ${sessionId}`);
    // Try graceful shutdown
    entry.transport.notify('exit');
    entry.proc.kill('SIGTERM');
    promises.push(entry.proc.exited);
  }
  if (promises.length > 0) {
    await Promise.race([
      Promise.all(promises),
      new Promise<void>(resolve => setTimeout(resolve, KILL_TIMEOUT_MS)),
    ]);
    for (const [, entry] of sessions) {
      entry.proc.kill('SIGKILL');
    }
  }
}
```

**Step 2: Verify TS compiles**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Run smoke tests**

Start backend and run `./scripts/test-api.sh`. The start/stop endpoints should still work (they'll fail to find binaries on PATH but should return proper error messages, not crash).

**Step 4: Commit**

```bash
git add backend/src/lib/acp.ts
git commit -m "feat: rewrite acp.ts with JSON-RPC 2.0 handshake (initialize → promptTurn → shutdown)"
```

---

## Stream C: Git Worktree Manager

### Task C1: Install simple-git

**Files:**
- Modify: `backend/package.json`

**Step 1: Install dependency**

```bash
cd backend && bun add simple-git
```

**Step 2: Verify install**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add backend/package.json backend/bun.lockb
git commit -m "feat: add simple-git dependency for worktree management"
```

Note: `bun.lockb` is at the workspace root, not in backend/. If that's the case, adjust the git add to include the root lockfile instead.

---

### Task C2: Create GitWorktreeManager

**Files:**
- Create: `backend/src/lib/git.ts`

**Step 1: Implement the manager**

```typescript
// backend/src/lib/git.ts
import simpleGit, { type SimpleGit } from 'simple-git';
import { mkdir, rm, access } from 'fs/promises';
import { join } from 'path';
import { parseRepoName } from '../db/client.ts';

const AGEMON_DIR = '.agemon';
const REPOS_DIR = join(AGEMON_DIR, 'repos');
const TASKS_DIR = join(AGEMON_DIR, 'tasks');

/**
 * Manages git worktrees for task isolation.
 *
 * Layout:
 *   .agemon/repos/{org}/{repo}.git   — bare repo cache (shared across tasks)
 *   .agemon/tasks/{taskId}/{repoName}/ — worktree per task per repo
 *
 * Branch naming: agemon/{taskId}-{repoName}
 */
export class GitWorktreeManager {
  /**
   * Create a worktree for a task's repo.
   * Clones bare repo if not cached, creates worktree with a fresh branch.
   * Returns the absolute path to the worktree.
   */
  async createWorktree(
    taskId: string,
    repoUrl: string,
    baseBranch = 'main',
  ): Promise<string> {
    const repoName = parseRepoName(repoUrl);
    const bareDir = this.getBareRepoPath(repoName);
    const worktreePath = this.getWorktreePath(taskId, repoName);
    const branchName = this.getBranchName(taskId, repoName);

    // Ensure bare repo exists (clone or fetch)
    await this.ensureBareRepo(repoUrl, repoName);

    // Create worktree directory
    await mkdir(worktreePath, { recursive: true });

    // Create worktree from bare repo
    const git = simpleGit(bareDir);

    // Fetch latest to get the base branch
    await git.fetch('origin', baseBranch).catch(() => {
      // If baseBranch doesn't exist on remote, fetch all
      return git.fetch('origin');
    });

    // Create the worktree with a new branch
    await git.raw([
      'worktree', 'add',
      '-b', branchName,
      worktreePath,
      `origin/${baseBranch}`,
    ]);

    console.info(`[git] created worktree: ${worktreePath} (branch: ${branchName})`);
    return worktreePath;
  }

  /**
   * Delete a worktree and prune the reference.
   */
  async deleteWorktree(taskId: string, repoName: string): Promise<void> {
    const worktreePath = this.getWorktreePath(taskId, repoName);
    const bareDir = this.getBareRepoPath(repoName);

    try {
      await access(worktreePath);
    } catch {
      // Worktree doesn't exist — nothing to do
      return;
    }

    const git = simpleGit(bareDir);
    await git.raw(['worktree', 'remove', '--force', worktreePath]).catch((err) => {
      console.warn(`[git] worktree remove failed, falling back to rm: ${err.message}`);
    });

    // Clean up the directory if git worktree remove didn't
    await rm(worktreePath, { recursive: true, force: true });

    // Prune stale worktree references
    await git.raw(['worktree', 'prune']).catch(() => {});

    console.info(`[git] deleted worktree: ${worktreePath}`);
  }

  /**
   * Delete all worktrees for a task.
   */
  async deleteTaskWorktrees(taskId: string): Promise<void> {
    const taskDir = join(TASKS_DIR, taskId);
    try {
      await access(taskDir);
    } catch {
      return; // No worktrees for this task
    }

    // Read subdirectories (each is a repo worktree)
    const { readdir } = await import('fs/promises');
    const entries = await readdir(taskDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Reconstruct repo name from directory structure
        // Directory names are the repo name with / replaced by path separator
        await this.deleteWorktree(taskId, entry.name);
      }
    }

    await rm(taskDir, { recursive: true, force: true });
  }

  /**
   * Get the git diff in a worktree (uncommitted changes).
   */
  async getDiff(taskId: string, repoName: string): Promise<string> {
    const worktreePath = this.getWorktreePath(taskId, repoName);
    const git = simpleGit(worktreePath);
    return git.diff();
  }

  /**
   * List all worktree paths for a task.
   */
  async listWorktrees(taskId: string): Promise<string[]> {
    const taskDir = join(TASKS_DIR, taskId);
    try {
      await access(taskDir);
    } catch {
      return [];
    }

    const { readdir } = await import('fs/promises');
    const entries = await readdir(taskDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => join(taskDir, e.name));
  }

  /** Get the absolute worktree path for a task + repo. */
  getWorktreePath(taskId: string, repoName: string): string {
    // Replace / in repo names with -- for filesystem safety
    const safeName = repoName.replace(/\//g, '--');
    return join(process.cwd(), TASKS_DIR, taskId, safeName);
  }

  /** Get the branch name for a task + repo. */
  getBranchName(taskId: string, repoName: string): string {
    const safeName = repoName.replace(/\//g, '-');
    return `agemon/${taskId}-${safeName}`;
  }

  /** Get the bare repo cache path. */
  private getBareRepoPath(repoName: string): string {
    const safeName = repoName.replace(/\//g, '--');
    return join(process.cwd(), REPOS_DIR, `${safeName}.git`);
  }

  /** Clone bare repo if not cached, or fetch if it exists. */
  private async ensureBareRepo(repoUrl: string, repoName: string): Promise<void> {
    const bareDir = this.getBareRepoPath(repoName);

    try {
      await access(bareDir);
      // Exists — fetch latest
      const git = simpleGit(bareDir);
      await git.fetch('origin');
      console.info(`[git] fetched updates for ${repoName}`);
    } catch {
      // Doesn't exist — clone bare
      await mkdir(bareDir, { recursive: true });
      const git = simpleGit();
      await git.clone(repoUrl, bareDir, ['--bare']);
      console.info(`[git] cloned bare repo: ${repoName}`);
    }
  }
}

/** Singleton instance. */
export const gitManager = new GitWorktreeManager();
```

**Step 2: Verify TS compiles**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add backend/src/lib/git.ts
git commit -m "feat: add GitWorktreeManager — bare repo cache + per-task worktrees"
```

---

### Task C3: Wire worktree creation into the start endpoint

**Files:**
- Modify: `backend/src/routes/tasks.ts:135-146`

**Step 1: Import git manager**

Add import at top of `tasks.ts`:

```typescript
import { gitManager } from '../lib/git.ts';
```

**Step 2: Create worktrees before spawning agent**

Replace the `POST /tasks/:id/start` handler (lines 135-146) to create worktrees first:

```typescript
tasksRoutes.post('/tasks/:id/start', async (c) => {
  const task = requireTask(c.req.param('id'));
  if (task.status !== 'todo') {
    sendError(400, 'Task must be in todo status to start');
  }

  // Create worktrees for each attached repo
  const worktreePaths: string[] = [];
  for (const repo of task.repos) {
    try {
      const path = await gitManager.createWorktree(task.id, repo.url);
      worktreePaths.push(path);
    } catch (err) {
      // Clean up any worktrees we already created
      await gitManager.deleteTaskWorktrees(task.id).catch(() => {});
      sendError(500, `Failed to create worktree for ${repo.name}: ${(err as Error).message}`);
    }
  }

  try {
    const session = spawnAgent(task.id, task.agent);
    return c.json(session, 202);
  } catch (err) {
    sendError(500, (err as Error).message);
  }
});
```

Note: The start handler is now `async` because `gitManager.createWorktree` is async.

**Step 3: Verify TS compiles**

Run: `cd backend && bunx tsc --noEmit`
Expected: 0 errors.

**Step 4: Run smoke tests**

Start backend and run `./scripts/test-api.sh`. Start endpoint should still return proper errors (agent binary not on PATH).

**Step 5: Commit**

```bash
git add backend/src/routes/tasks.ts
git commit -m "feat: create git worktrees before spawning agent on task start"
```

---

## Integration: Final Verification

### Task I1: End-to-end smoke test

**Step 1: Run backend smoke tests**

```bash
cd backend && rm -f agemon.db* && AGEMON_KEY=test bun run src/server.ts
# In another terminal:
./scripts/test-api.sh
```

Expected: All 21 tests pass.

**Step 2: Run frontend build**

```bash
cd frontend && bun run build
```

Expected: Build succeeds with 0 errors.

**Step 3: Run full type check across workspace**

```bash
cd backend && bunx tsc --noEmit && cd ../frontend && bunx tsc --noEmit
```

Expected: 0 errors in both.

**Step 4: Manual verification**

1. Start backend: `cd backend && AGEMON_KEY=test bun run src/server.ts`
2. Start frontend: `cd frontend && bun run dev`
3. Open http://localhost:5173, enter API key "test"
4. Verify project list loads (TanStack Query)
5. Create a task, verify it appears immediately (WS → TQ invalidation)
6. Open task detail, verify thought stream area renders

**Step 5: Final commit**

If any integration fixes were needed, commit them here.

---

## Summary of All New/Modified Files

**Created:**
- `frontend/src/lib/query.ts` — TanStack Query client + key factories
- `frontend/src/lib/store.ts` — Zustand store
- `frontend/src/components/custom/ws-provider.tsx` — WS → TQ + Zustand bridge
- `backend/src/lib/jsonrpc.ts` — JSON-RPC 2.0 transport
- `backend/src/lib/agents.ts` — Agent spawn config map
- `backend/src/lib/git.ts` — GitWorktreeManager

**Modified:**
- `frontend/package.json` — added @tanstack/react-query, zustand
- `frontend/src/lib/api.ts` — added listEvents method
- `frontend/src/App.tsx` — wrapped with QueryClientProvider + WsProvider
- `frontend/src/routes/index.tsx` — rewritten with useQuery
- `frontend/src/routes/tasks.$id.tsx` — rewritten with useQuery + Zustand thoughts
- `backend/package.json` — added simple-git
- `backend/src/server.ts` — added send_input handler
- `backend/src/lib/acp.ts` — full rewrite with JSON-RPC
- `backend/src/routes/tasks.ts` — worktree creation in start endpoint
