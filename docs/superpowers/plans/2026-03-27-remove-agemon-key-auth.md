# Remove AGEMON_KEY Auth — Delegate to Reverse Proxy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the custom AGEMON_KEY bearer-token auth system and trust the reverse proxy (Tailscale, Cloudflare Access, etc.) to handle authentication.

**Architecture:** All auth middleware, cookie logic, and frontend login flows are deleted. The server binds to `127.0.0.1` by default so it is never directly exposed. The WS upgrade and all API routes become open. The frontend always connects without any token handshake. Optional `Remote-User` / `Tailscale-User-Login` header logging is added for audit trails.

**Tech Stack:** Bun, Hono 4.x, React 18, TanStack Router

---

## Files to Change

| Action | File | What changes |
|--------|------|-------------|
| Modify | `backend/src/server.ts` | Remove `AGEMON_KEY` env check + `key:` arg to `createApp` |
| Modify | `backend/src/app.ts` | Remove all auth middleware, cookie endpoints, crypto imports, `AppOptions.key` |
| Modify | `frontend/src/lib/api.ts` | Remove `STORAGE_KEY`, `getKey`, `setApiKey`, `hasApiKey`, `clearApiKey`, `validateKey`, `setAuthCookie`, `authHeaders`; strip `Authorization` header from requests |
| Modify | `frontend/src/main.tsx` | Always call `connectWs()` unconditionally |
| Modify | `frontend/src/App.tsx` | Remove `LoginScreen`, `authed` state, `handleLogin`; simplify `handleLogout` to WS disconnect only |
| Modify | `frontend/src/components/custom/file-tree-viewer.tsx` | Remove `authHeaders()` call |
| Modify | `frontend/src/components/custom/diff-viewer.tsx` | Remove `authHeaders()` call |
| Modify | `frontend/src/routes/sessions.$id.tsx` | Remove `authHeaders()` call |
| Modify | `frontend/src/routes/settings.tsx` | Remove logout button (no auth to clear) |
| Delete | `frontend/src/routes/login.tsx` | File deleted entirely |
| Modify | `.env.example` | Remove `AGEMON_KEY` line |

---

## Task 1: Backend — server.ts

**Files:**
- Modify: `backend/src/server.ts:15-20` (AGEMON_KEY check)
- Modify: `backend/src/server.ts:183` (createApp call)

- [ ] **Step 1: Remove AGEMON_KEY env var and process.exit guard**

Delete lines 15–20:
```typescript
// DELETE these lines:
const AGEMON_KEY = process.env.AGEMON_KEY ?? '';

if (!AGEMON_KEY) {
  console.error('[error] AGEMON_KEY is not set — exiting');
  process.exit(1);
}
```

- [ ] **Step 2: Remove `key:` from createApp call (line 183)**

Change:
```typescript
const { app, broadcast } = createApp({ key: AGEMON_KEY });
```
To:
```typescript
const { app, broadcast } = createApp();
```

- [ ] **Step 3: Verify HOST still defaults to 127.0.0.1**

Line 14 already reads:
```typescript
const HOST = process.env.HOST ?? '127.0.0.1';
```
No change needed — server is already secure-by-default behind a proxy.

---

## Task 2: Backend — app.ts

**Files:**
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Strip unused imports**

Remove from the import block:
```typescript
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { timingSafeEqual, createHmac } from 'node:crypto';
```

- [ ] **Step 2: Simplify AppOptions and createApp signature**

Change:
```typescript
export interface AppOptions {
  key: string;
}

export function createApp(opts: AppOptions): AppContext {
  const app = new Hono();
  const cookieToken = deriveCookieToken(opts.key);
  const eventBus = new EventEmitter();
```
To:
```typescript
export function createApp(): AppContext {
  const app = new Hono();
  const eventBus = new EventEmitter();
```

Also delete the `AppOptions` interface and the `deriveCookieToken` function entirely:
```typescript
// DELETE:
export interface AppOptions {
  key: string;
}

/** Derive a cookie token from the key — never store the raw key in a cookie. */
function deriveCookieToken(key: string): string {
  return createHmac('sha256', key).update('agemon_session').digest('hex');
}
```

- [ ] **Step 3: Remove the auth middleware block**

Delete the entire `// ─── Auth Middleware` section (lines 61–98):
```typescript
// DELETE this entire block:
app.use(async (c, next) => {
  const path = c.req.path;
  // Skip auth for non-API routes ...
  if (path === '/ws' || path === '/api/health' || ...) return next();
  if (!path.startsWith('/api')) return next();
  // ...Bearer + cookie check...
  if (!authenticated) {
    return c.json({ error: 'Unauthorized', ... }, 401);
  }
  return next();
});
```

