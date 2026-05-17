# Build Instructions

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **Git**

## Setup

```bash
# Clone the repository
git clone https://github.com/SPhillips1337/vibes-dashboard.git
cd vibes-dashboard

# Install dependencies
npm install
```

### HTTPS Certificates (Optional)

Required for microphone/voice features (browsers require a secure context for `SpeechRecognition`):

```bash
bash generate_cert.sh
```

This creates `certs/cert.pem` and `certs/key.pem` — self-signed certificates valid for 365 days.

## Running

### Production

```bash
npm start
```

Starts the server on `http://0.0.0.0:9000`. Override with:

```bash
PORT=9001 HOST=127.0.0.1 npm start
```

### Development (with auto-reload)

```bash
npm run dev
```

Uses Node.js `--watch` flag to automatically restart on file changes.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9000` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `VIBES_PATH` | `~/Vibes` | Path to Vibes repository root |
| `USE_VIBES` | `auto` | Force real Vibes agents (`true`) or demo mode (`false`) |

## Frontend

No build step required. The frontend is vanilla HTML/CSS/JS served statically by Express. Edit files directly in `public/` and refresh the browser.

## Vibes Integration (Optional)

For real agent orchestration (instead of demo simulation):

1. Clone the [Vibes](https://github.com/SPhillips1337/Vibes) repository
2. Set `VIBES_PATH` to its location (defaults to `~/Vibes`)
3. Ensure `src/mcp/server.ts` exists within the Vibes repo
4. The server auto-detects the Vibes repo and enables real mode
