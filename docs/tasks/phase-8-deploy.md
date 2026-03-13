## Phase 8: Deployment & Documentation (Week 7-8)

**Goal:** Launch-ready with complete documentation

### Task 8.1: Tailscale Setup Guide

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Write Tailscale deployment guide
- [ ] Create cert auto-generation script
- [ ] Document Tailscale HTTPS setup
- [ ] Create troubleshooting section
- [ ] Test on fresh Ubuntu install

**Documentation Sections:**
- Prerequisites
- Install Tailscale
- Enable HTTPS certificates
- Run Agemon with Tailscale
- Access from mobile
- Troubleshooting

**Acceptance Criteria:**
- Someone can follow guide and deploy in < 15 minutes
- HTTPS works via Tailscale certs
- Mobile access confirmed working
- Screenshots included
- Common errors documented

**Dependencies:** Task 7.2

---

### Task 8.2: exe.dev Deployment

**Priority:** P1  
**Estimated Time:** 6 hours

**Deliverables:**
- [ ] Create exe.dev install script
- [ ] Write deployment guide
- [ ] Setup health check endpoint
- [ ] Create startup/supervisor script
- [ ] Test on exe.dev VM

**One-Command Install:**
```bash
ssh my-vm.exe.xyz
curl -fsSL https://get.agemon.dev/exe-dev | bash
```

**Acceptance Criteria:**
- Install script works on exe.dev Ubuntu
- Agemon accessible at https://{vm}.exe.xyz
- Auto-starts on VM reboot
- Health check returns 200 OK
- Logs viewable via journalctl

**Dependencies:** Task 7.2

---

### Task 8.3: User Documentation

**Priority:** P0  
**Estimated Time:** 10 hours

**Deliverables:**
- [x] Quick start guide
- [x] Architecture overview
- [x] API reference
- [x] Deployment guides (local dev done; tailscale/exe-dev/vps pending)
- [ ] Troubleshooting FAQ
- [ ] Contributing guide

**Documentation Structure:**
```
docs/
├── getting-started.md
├── architecture.md
├── deployment/
│   ├── local.md
│   ├── tailscale.md
│   ├── exe-dev.md
│   └── vps.md
├── api-reference.md
├── troubleshooting.md
└── contributing.md
```

**Acceptance Criteria:**
- All major features documented
- Code examples included
- Screenshots for UI features
- Step-by-step deployment guides
- Common issues in FAQ
- Markdown properly formatted

**Dependencies:** All previous tasks

---

### Task 8.4: Mobile UX Polish

**Priority:** P1  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Add touch gestures (swipe back)
- [ ] Create PWA manifest
- [ ] Setup service worker (offline Kanban)
- [ ] Test on iOS Safari and Chrome mobile
- [ ] Fix any mobile-specific bugs

**Note:** Push notifications and PWA manifest moved to **Phase 9** (Task 9.1). This task focuses on gesture polish and mobile bug fixes only.

**Acceptance Criteria:**
- Swipe-back gesture works
- No layout issues on mobile
- Tested on real iPhone and Android device

**Dependencies:** Phase 2 tasks

---

### Task 8.5: Launch Materials

**Priority:** P0  
**Estimated Time:** 8 hours

**Deliverables:**
- [ ] Record demo video (90 seconds)
- [ ] Create screenshot gallery
- [ ] Write Hacker News launch post
- [ ] Polish GitHub README
- [ ] Create comparison table (vs competitors)
- [ ] Setup analytics (optional, privacy-first)

**Demo Video Flow:**
1. Add task from phone (15s)
2. Agent starts working (15s)
3. Check progress on phone (10s)
4. Approve diff from phone (20s)
5. PRs created automatically (15s)
6. View completion summary (15s)

**Acceptance Criteria:**
- Video is clear and well-paced
- Screenshots show key features
- HN post follows community guidelines
- README compelling and informative
- Comparison table factually accurate
- Ready to launch

**Dependencies:** Task 8.3, Task 8.4

---

### Task 8.6: Astro Website & Documentation Site

**Priority:** P1
**Estimated Time:** 12 hours

**Deliverables:**
- [ ] Initialize Astro project in `website/` directory
- [ ] Configure Tailwind CSS (share config with main app)
- [ ] Create product landing page (hero, features, demo, CTA)
- [ ] Setup content collections for documentation
- [ ] Migrate markdown docs from Task 8.3
- [ ] Add interactive React components (component islands)
- [ ] Create mobile-responsive layout
- [ ] Setup deployment (GitHub Pages, Vercel, or Cloudflare Pages)

**Project Structure:**
```
website/
├── src/
│   ├── pages/
│   │   ├── index.astro              # Landing page
│   │   └── docs/[...slug].astro     # Docs routes
│   ├── content/
│   │   └── docs/                    # Markdown documentation
│   │       ├── getting-started.md
│   │       ├── deployment/
│   │       │   ├── local.md
│   │       │   ├── tailscale.md
│   │       │   ├── exe-dev.md
│   │       │   └── vps.md
│   │       ├── api-reference.md
│   │       ├── troubleshooting.md
│   │       └── contributing.md
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── Features.astro
│   │   ├── DemoVideo.astro
│   │   └── CodeExample.tsx          # React component
│   └── layouts/
│       ├── BaseLayout.astro
│       └── DocsLayout.astro
├── public/
│   ├── screenshots/
│   └── demo.mp4
├── astro.config.mjs
└── package.json
```

**Landing Page Sections:**
1. Hero - "Manage AI Agents from Your Phone"
2. Problem/Solution - Mobile-first orchestration gap
3. Features Grid - Terminal, Diffs, Multi-repo, Mobile review
4. Demo Video - 90-second walkthrough
5. Deployment Options - Quick start guides
6. GitHub CTA - Star repository and install

**Technical Requirements:**
- Static site generation (SSG)
- Share Tailwind config with main app
- React component islands for interactive demos
- Syntax highlighting for code examples
- Mobile-responsive (obviously!)
- Dark mode support
- Search functionality for docs

**Acceptance Criteria:**
- Landing page loads in <1 second on mobile 4G
- Lighthouse score >95 (all categories)
- All deployment guides tested and accurate
- Screenshots show actual app UI
- Mobile-responsive on all pages
- Docs are searchable
- Works offline (PWA optional)
- Deploy URL accessible and stable

**Deployment:**
- **Cloudflare Pages** (Primary)
- Production URL: `https://agemon.dev`
- Preview deployments: Auto-generated for PRs
- Global CDN: 117+ edge locations
- Zero-config Astro integration

**Dependencies:** Task 8.3 (User Documentation), Task 8.5 (Launch Materials - demo video)

**Parallelizable:** Can run alongside Tasks 7.1-7.3 (Build System) and 8.1-8.2 (Deployment Guides)

---