- [ ] **Step 4: Remove /api/auth and /api/auth/logout endpoints**

Delete the `// ─── Auth (cookie login)` section (lines 120–140):
```typescript
// DELETE:
app.post('/api/auth', (c) => { ... });
app.post('/api/auth/logout', (c) => { ... });
```

- [ ] **Step 5: Remove WebSocket auth middleware**

Delete the `app.use('/ws', ...)` guard (lines 157–176):
```typescript
// DELETE:
app.use('/ws', async (c, next) => {
  // Try cookie first ... fall back to query param ...
  return c.json({ error: 'Unauthorized', ... }, 401);
});
```

- [ ] **Step 6: Add optional proxy-identity logging to WS onOpen**

In the `upgradeWebSocket` handler's `onOpen`, update to log the proxy-supplied user:
```typescript
onOpen(_event, ws) {
  wsClients.add(ws);
  // Log the identity supplied by the reverse proxy (Tailscale / Cloudflare Access).
  // Falls back to 'anonymous' if no proxy header is present (e.g., local dev).
  // NOTE: _c is the upgrade request context captured in the closure below.
  console.info(`[ws] client connected (total: ${wsClients.size})`);
},
```

The WS upgrade handler receives `(_c)` — update to log user from request headers at connect time. Replace:
```typescript
app.get('/ws', upgradeWebSocket((_c) => ({
  onOpen(_event, ws) {
    wsClients.add(ws);
    console.info(`[ws] client connected (total: ${wsClients.size})`);
  },
```
With:
```typescript
app.get('/ws', upgradeWebSocket((c) => {
  const user =
    c.req.header('tailscale-user-login') ??
    c.req.header('remote-user') ??
    'anonymous';
  return {
  onOpen(_event, ws) {
    wsClients.add(ws);
    console.info(`[ws] client connected user=${user} (total: ${wsClients.size})`);
  },
```
And close the extra brace at end of the `upgradeWebSocket` callback (add `};` before closing `)`).

---

## Task 3: Frontend — api.ts

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Remove all auth-related exports and helpers**

Delete:
```typescript
export const STORAGE_KEY = 'agemon_key' as const;

function getKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function hasApiKey(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

export async function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch { /* best effort */ }
}

/** Auth-only header for GET fetches that handle their own error handling. */
export function authHeaders(): Record<string, string> {
  const key = getKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Validate key against the server. Returns true if valid. */
export async function validateKey(key: string): Promise<boolean> { ... }

/** Set the auth cookie via POST /api/auth. Called after successful key validation. */
export async function setAuthCookie(key: string): Promise<void> { ... }
```

- [ ] **Step 2: Simplify the `headers()` and `request()` functions**

Change `headers()` to only return Content-Type:
```typescript
function headers() {
  return {
    'Content-Type': 'application/json',
  };
}
```

In `request()`, remove the 401 special-case that called `clearApiKey()`:
```typescript
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(), credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
```

Note: Add `credentials: 'include'` so cookie-based proxy sessions (if any) are forwarded.

---

## Task 4: Frontend — main.tsx

**Files:**
- Modify: `frontend/src/main.tsx:23,104`

- [ ] **Step 1: Remove hasApiKey import and guard**

Change:
```typescript
import { hasApiKey, api } from './lib/api';
// ...
// Only connect if a key is already stored — login screen handles the first-time case.
if (hasApiKey()) connectWs();
```
To:
```typescript
import { api } from './lib/api';
// ...
// Connect immediately — auth is handled by the reverse proxy.
connectWs();
```

---

## Task 5: Frontend — App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Remove LoginScreen import and auth imports**

Change:
```typescript
import { hasApiKey, clearApiKey } from './lib/api';
// ...
const LoginScreen = lazy(() => import('./routes/login'));
```
To (delete both lines entirely).

- [ ] **Step 2: Remove authed state, handleLogin, and handleLogout**

Delete:
```typescript
const [authed, setAuthed] = useState(hasApiKey);

function handleLogin() {
  connectWs();
  setAuthed(true);
}

function handleLogout() {
  disconnectWs();
  clearApiKey();
  setAuthed(false);
}
```

Replace with a simple logout that just disconnects the WS:
```typescript
function handleLogout() {
  disconnectWs();
  window.location.reload();
}
```

- [ ] **Step 3: Remove the if (!authed) login gate block**

Delete:
```typescript
if (!authed) {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Suspense fallback={<SuspenseFallback />}>
          <LoginScreen onLogin={handleLogin} />
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

// Update router context with current handleLogout reference
router.options.context.onLogout = handleLogout;
```

