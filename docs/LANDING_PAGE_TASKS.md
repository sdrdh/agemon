# Agemon Website — Task Breakdown

**Replaces:** Task 8.6 in TASKS.md (more granular breakdown here)
**Last Updated:** March 2026

---

## Phase A: Project Setup

### A.1: Initialize Astro Project

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Initialize Astro 4.x in `website/` directory within the Bun workspace
- [ ] Configure Tailwind CSS (extract shared config from main app or import shared tokens)
- [ ] Setup React integration for component islands
- [ ] Configure content collections for docs (type-safe markdown)
- [ ] Add Pagefind for static search
- [ ] Dark mode support (default dark, light toggle, respect `prefers-color-scheme`)
- [ ] Base layout with header (logo, nav, GitHub link, theme toggle) and footer
- [ ] Docs layout with collapsible sidebar navigation
- [ ] Mobile-responsive nav (hamburger menu, touch-friendly sidebar)
- [ ] Verify `bun run dev` works from workspace root

**Structure:**
```
website/
├── src/
│   ├── pages/
│   │   ├── index.astro
│   │   └── docs/[...slug].astro
│   ├── content/
│   │   └── docs/
│   ├── components/
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   └── DocsLayout.astro
│   └── styles/
├── public/
│   └── screenshots/
├── astro.config.mjs
├── tailwind.config.ts
└── package.json
```

---

## Phase B: Landing Page

### B.1: Hero Section

**Estimated Time:** 3 hours

**Deliverables:**
- [ ] Hero with headline, subheadline, and two CTA buttons (Get Started + GitHub)
- [ ] Phone mockup visual showing Agemon UI (screenshot or animated)
- [ ] Responsive: stacked on mobile, side-by-side on desktop
- [ ] Terminal-style install command with copy button
- [ ] Animate on scroll or subtle entrance animation (keep it tasteful)

### B.2: Problem & Positioning Section

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] "Why Agemon" narrative — desktop-bound agents gap, mobile oversight need
- [ ] Competitor comparison table (Emdash, Conductor, Claude Squad, OpenHands)
- [ ] Highlight differentiators: mobile-first, self-hosted, agent-agnostic, task lifecycle
- [ ] Clean, scannable layout — no walls of text

### B.3: Feature Highlights

**Estimated Time:** 3 hours

**Deliverables:**
- [ ] Feature grid or alternating sections for 6-8 key features
- [ ] Each feature: icon/screenshot, short title, one-line description
- [ ] Features: Kanban board, thought streams, multi-repo, one-tap PRs, agent-agnostic, self-hosted, terminal, notifications
- [ ] Screenshots or mini-demos inline where possible
- [ ] Mobile: single-column stack, desktop: 2-3 column grid

### B.4: How It Works

**Estimated Time:** 1 hour

**Deliverables:**
- [ ] 4-step visual flow: Deploy → Queue → Monitor → Ship
- [ ] Simple icons or illustrations per step
- [ ] Brief description under each step (one sentence)

### B.5: Deployment Options Cards

**Estimated Time:** 1 hour

**Deliverables:**
- [ ] Cards for Tailscale, exe.dev, VPS, Local
- [ ] Each card: icon, 2-3 line summary, "Read guide →" link
- [ ] Highlight Tailscale as recommended

### B.6: Demo Section

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Embedded video player or animated GIF walkthrough
- [ ] Placeholder if video not ready (annotated screenshot carousel)
- [ ] Mobile-friendly video sizing
- [ ] Caption/narration text alongside or below

**Dependency:** Task 8.5 (Launch Materials — demo video). Can use placeholder initially.

### B.7: Footer & CTA

**Estimated Time:** 1 hour

**Deliverables:**
- [ ] Final CTA: install command + "Get started in 5 minutes"
- [ ] Footer: GitHub, docs, license, "Built by [author]"
- [ ] Social/community links if applicable

---

## Phase C: Documentation

### C.1: Migrate Existing Docs

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Migrate `docs/getting-started.md` → content collection
- [ ] Migrate `docs/architecture.md` → content collection
- [ ] Migrate `docs/api-reference.md` → content collection
- [ ] Migrate `docs/acp-agents.md` → content collection
- [ ] Migrate `docs/deployment/local.md` → content collection
- [ ] Add frontmatter (title, description, order) to each doc
- [ ] Verify all docs render correctly with syntax highlighting

### C.2: Write Missing Docs

**Estimated Time:** 4 hours

**Deliverables:**
- [ ] Core Concepts: Tasks & Lifecycle
- [ ] Core Concepts: Agent Sessions (spawning, states, resume)
- [ ] Core Concepts: Multi-Repo Worktrees
- [ ] Deployment: Tailscale guide
- [ ] Deployment: exe.dev guide
- [ ] Deployment: VPS / custom domain guide
- [ ] Agents: Supported agents overview (Claude Code, OpenCode, Aider, Gemini)
- [ ] Agents: Installation & authentication per agent
- [ ] Guides: Updating Agemon (self-update via supervisor)
- [ ] Guides: Process supervision (systemd / launchd)
- [ ] Troubleshooting FAQ
- [ ] Contributing guide

**Dependencies:** Task 8.1 (Tailscale guide), Task 8.2 (exe.dev guide) — can stub and fill later.

### C.3: Docs Navigation & Search

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Sidebar navigation auto-generated from content collection (grouped by section)
- [ ] Breadcrumbs on doc pages
- [ ] Previous/Next navigation at bottom of each doc
- [ ] Pagefind search integration (search bar in docs header)
- [ ] Mobile: collapsible sidebar, search accessible from hamburger menu
- [ ] "Edit on GitHub" link on each doc page

---

## Phase D: Polish & Deploy

### D.1: Screenshots & Assets

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Capture real app screenshots for landing page and docs
- [ ] Phone mockup frames for hero
- [ ] Optimize images (WebP, proper sizing)
- [ ] Open Graph / social share images (for Twitter/HN links)

### D.2: Performance & SEO

**Estimated Time:** 2 hours

**Deliverables:**
- [ ] Lighthouse score >95 on all categories
- [ ] Page load <1s on mobile 4G
- [ ] Meta tags, Open Graph, Twitter cards on all pages
- [ ] Sitemap generation
- [ ] robots.txt
- [ ] Structured data (JSON-LD) for the product

### D.3: Cloudflare Pages Deployment

**Estimated Time:** 1 hour

**Deliverables:**
- [ ] Connect repo to Cloudflare Pages
- [ ] Configure build command (`astro build` in website directory)
- [ ] Custom domain: `agemon.dev`
- [ ] Preview deployments for PRs
- [ ] Verify HTTPS, caching, CDN distribution

---

## Summary

| Phase | Tasks | Estimated Total |
|-------|-------|----------------|
| A. Setup | A.1 | 2 hours |
| B. Landing Page | B.1–B.7 | 13 hours |
| C. Documentation | C.1–C.3 | 8 hours |
| D. Polish & Deploy | D.1–D.3 | 5 hours |
| **Total** | | **~28 hours** |

### Parallelization
- Phase B (landing) and Phase C (docs) can run in parallel after Phase A
- Phase D depends on B + C being mostly complete
- Demo video (B.6) can use placeholder until Task 8.5 delivers
- Deployment guides (C.2) can be stubbed and filled when Tasks 8.1/8.2 are done
