# Glass Vibes Dashboard

Premium glassmorphic dashboard for orchestrating Vibes subagents. A high-fidelity visual management layer for autonomous AI agents, featuring real-time process streaming, reactive particle backgrounds, an integrated music player, and audio-frequency visualizer.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/SPhillips1337/glass-vibes-dashboard.git
cd glass-vibes-dashboard

# Install dependencies
npm install

# Run the project
npm start
```

Open `http://localhost:9000` in your browser.

> **Configuration**: The server binds to `localhost` on port `9000` by default.
> Override via environment variables:
> ```bash
> PORT=9001 HOST=0.0.0.0 npm start
> ```

## Project Structure

```
├── public/             # Frontend assets
│   ├── index.html      # Main entry point
│   ├── css/
│   │   └── style.css   # Glassmorphism design system
│   ├── js/
│   │   ├── app.js      # Dashboard logic & agent management
│   │   ├── background.js  # Canvas particle simulation
│   │   └── music.js    # Audio player & frequency visualizer
│   └── audio/          # Background music tracks (.mp3)
├── server/             # Backend
│   ├── index.js        # Express + Socket.io server
│   └── vibes-bridge.js # Vibes CLI subagent orchestration
├── AGENTS.md           # AI agent guidelines
├── DESIGN.md           # Design tokens & component system
├── SPECIFICATION.md    # Technical specification
├── REQUIREMENTS.md     # Functional & non-functional requirements
├── TASKS.md            # Task tracker
└── package.json
```

## Documentation

- [Design System](DESIGN.md) — Design tokens, glassmorphism specs, component schema
- [Technical Specification](SPECIFICATION.md) — System architecture, UI specs, visual/audio engine
- [Requirements](REQUIREMENTS.md) — Functional and non-functional requirements
- [Agent Guidelines](AGENTS.md) — AI agent protocol and voice log system

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Running in Development

```bash
npm run dev
```

Starts the server with `--watch` for auto-restart on file changes.

### Building

No build step required — the frontend is vanilla HTML/CSS/JS served statically by Express.

## Features

- **Agent Management** — Launch, monitor, review, and terminate Vibes subagents from a visual dashboard
- **Real-Time Streaming** — Live progress updates via Socket.io WebSockets
- **Glassmorphism UI** — Premium dark-mode interface with `backdrop-filter: blur()` and vibrant blue accents
- **Reactive Background** — Canvas-based organic particle simulation that reacts to audio energy
- **Music Player** — Integrated player with curated city-vibe track selection
- **Frequency Visualizer** — Real-time audio frequency spectrum analysis using `AnalyserNode`

## Agent Protocol

This project follows the **AntiGravity Development Protocol** with a mandatory **Voice Log System**. Upon completing any significant task, a TTS-optimized summary report must be written to `/home/stephen/antigravity_reports/` in the format `YYYY-MM-DD_HHMM_Task_Name.md`.

## License

MIT
