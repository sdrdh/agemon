## Phase 5: Terminal PTY (Week 5-6)

**Goal:** Live interactive terminal in browser

### Task 5.1: PTY Session Management

**Priority:** P0  
**Estimated Time:** 12 hours

**Deliverables:**
- [ ] Install `node-pty` dependency
- [ ] Create `PTYSessionManager` class
- [ ] Spawn PTY sessions for tasks
- [ ] Handle PTY output streaming
- [ ] Handle user input to PTY
- [ ] Session persistence and recovery

**Functions:**
```typescript
class PTYSessionManager {
  createSession(taskId: string, shell: string): Promise<string>
  writeInput(sessionId: string, data: string): Promise<void>
  onOutput(sessionId: string, callback: (data: string) => void): void
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  killSession(sessionId: string): Promise<void>
}
```

**Acceptance Criteria:**
- PTY spawns with proper environment
- Output streams to WebSocket in real-time
- User input sent to PTY
- Terminal resizes properly
- Session survives browser disconnect
- Cleanup on task deletion

**Dependencies:** Task 1.4

---

### Task 5.2: xterm.js Terminal Component

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [ ] Install `@xterm/xterm` and addons
- [ ] Create lazy-loaded Terminal component
- [ ] Setup xterm.js with fit addon
- [ ] Connect to WebSocket for PTY data
- [ ] Handle keyboard input
- [ ] Implement copy/paste

**Addons to Include:**
- `@xterm/addon-fit` - Auto-sizing
- `@xterm/addon-web-links` - Clickable URLs
- `@xterm/addon-search` - Search in output

**Acceptance Criteria:**
- Terminal loads only when user opens it (lazy)
- Renders PTY output in real-time
- User can type commands
- Terminal fits container properly
- Copy/paste works (desktop and mobile)
- Links are clickable
- Search works (Ctrl+F)

**Dependencies:** Task 5.1, Task 2.1

---

### Task 5.3: Mobile Terminal Optimizations

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Mobile keyboard handling
- [ ] Virtual keyboard toolbar (common commands)
- [ ] Touch scrolling optimization
- [ ] Font size adjustment for mobile
- [ ] Landscape mode support

**Features:**
- Tab, Ctrl, Esc buttons above keyboard
- Common command shortcuts (ls, cd, git)
- Pinch-to-zoom font size
- Auto-hide keyboard on scroll

**Acceptance Criteria:**
- Terminal usable on mobile Safari
- Terminal usable on Chrome mobile
- Keyboard doesn't cover terminal
- Common commands easily accessible
- Readable font size on phone
- Works in portrait and landscape

**Dependencies:** Task 5.2

---
