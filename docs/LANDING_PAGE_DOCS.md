# Agemon Landing Page & Documentation Site

**Domain:** `https://agemon.dev`
**Framework:** Astro 4.x + React Islands
**Deployment:** Cloudflare Pages
**Last Updated:** March 2026

---

## 1. Purpose

The agemon.dev site serves two audiences:

1. **Potential users** — developers discovering Agemon via HN, GitHub, Twitter. They need to understand what it is, why it's different, and how to get started in under 60 seconds of reading.
2. **Existing users** — developers who self-host Agemon and need reference docs for deployment, API, agent configuration, and troubleshooting.

The site is a single Astro project with two major sections: a product landing page and a documentation hub.

---

## 2. Landing Page

### Hero Section
- **Headline:** "Manage AI Agents from Your Phone"
- **Subheadline:** Queue tasks, monitor agent thought streams, approve diffs — all from mobile.
- **CTA buttons:** "Get Started" (→ docs/getting-started) + "View on GitHub" (→ repo)
- **Visual:** Phone mockup showing the Agemon Kanban board with a task in "Awaiting Input" state. Ideally an animated sequence: task created → agent working → notification → approve from phone.
- Keep it punchy. No paragraphs. The hero sells the concept in 5 seconds.

### Problem / Why This Exists
- Existing agent tools (Emdash, Conductor, Claude Squad) are desktop-bound
- You can't check on your agents from your phone
- You can't approve a diff during your commute
- Agemon is the missing piece: a mobile-first web UI for agent orchestration
- Position against competitors with a simple comparison table (like the one in PRD §3)

### Feature Highlights
Grid or alternating left-right sections. Each feature gets:
- Icon or small screenshot
- Short title (5 words max)
- One-line description
- Optional: inline demo/animation

**Features to highlight:**
1. **Mobile-First Kanban** — Task board designed for touch. Create tasks, monitor status, respond to blockers from your phone.
2. **Live Agent Thought Streams** — Watch your agent think in real-time. Per-session chat with full event history.
3. **Multi-Repo Orchestration** — One task, multiple repos. Isolated git worktrees, coordinated PRs.
4. **One-Tap PR Creation** — Review diffs on mobile, approve, and create linked PRs across repos with a single tap.
5. **Agent-Agnostic** — Works with Claude Code, OpenCode, Aider, Gemini CLI, or any ACP-compatible agent.
6. **Self-Hosted & Private** — Your machine, your data. Single binary, SQLite, no cloud dependency.
7. **Interactive Terminal** — Full PTY terminal in browser. SSH into your agent's world from your phone.
8. **Smart Notifications** — Know when your agent needs you. Push alerts for blockers, completion, errors.

### Demo Section
- Embedded video or animated GIF walkthrough (90 seconds max)
- Shows the full flow: create task on phone → agent works → notification → approve diff → PRs created
- Fallback: series of annotated screenshots if video isn't ready at launch

### How It Works
Simple 3-4 step visual:
1. **Deploy** — Single binary on your machine. Works with Tailscale, exe.dev, or any VPS.
2. **Queue** — Add tasks from your phone. Describe what you want built.
3. **Monitor** — Watch agents work. Get notified when they need input.
4. **Ship** — Review diffs, approve changes, create PRs — all from mobile.

### Deployment Options
Cards for each deployment method:
- **Tailscale** (recommended) — end-to-end encrypted, access from anywhere
- **exe.dev** — easiest, one-command install, automatic HTTPS
- **VPS** — traditional, Caddy for HTTPS, custom domain
- **Local** — development setup

Each card: 2-3 line summary + "Read guide →" link to docs.

### Tech Stack / Architecture
Brief, developer-focused section:
- Bun + Hono backend, SQLite, React frontend
- ACP protocol (JSON-RPC 2.0 over stdio) for agent communication
- WebSocket for real-time updates
- Link to architecture docs for deep dive

### Social Proof / Community (post-launch)
- GitHub stars count
- Testimonials / quotes from early users
- "Built by [author]" with links

### Footer CTA
- "Get started in 5 minutes" + install command
- GitHub link, docs link, community links

---

## 3. Documentation Hub

### Structure

