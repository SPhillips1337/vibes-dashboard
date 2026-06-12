# Vibes Dashboard

Premium glassmorphic dashboard for orchestrating autonomous [Vibes](https://github.com/lalalune/vibes) subagents. Features real-time agent monitoring, reactive Three.js/WebGL backgrounds, an integrated music player with audio visualizer, and voice-command control.

> Tested on **Ubuntu Linux** with **Google Chrome**. The built-in `SpeechRecognition` API works best in Chrome.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/SPhillips1337/vibes-dashboard.git
cd vibes-dashboard
npm install

# (Optional) Generate self-signed certs — required for microphone access
bash generate_cert.sh

# Start
npm start
```

Open **https://localhost:9000** (or http://localhost:9000 without certs — voice won't work).

### One-line installer (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/SPhillips1337/vibes-dashboard/main/install.sh | bash
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `9000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `ADMIN_PASSWORD` | `VibesAdmin2026!` | Seed admin password — **change immediately** |
| `USE_VIBES` | auto-detect | `true` = real agents, `false` = demo simulation |
| `ALLOW_LOCAL_PROXY` | `true` in dev | Allow browser proxy to reach private IPs |

---

## Project Structure

```
├── modules/                # Drop-in modular panels (manifest.json + view/style/script)
│   ├── music/              # Vibe Station — Jamendo discovery, player, visualizer
│   ├── orchestrator/       # Agent launch, monitoring, live log streaming
│   ├── settings/           # Tabbed settings (General, Voice, LLM, Orchestration)
│   ├── terminal/           # Terminal emulator
│   ├── web-browser/        # Sandboxed iframe browser with dock tabs
│   ├── log-viewer/         # Real-time log viewer
│   ├── linkedin-workbench/ # Content calendar & RSS automation
│   └── module-manager/     # Sidebar reordering & panel config
├── public/
│   ├── index.html          # Shell SPA
│   ├── css/style.css       # Design system tokens
│   ├── js/
│   │   ├── app.js          # Module loader
│   │   ├── background.js   # Three.js WebGL background engine
│   │   ├── music.js        # Core audio controller
│   │   ├── settings.js     # Settings persistence
│   │   └── voice.js        # Wake-word + command + TTS engine
│   └── audio/              # Local MP3 tracks
├── server/
│   ├── index.js            # Express + Socket.io + all API routes
│   ├── auth.js             # Session, RBAC, rate limiting, scrypt hashing
│   └── vibes-bridge.js     # Child-process bridge to Vibes CLI (JSON-RPC)
├── data/music/
│   └── saved_playlist.json # Virtual playlist — Jamendo stream metadata
├── certs/                  # SSL certs (generated, gitignored)
├── docs/                   # Technical reference docs
├── research/               # External references, VFX links, notes
├── CONTEXT.md              # Project operating manual (read this first)
├── AGENTS.md               # AI agent rules (design constraints, protocol)
├── HERMES.md               # Agent workflow guide (repo conventions + ADR index)
└── package.json
```

---

## Documentation

| Doc | Purpose |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Stack, rules, architecture decisions — the operating manual |
| [HERMES.md](HERMES.md) | Agent workflow, conventions, ADR index |
| [AGENTS.md](AGENTS.md) | Design system rules for AI agents |
| [docs/API.md](docs/API.md) | REST & WebSocket API reference |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture overview |
| [docs/BUILD.md](docs/BUILD.md) | Build & dev setup |
| [docs/TESTING.md](docs/TESTING.md) | Testing approach |
| [research/LINKS.md](research/LINKS.md) | Curated external references |

---

## Key Features

- **Agent Orchestration** — Launch, monitor, and terminate Vibes subagents with live log streaming via Socket.io
- **Modular Panel System** — Drop a folder in `/modules/` with a `manifest.json` to add a new panel
- **Glassmorphism UI** — Dark-mode with `backdrop-filter: blur(12px)`, vibrant blue accents, micro-animations
- **Three.js Backgrounds** — WebGL reactive backgrounds (Nebula Flow, Cyber Stream, Aurora Waves, etc.)
- **Vibe Station** — Music player with Jamendo API search (royalty-free), virtual playlist, audio visualizer
- **Voice Commands** — Wake-word detection ("Vibes"), Web Speech API, TTS feedback, intent registry
- **LLM Provider** — Configure Ollama, LM Studio, or OpenAI-compatible backends
- **Security** — HTTPS, `__Host-` cookies, CSRF tokens, scrypt hashing, SSRF blocking

---

## Development

```bash
npm run dev        # Start with --watch auto-restart
```

No build step — vanilla HTML/CSS/JS served by Express.

### Adding a Module

1. Create `modules/<name>/manifest.json` (id, name, subtitle, icon, css, html, js)
2. Add `view.html`, `style.css`, `script.js`
3. Restart — the server auto-discovers and serves it

---

## License

MIT
