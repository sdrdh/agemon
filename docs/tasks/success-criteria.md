## Success Criteria (v1 Launch)

### Functional Requirements
- [ ] User can add task from mobile in < 30 seconds
- [ ] Agent executes and streams thoughts in real-time
- [ ] User can approve diff from phone
- [ ] Multi-repo PRs created automatically
- [ ] Terminal works interactively on mobile
- [ ] Full workflow completes end-to-end

### Performance Requirements
- [ ] Single binary under 150MB
- [ ] Mobile UI loads in < 2 seconds on 4G
- [ ] Terminal connects in < 500ms on Tailscale
- [ ] WebSocket reconnection seamless
- [ ] Handles 10 concurrent tasks

### Compatibility Requirements
- [ ] Works on iOS Safari
- [ ] Works on Chrome mobile (Android)
- [ ] Works on desktop browsers
- [ ] Deploys on Ubuntu 22.04+
- [ ] Deploys via Tailscale
- [ ] Deploys on exe.dev

### Launch Goals
- [ ] 100-500 GitHub stars in first month
- [ ] 50+ active self-hosted installations
- [ ] Featured on Hacker News front page
- [ ] Positive feedback from ACP community

---

## Post-v1 Backlog

**v1.1 - Enhanced Terminal**
- Bidirectional PTY input improvements
- Terminal themes and customization
- Better copy/paste handling
- Search in terminal history

**v1.2 - Collaboration**
- Share task progress via read-only link
- Team workspace support
- Role-based access control

**v1.3 - Advanced Features**
- Multiple agents per task
- Agent comparison mode
- Custom agent templates
- Workflow automation rules

**v1.4 - Git Integration (Deferred from v1)**
- GitHub Integration via Octokit (Task 3.2) — PR creation, status tracking
- One-Tap Multi-Repo PR Flow (Task 3.3) — coordinated commit/push/PR across repos
- Diff Approve/Reject Flow (Task 6.3) — approve/reject diffs with agent notification

**v2.0 - Platform Expansion**
- Desktop app (Tauri)
- Browser extension
- CI/CD integration
- Webhook support (basic version in Phase 9, expand here)
- OpenClaw advanced features: scheduled tasks, voice input, cost alerts

**exe.dev Integration & Dev Server Previews**
- exe.dev auto-proxies ports 3000-9999 via HTTPS at `https://{vmname}.exe.xyz:{PORT}/`
- Add generic `env` JSON column on tasks table — arbitrary key-value env vars passed to agent processes
- Build MCP server into Agemon backend (Streamable HTTP transport) so agents can request resources
- Port allocation as an MCP tool — agents/users request N ports on demand, Agemon tracks and assigns from available range
- `PREVIEW_HOST` env var (e.g. `myvm.exe.xyz`) used to generate preview URLs for allocated ports
- Task env vars automatically injected into agent process environment on spawn
- Frontend: preview URL buttons in task detail view, env var editor for tasks

---

## Notes

### Parallelization Strategy

The 8-week development timeline can be optimized by running tasks in parallel across **4 independent tracks**:

#### **Track A: Backend Core (Sequential - Critical Path)**
```
Week 1-2: Foundation
├─ 1.1 Project Init (4h) ──┐
├─ 1.2 Database (6h)       │ Must be sequential
├─ 1.3 REST API (8h)       │ Each depends on previous
└─ 1.4 WebSocket (6h) ─────┘

Week 4-5: ACP Integration
├─ 4.1 ACP Client (10h)
├─ 4.2 Auto-Resume (3h)
├─ 4.3 Event Parser (10h)
└─ 4.4 Awaiting Input (10h)

Week 7: Build & Distribution
├─ 7.1 Production Build (8h)
├─ 7.2 Single Binary (10h)
└─ 7.3 Install Scripts (6h)
```

#### **Track B: Frontend (Parallel after 1.1)**
```
Week 2-3: UI Foundation
├─ 2.1 shadcn/ui Setup (8h)     ◄── Can start after 1.1
├─ 2.2 Kanban Board (10h)       ◄── Needs 1.4 for WebSocket
├─ 2.3 Add Task Flow (8h)       ┐
└─ 2.4 Task Detail (8h)         ┴── Can run in parallel

Week 5-6: Terminal
├─ 5.1 PTY Manager (12h)
├─ 5.2 xterm Component (10h)
└─ 5.3 Mobile Terminal (6h)
```

#### **Track C: Git Integration (Simplified)**
```
Week 3-4: Git Operations
├─ 3.1 Git Worktree Manager (12h)  ◄── Done
├─ 3.2 GitHub Integration           ◄── Deferred to post-v1
└─ 3.3 One-Tap PR Flow              ◄── Deferred to post-v1

Week 6: Diff Viewer (Lightweight)
└─ 6.1 Read-only Diff Viewer (8h)   ◄── No DB, no approve/reject
```

#### **Track D: Documentation & Website (Continuous)**
```
Week 1-8: Documentation
├─ 8.3 User Docs (10h)          ◄── Start early, continuous
│
Week 6-7: Website
├─ 8.6 Astro Website (12h)      ◄── Parallel with 7.1-7.3
│
Week 7-8: Launch Prep
├─ 8.1 Tailscale Guide (6h)     ┐
├─ 8.2 exe.dev Deployment (6h)  ├── All parallel
├─ 8.4 Mobile UX Polish (8h)    │
└─ 8.5 Launch Materials (8h)    ┘
```

### Optimal Parallel Execution Schedule

**Week 1:**
- Track A: 1.1 → 1.2 (start of critical path)
- Track B: 2.1 can start after 1.1 completes