```
docs/
├── Getting Started
│   ├── Quick Start (install + first task in 5 minutes)
│   ├── System Requirements
│   └── Configuration (.env, AGEMON_KEY, ports)
│
├── Core Concepts
│   ├── Tasks & Lifecycle (statuses, how tasks flow)
│   ├── Agent Sessions (spawning, states, resume)
│   ├── Multi-Repo Worktrees (isolation, branch naming)
│   └── ACP Protocol (how agents communicate)
│
├── Deployment
│   ├── Local Development
│   ├── Tailscale (recommended)
│   ├── exe.dev
│   └── VPS / Custom Domain
│
├── Agents
│   ├── Supported Agents (Claude Code, OpenCode, Aider, Gemini)
│   ├── Agent Installation & Auth (per-agent setup instructions)
│   ├── Adding Custom Agents (ACP compatibility requirements)
│   └── Agent Configuration (models, modes, defaults)
│
├── API Reference
│   ├── REST Endpoints
│   ├── WebSocket Events
│   └── Authentication
│
├── Guides
│   ├── Creating Your First Task
│   ├── Multi-Repo Workflow
│   ├── Mobile Workflow Tips
│   ├── Updating Agemon (self-update via supervisor)
│   └── Process Supervision (systemd / launchd)
│
├── Troubleshooting
│   ├── Common Issues
│   ├── Agent Won't Start
│   ├── WebSocket Connection Problems
│   └── Git / Worktree Errors
│
└── Contributing
    ├── Development Setup
    ├── Architecture Overview
    ├── Code Conventions
    └── Submitting PRs
```

### Documentation Principles
- **Task-oriented** — docs organized by what users want to do, not by internal architecture
- **Copy-paste friendly** — every code block should be runnable as-is
- **Mobile-readable** — docs are often read on phone while debugging. Short paragraphs, clear headings, no wide tables
- **Progressive disclosure** — quick start first, deep dives linked from there
- **Versioned** — docs should note which Agemon version they apply to

### Search
- Astro + Pagefind (static search, zero JS cost until used)
- Indexes all doc pages at build time
- Search bar in docs header

---

## 4. Design Direction

### Visual Identity
- **Dark-first** — matches the app's default Monochrome Stealth theme
- **Monospace accents** — code-focused developer aesthetic
- **Accent color** — match the app's primary (from current theme)
- **No stock photos** — only real screenshots, code blocks, and simple illustrations/diagrams

### Typography
- System font stack for body (fast, native feel)
- Monospace for code and UI labels
- Clean hierarchy: large hero text, medium section headers, readable body

### Mobile Responsiveness
- Landing page must look great on phone (this is a mobile-first product — the site should prove it)
- Docs must be readable on phone with proper code block horizontal scroll
- Touch-friendly navigation (sidebar collapse, hamburger menu)

### Dark Mode
- Default to dark, with light mode toggle
- Respect `prefers-color-scheme`
- Code blocks use matching syntax theme

---

## 5. Technical Decisions

### Astro 4.x
- Static site generation — fast, cacheable, cheap to host
- Content collections for type-safe markdown docs
- React component islands for interactive elements (demo, code tabs)
- Built-in image optimization

### Cloudflare Pages
- Global CDN, automatic HTTPS
- Preview deployments for PRs
- Zero-config Astro adapter
- Custom domain: `agemon.dev`

### Shared Tailwind Config
- Extract common Tailwind config (colors, fonts, spacing) from the main app
- Website imports it so the site visually matches the product
- Keeps brand consistency without duplicating theme values

### Content from Existing Docs
- Existing `docs/` folder content migrates into Astro content collections
- Source of truth moves to `website/src/content/docs/`
- Consider keeping raw markdown in `docs/` and symlinking/copying at build time if other tools reference them

---

## 6. Open Questions

1. **Domain:** Is `agemon.dev` purchased and configured?
2. **Demo video:** Record before or after launch? Use screenshots as placeholder?
3. **Analytics:** Privacy-first analytics (Plausible/Fathom) or none?
4. **Blog/Changelog:** Include a blog section for updates, or just GitHub releases?
5. **Community:** Discord/GitHub Discussions link on the site?
6. **Docs source of truth:** Live in `website/src/content/` or keep in `docs/` and copy at build?