The return below it stays (the main app render). Just add `router.options.context.onLogout = handleLogout;` before the `return` statement.

- [ ] **Step 4: Verify RouterContext still compiles**

The `RouterContext` interface and `router` definition reference `onLogout: () => void`. That's fine — `handleLogout` now calls `disconnectWs()` + reload. No type changes needed.

---

## Task 6: Frontend — Remove authHeaders() usage

**Files:**
- Modify: `frontend/src/components/custom/file-tree-viewer.tsx:25`
- Modify: `frontend/src/components/custom/diff-viewer.tsx:33`
- Modify: `frontend/src/routes/sessions.$id.tsx:48`

- [ ] **Step 1: file-tree-viewer.tsx — remove authHeaders import and usage**

Remove import:
```typescript
import { authHeaders } from '@/lib/api';
```

Change the fetch call:
```typescript
// Before:
return fetch(url, { headers: authHeaders(), credentials: 'include' });
// After:
return fetch(url, { credentials: 'include' });
```

- [ ] **Step 2: diff-viewer.tsx — remove authHeaders import and usage**

Remove import:
```typescript
import { authHeaders } from '@/lib/api';
```

Change the fetch call:
```typescript
// Before:
return fetch(url, { headers: authHeaders(), credentials: 'include' });
// After:
return fetch(url, { credentials: 'include' });
```

- [ ] **Step 3: sessions.$id.tsx — remove authHeaders import and usage**

Remove from import:
```typescript
import { authHeaders } from '@/lib/api';
```

Change the fetch call:
```typescript
// Before:
fetch(`/api/sessions/${sessionId}/diff`, { headers: authHeaders(), credentials: 'include' })
// After:
fetch(`/api/sessions/${sessionId}/diff`, { credentials: 'include' })
```

---

## Task 7: Frontend — settings.tsx logout button

**Files:**
- Modify: `frontend/src/routes/settings.tsx:289-637`

The `AboutSection` receives an `onLogout` prop and renders a "Log out" button. Since auth is now proxy-handled, there's nothing to log out of at the app level. Remove the button and the prop.

- [ ] **Step 1: Remove onLogout prop from AboutSection**

Change:
```typescript
function AboutSection({ onLogout }: { onLogout: () => void }) {
```
To:
```typescript
function AboutSection() {
```

- [ ] **Step 2: Remove the logout button div**

Delete:
```typescript
<div className="pt-4 border-t">
  <Button
    variant="outline"
    className="min-h-[44px] text-destructive hover:text-destructive"
    onClick={onLogout}
  >
    <LogOut className="h-4 w-4 mr-2" />
    Log out
  </Button>
</div>
```

- [ ] **Step 3: Remove LogOut icon import if it becomes unused**

Check if `LogOut` is used elsewhere in settings.tsx. If only in the deleted button, remove from the lucide import line.

- [ ] **Step 4: Remove onLogout from AboutSection call-site**

Find the JSX that renders `<AboutSection onLogout={context.onLogout} />` and change to:
```typescript
<AboutSection />
```

---

## Task 8: Delete login.tsx

**Files:**
- Delete: `frontend/src/routes/login.tsx`

- [ ] **Step 1: Delete the file**

```bash
rm frontend/src/routes/login.tsx
```

---

## Task 9: .env.example cleanup

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Remove AGEMON_KEY lines**

Change from:
```
# Required — static auth token for API access
AGEMON_KEY=change-me-to-a-strong-secret
```
To: (deleted — those two lines are gone)

---

## Self-Review

**Spec coverage check:**
- ✅ server.ts: AGEMON_KEY env var check removed, `createApp` call updated
- ✅ server.ts: HOST defaults to `127.0.0.1` (already the case, verified)
- ✅ app.ts: Auth middleware removed
- ✅ app.ts: Cookie auth endpoints removed
- ✅ app.ts: WS auth gate removed
- ✅ app.ts: `Remote-User`/`Tailscale-User-Login` header logged on WS connect
- ✅ frontend/login.tsx: Deleted
- ✅ App.tsx: `authed` state removed, `LoginScreen` removed
- ✅ App.tsx: `connectWs()` now called unconditionally (via main.tsx)
- ✅ App.tsx: `handleLogout` simplified to disconnect + reload
- ✅ api.ts: `hasApiKey`, `clearApiKey`, `setApiKey`, `authHeaders`, `validateKey`, `setAuthCookie` removed
- ✅ api.ts: Authorization header stripped from requests
- ✅ .env.example: AGEMON_KEY removed
- ✅ All `authHeaders()` call-sites updated

**Placeholder scan:** No TBDs or vague steps found.

**Type consistency:** `handleLogout: () => void` signature unchanged — settings page and router context both satisfied.