**Week 2:**
- Track A: 1.3 → 1.4
- Track B: 2.1 continues → 2.2 starts after 1.4
- Track D: 8.3 (docs) start

**Week 3:**
- Track B: 2.3 + 2.4 (parallel)
- Track C: 3.1 starts (independent)

**Week 4:**
- Track A: 4.1 starts (critical path)
- Track C: 3.2 → 3.3

**Week 5:**
- Track A: 4.2 (auto-resume) + 4.3 → 4.4
- Track B: 5.1 starts (PTY)

**Week 6:**
- Track B: 5.2 → 5.3
- Track C: 6.1 → 6.2 → 6.3
- Track D: 8.6 (Astro) can start

**Week 7:**
- Track A: 7.1 → 7.2 → 7.3 (critical)
- Track D: 8.1 + 8.2 + 8.6 (all parallel)

**Week 8:**
- Track D: 8.4 + 8.5 (launch prep)

### Critical Path

**Total Critical Path Duration:** ~6 weeks
```
1.1 (4h) → 1.2 (6h) → 1.3 (8h) → 1.4 (6h) →
4.1 (10h) → 4.3 (10h) → 4.4 (10h) →
7.1 (8h) → 7.2 (10h) → 7.3 (6h) → 8.5 (8h)
```

Any delay in Track A tasks will delay the entire project. Tracks B, C, and D provide flexibility.

### Risk Mitigation Plan

**High-Risk Tasks:**

1. **Task 7.2: Single Binary Packaging** (Week 7)
   - **Risk:** Bun's standalone executable feature is newer, may have issues with native modules
   - **Mitigation:**
     - Test Bun binary packaging in Week 1 with hello-world
     - Prepare Docker fallback for Week 8
     - Have traditional Node.js binary packaging as backup

2. **Task 4.1: ACP Integration** (Week 4)
   - **Risk:** External protocol dependency, limited agent support
   - **Mitigation:**
     - Validate ACP SDK compatibility in Week 1
     - Test with Claude Code early in Week 4
     - Have manual agent wrapper fallback

3. **Task 5.1: PTY Session Management** (Week 5)
   - **Risk:** node-pty native module may not bundle correctly
   - **Mitigation:**
     - Test node-pty in production build early (Week 5)
     - Have containerized deployment as fallback
     - Consider WebSocket-only terminal as v1.1 feature if blocked

4. **Task 8.4: Mobile PWA Features** (Week 8)
   - **Risk:** iOS has strict PWA limitations, push notifications may not work
   - **Mitigation:**
     - Document iOS limitations clearly
     - Use in-app polling as primary mechanism
     - Push notifications are "nice to have" for v1

### Dependencies Matrix

| Task | Depends On | Can Run In Parallel With |
|------|------------|--------------------------|
| 1.1  | None       | Nothing (start point) |
| 1.2  | 1.1        | 2.1 |
| 1.3  | 1.2        | 2.1, 3.1 |
| 1.4  | 1.3        | 2.1, 3.1 |
| 2.1  | 1.1        | 1.2, 1.3, 1.4, 3.1 |
| 2.2  | 1.4, 2.1   | 3.1, 3.2 |
| 2.3  | 2.2        | 2.4, 3.2, 3.3 |
| 2.4  | 2.2        | 2.3, 3.2, 3.3 |
| 3.1  | 1.2        | 1.3, 1.4, 2.1, 2.2 |
| 3.2  | 3.1        | 2.3, 2.4, 4.1 |
| 3.3  | 3.2        | 2.3, 2.4, 4.1 |
| 4.1  | 1.5, 3.1   | 3.2, 3.3 |
| 4.2  | 4.1        | 4.3, 5.1 |
| 4.3  | 4.1, 2.4   | 4.2, 5.1 |
| 4.4  | 4.3        | 5.1, 5.2 |
| 5.1  | 1.4        | 4.3, 4.4, 6.1 |
| 5.2  | 5.1        | 6.1, 6.2 |
| 5.3  | 5.2        | 6.2, 6.3 |
| 6.1  | 3.1        | 4.4, 5.1, 5.2 |
| 6.2  | 6.1        | 5.2, 5.3 |
| 6.3  | 6.2        | 5.3 |
| 7.1  | All Phase 1-6 | 8.1, 8.2, 8.6 |
| 7.2  | 7.1        | 8.1, 8.2, 8.6 |
| 7.3  | 7.2        | 8.1, 8.2, 8.6 |
| 8.1  | 7.2        | 7.3, 8.2, 8.6 |
| 8.2  | 7.2        | 7.3, 8.1, 8.6 |
| 8.3  | None (continuous) | Everything |
| 8.4  | 2.x tasks  | 7.x, 8.1, 8.2, 8.6 |
| 8.5  | All tasks  | Nothing (final) |
| 8.6  | 8.3        | 7.1, 7.2, 7.3, 8.1, 8.2 |

### Testing Strategy

**Unit Tests:**
- Each backend module (database, git, pty, acp)
- Frontend components (UI library)
- Run during development, not separate phase

**Integration Tests:**
- After Phase 1: API + Database + WebSocket
- After Phase 4: ACP agent spawning and events
- After Phase 5: PTY sessions
- After Phase 6: End-to-end task workflow

**Mobile Testing:**
- **Required:** Test on real iPhone and Android device
- **When:** After each Phase 2, 5, 6, 8 task
- **What:** Touch targets, gestures, keyboard handling, performance

**End-to-End Testing:**
- Week 7: Full workflow from task creation to PR
- Week 8: Launch rehearsal on actual deployment

---
