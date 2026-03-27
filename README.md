# Agemon

> Self-hosted, mobile-first AI agent orchestration platform.

Queue tasks, monitor agent thought streams, respond to blockers, and approve diffs — all from your phone.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.1+
- Node.js 20+ (for some native modules)
- Git

### Development

```bash
# Clone
git clone https://github.com/your-org/agemon.git
cd agemon

# Configure environment (optional — .env.example has sensible defaults)
cp .env.example .env

# Install dependencies
bun install

# Start backend + frontend in parallel
bun run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Health check: http://localhost:3000/api/health

### Seed sample data

```bash
cd backend
bun run src/db/seed.ts
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Bun 1.1+ |
| Backend | Hono 4.x |
| Database | SQLite (bun:sqlite) |
| Frontend | React 18 + Vite 5 |
| UI Components | shadcn/ui + Tailwind CSS |
| Router | TanStack Router |
| State | TanStack Query + Zustand |
| Terminal | xterm.js (lazy-loaded) |
| Git | simple-git |
| Agent Protocol | ACP SDK |

---

## Project Structure

```
agemon/
├── backend/          # Hono server + DB + agent management
├── frontend/         # React + Vite mobile-first UI
├── shared/types/     # Shared TypeScript types
├── website/          # Astro landing page + docs
├── .env.example
└── package.json      # Bun workspace root
```

---

## Documentation

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [API Reference](docs/api-reference.md)
- [Extension System](docs/extensions.md)
- [ACP Agents](docs/acp-agents.md)

---

## License

MIT
