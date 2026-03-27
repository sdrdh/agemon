# Local Development

## Requirements

- Bun 1.1+
- Git

## Setup

```bash
git clone https://github.com/your-org/agemon.git
cd agemon
cp .env.example .env

bun install
bun run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Access from phone (same network)

Find your local IP:
```bash
ipconfig getifaddr en0   # macOS
ip route get 1 | awk '{print $NF; exit}'  # Linux
```

Open `http://<your-ip>:5173` on your phone. Auth is handled by your reverse proxy (Tailscale, Cloudflare Access, etc.) — no login screen required.

## Seed sample data

```bash
bun run backend/src/db/seed.ts
```
