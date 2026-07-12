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

### `server/coordination-adapter.js`
Dependency-injected boundary to local Agent Communication MCP. Production uses `AGENT_COMM_MCP_URL`, `AGENT_COMM_MCP_TOKEN`, and a bounded timeout; tests inject fixture clients. Upstream tool names live in one `TOOL_NAMES` mapping. The adapter normalizes provider readiness and activity, derives approval/verification/artifact projections, and emits stable unavailable reasons without exposing secrets or raw errors. Its protected `GET /api/control-center` route returns `503` rather than simulated data when unavailable.

### `server/harness/`
The durable run core uses versioned, size-limited event envelopes (`event-contract.js`), filesystem persistence (`run-store.js`), deterministic replay (`run-projector.js`), and a lifecycle boundary (`run-service.js`). Each run has immutable initial metadata in `run.json` and an append-only `events.jsonl`; snapshot replacements are atomic and concurrent event appends are serialized per run. `RunService` generates event IDs and harness actors internally, persists before emitting, enforces transitions, and writes only allowlisted `plan.json` and `verification.json` documents.

Startup restoration completes before the server listens. Terminal, approval, and blocked runs retain their state. Planning, execution, and verification runs receive an appended `run.restored` event and project as `interrupted`; no child process is restarted. Truncated final JSONL records are ignored with warnings exposed on the run projection. The server's `agents` map and existing `agent-created`, `agent-updated`, and `agent-log` messages are compatibility projections only. `[TASK_STATUS]` stderr is parsed by `agent-compat.js` into typed task events rather than mutating authority state.

Execution and verification are separate trust boundaries: `execution.claimed_complete` automatically enters one attempt-keyed verification orchestration seam; only `verification.passed` projects `completed`, while `verification.failed` projects `failed`. `verification-policy.js` loads server-owned allowlisted argv recipes from `HARNESSES_VERIFICATION_POLICY`; `verifier.js` uses `shell:false`, a fixed run-workspace cwd, bounded environment/time/output, and containment-safe artifact validation. Every artifact result is persisted as `artifact.validated` before the final outcome, and `verification.json` retains command evidence or a verifier-grounded failure record. Real runs fail closed when no checks are configured. Secret-bearing fields are rejected or structurally redacted before persistence. Runtime run directories under `data/harness/runs/` are local, retained as whole directories, and excluded from version control. See [ADR-0005](adr/ADR-0005-durable-harness-runs.md).

Demo runs are prototype fixtures only. Their plan and completion records carry `demo_fixture_only: true`, bypass external command verification, and must not be treated as evidence that a real workspace task was verified.

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

### `control-center`
* **Path**: `modules/control-center/`
* Displays provider readiness, recent activity, pending approvals, verification outcomes, and artifact references.
* Uses a Node-testable deterministic view model and safe DOM creation/`textContent` for every live value. Explicit empty and unavailable states replace demo or random values; responsive glass panels collapse at narrow widths.
