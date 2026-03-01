# Local Development

## Requirements

- Bun 1.1+
- Git

## Setup

```bash
git clone https://github.com/your-org/agemon.git
cd agemon
cp .env.example .env

# Edit .env
nano .env  # Set AGEMON_KEY and GITHUB_PAT

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

Open `http://<your-ip>:5173` on your phone.

Set your API key by opening `http://<your-ip>:5173` in the browser and entering your `AGEMON_KEY` on the login screen. It is stored in localStorage.

## Seed sample data

```bash
bun run backend/src/db/seed.ts
```
