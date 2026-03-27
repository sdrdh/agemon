# Getting Started with Agemon

Agemon is a self-hosted, headless AI agent orchestration platform with a mobile-first web UI.

## Prerequisites

- [Bun](https://bun.sh) 1.1+
- Git

## Installation

```bash
git clone https://github.com/your-org/agemon.git
cd agemon

# Configure environment (optional — .env.example has sensible defaults)
cp .env.example .env

# Install dependencies
bun install

# Start dev server (backend :3000 + frontend :5173)
bun run dev
```

Open http://localhost:5173 in your browser (or phone via Tailscale).

## First Task

1. Open Agemon on your phone
2. Tap the **+** button
3. Enter a title, select repos, pick an agent
4. Task appears in the **To-Do** column
5. Tap the task → tap **Start Agent**
6. Watch the thought stream as the agent works

## Next Steps

- [Architecture overview](architecture.md)
- [API reference](api-reference.md)
- [Deployment options](deployment/local.md)
