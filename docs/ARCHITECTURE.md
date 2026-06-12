# Architecture

## System Overview

Vibes Dashboard is a pluggable command center designed around a Node.js/Express backend and a vanilla HTML/CSS/JS frontend. Communication between layers occurs via secure REST endpoints and Socket.io WebSockets.

```
┌────────────────────────────────────────────────────────┐
│                        Browser                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐          │
│  │  app.js  │  │ music.js │  │   voice.js   │          │
│  │ (agents) │  │ (player) │  │ (speech/TTS) │          │
│  └──────────┘  └──────────┘  └──────────────┘          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐          │
│  │background│  │settings.js│ │   Three.js   │          │
│  │ (2D/3D)  │  │ (config) │  │ (WebGL scene)│          │
│  └──────────┘  └──────────┘  └──────────────┘          │
│  ┌──────────────────────────────────────────┐          │
│  │             Modular Panels               │          │
│  │  (Orchestrator, Terminal, Browser,      │          │
│  │   LinkedIn Workbench, Music, Manager)    │          │
│  └──────────────────────────────────────────┘          │
│         ↕ REST + Socket.io                             │
├────────────────────────────────────────────────────────┤
│                     Node.js Server                     │
│  ┌────────────────┐  ┌──────────────────────┐          │
│  │  Express (REST) │  │  Socket.io (Events)  │          │
│  └────────────────┘  └──────────────────────┘          │
│  ┌──────────────────────────────────────────┐          │
│  │            VibesBridge                   │          │
│  │  (JSON-RPC over child process stdio)    │          │
│  └──────────────────────────────────────────┘          │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │  LLM Proxy   │  │  Theme Scan  │                    │
│  └──────────────┘  └──────────────┘                    │
│              ↕ stdin/stdout (JSON-RPC)                 │
├────────────────────────────────────────────────────────┤
│         Vibes MCP Server (child process)               │
│         (tsx src/mcp/server.ts)                        │
└────────────────────────────────────────────────────────┘
```

---

## 📂 Backend Architecture

### `server/index.js`
The core application server:
* **Static Asset Delivery**: Serves standard resources from `public/` and modular subviews from `modules/`.
* **Session & Guarding**: Validates TLS connections, enforces Operator/Admin privileges (RBAC), and checks CSRF tokens on mutate requests.
* **Jamendo Bridge**: Processes keywords, queries Jamendo's API endpoints, and registers virtual streams to `/data/music/saved_playlist.json`.
* **LLM Proxy Gateways**: Proxies tags and models requests to avoid browser-level CORS errors.
* **Theme Scanner**: Auto-discovers `.css` stylesheet themes from `public/themes/*/`.
* **LinkedIn Calendar**: Parses and writes content changes to calendar formats and triggers background python import tasks.

### `server/vibes-bridge.js`
The `VibesBridge` handles child process spawning:
* Launches and monitors `tsx src/mcp/server.ts`.
* Translates between dashboard settings and Vibes model specifications.
* Pipes log lines and progress to client sockets.

---

## 🎨 Frontend Architecture

### `public/index.html`
The Single Page Application shell containing:
* Floating sidebar layout with ordering configuration.
* Frosted glass card grids and forms.
* Dock tab system to manage minimized browser panels.
* Background element bindings for canvas rendering.

### `public/js/app.js`
The central state hub for the frontend:
* Fetches module manifests from `/api/modules` and dynamically appends styling, templates, and scripts.
* Implements the client-side router and view transitions.
* Manages Socket.io hooks and updates active count widgets.
* Handles login forms and theme sheet binding.

### `public/js/background.js`
A dual-layer visualizer:
* **2D Canvas Layer**: Draws floating organic nodes with interactive spring forces, connection lines, and lightning storm generators.
* **WebGL Container**: Leverages **Three.js** to manage GPU-accelerated scenes (Cosmic Anomaly galaxy, Liquid Fluid domain noise, and Volumetric Cloud rays).
* **Audio-Reactivity**: Tracks average frequencies and energy levels from the active audio analyser.

### `public/js/voice.js`
The voice interaction controller:
* Listens continuously for the wake phrase **"Vibes"** using Web Speech Recognition.
* Triggers audio chime alerts and temporary volume ducking during microphone capture.
* Processes intent mapping (navigation, launch command, theme switching, cancellation).
* Prompts confirmations for destructive options and verbalizes responses using Synthesis.

### `public/js/music.js`
The background playback system:
* Connects the HTML5 `Audio` element to Web Audio `AudioContext`.
* Employs an `AnalyserNode` to export frequency bins for the visualizer.

---

## 🔌 Core Modular Panel Directory (`/modules/`)

Modules are manifest-driven views that the core loads. Key panels include:

### `orchestrator`
* **Path**: `modules/orchestrator/`
* Renders agent mission forms, progress gauges, and task lists. Handles dictations.

### `terminal`
* **Path**: `modules/terminal/`
* Emulates terminal viewports to capture execution logs.

### `web-browser`
* **Path**: `modules/web-browser/`
* Encapsulates sandboxed web page navigation through local proxies to prevent frame blocking.

### `music`
* **Path**: `modules/music/`
* Renders player playlists, volume adjustments, and Jamendo discovery panels.

### `linkedin-workbench`
* **Path**: `modules/linkedin-workbench/`
* Coordinates social media content calendars and triggers RSS scrapers.

### `module-manager`
* **Path**: `modules/module-manager/`
* Controls sidebar positioning and dynamically manages panel listings.
