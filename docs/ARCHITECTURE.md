# Architecture

## System Overview

Vibes Dashboard is a full-stack application with a Node.js/Express backend and a vanilla HTML/CSS/JS frontend. Communication between the two layers happens via REST HTTP endpoints and Socket.io WebSockets.

```
┌────────────────────────────────────────────────┐
│                   Browser                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  app.js  │  │ music.js │  │   voice.js   │  │
│  │ (agents) │  │ (player) │  │ (speech/TTS) │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│  ┌──────────┐  ┌──────────┐                     │
│  │background│  │settings.js│                    │
│  │(particles)│  │ (config) │                    │
│  └──────────┘  └──────────┘                     │
│         ↕ REST + Socket.io                      │
├────────────────────────────────────────────────┤
│              Node.js Server                      │
│  ┌────────────────┐  ┌──────────────────────┐   │
│  │  Express (REST) │  │  Socket.io (Events)  │   │
│  └────────────────┘  └──────────────────────┘   │
│  ┌──────────────────────────────────────────┐    │
│  │           VibesBridge                      │   │
│  │     (JSON-RPC over child process stdio)    │   │
│  └──────────────────────────────────────────┘    │
│              ↕ stdin/stdout (JSON-RPC)           │
├────────────────────────────────────────────────┤
│         Vibes MCP Server (child process)         │
│         (tsx src/mcp/server.ts)                  │
└────────────────────────────────────────────────┘
```

## Backend

### `server/index.js`

The main Express server that:
- Serves static frontend files from `public/`
- Provides REST API endpoints for agent queries and audio track listing
- Manages Socket.io connections for real-time agent state
- Maintains an in-memory `Map` of active agents
- Automatically enables HTTPS when `certs/cert.pem` and `certs/key.pem` exist

### `server/vibes-bridge.js`

The `VibesBridge` class manages spawning child processes running the Vibes MCP server (`tsx src/mcp/server.ts`). Communication uses JSON-RPC 2.0 over stdin/stdout. Key features:
- Spawns and tracks multiple agent instances
- Loads environment variables from the Vibes repo's `.env` file
- Overrides LLM preferences (host URL, model, API key) from browser settings
- Emits events for status updates, errors, and exit codes
- Implements request/response pattern with configurable timeouts

## Frontend

### `public/index.html`

Single-page application entry point with:
- Canvas background for particle simulation
- Sidebar navigation (Dashboard, Logs, Visualizer, Music, Settings)
- Dashboard grid for agent cards
- Music player panel with visualizer
- Creation modal (3-step: input → loading → review)
- Agent detail overlay with live logs
- Settings modal with 4 tabs (General, Voice, LLM Provider, Orchestration)
- Voice help modal and confirmation dialogs

### `public/js/app.js`

Core application logic handling:
- Agent CRUD operations via Socket.io events
- DOM rendering of agent cards in the dashboard grid
- Modal state management (creation flow, detail view)
- Stats counter updates (active, completed, tasks done)
- Toast notification system
- Theme toggling (dark/light mode)

### `public/js/background.js`

Canvas-based particle simulation:
- Renders organic particle field with subtle connections
- Reacts to audio energy from the music player
- Used as the live background behind all UI elements

### `public/js/music.js`

Audio player module:
- Track management (play, pause, next, previous, volume)
- Playlist rendering from `/api/audio`
- Frequency analysis using `AnalyserNode` for the visualizer
- Persists playback state and volume to `localStorage`
- Integrates with background canvas for reactive particle effects

### `public/js/voice.js`

Voice control system:
- Web Speech API `SpeechRecognition` for voice command capture
- Wake word ("Vibes") detection for hands-free activation
- Text-to-speech (TTS) feedback using `SpeechSynthesis`
- Voice help modal with available commands
- Settings integration for rate, volume, and voice selection

### `public/js/settings.js`

Settings panel manager:
- Tab switching (General, Voice, LLM Provider, Orchestration)
- Persists settings to `localStorage`
- LLM provider configuration (Ollama, LM Studio, OpenAI-compatible)
- Test connection button for LLM providers
- Theme, voice, wake word, and execution mode toggles

### `public/css/style.css`

Complete design system with:
- CSS custom properties for theming (dark + light mode)
- Glassmorphism components (`backdrop-filter: blur()`, semi-transparent backgrounds)
- Agent card, modal, sidebar, and music player styling
- Animations and transitions
- Toast notifications and confirmation dialogs
- Responsive scrollbar styling

## Data Flow

1. User opens the dashboard — browser connects via Socket.io
2. Server sends `agents-snapshot` with current agents
3. User clicks "+" to launch an agent — `agent-create` event sent
4. Server creates agent, runs planning phase, emits `agent-updated` with proposed tasks
5. User accepts tasks via `agent-accept`
6. Server begins execution (real Vibes or demo simulation)
7. Progress and logs streamed via `agent-updated` and `agent-log` events
8. Agent completes or can be terminated via `agent-terminate`
