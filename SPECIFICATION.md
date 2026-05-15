# 📐 Technical Specification: Glass Vibes Dashboard

## 1. System Overview
The Glass Vibes Dashboard is a high-fidelity web interface for orchestrating autonomous subagents. It acts as a bridge between the user and the **Vibes** TUI system, providing a visual management layer with premium aesthetics.

## 2. Technical Stack
- **Frontend**: 
    - Languages: HTML5, CSS3, JavaScript (ES6+).
    - Styling: Pure CSS with Glassmorphism (`backdrop-filter`).
    - Assets: Lucide Icons, Google Fonts (Inter, Outfit).
- **Backend**: 
    - Runtime: Node.js.
    - Framework: Express.
    - Communication: WebSockets (Socket.io) for real-time process streaming.
- **Orchestration**: 
    - Process Control: `child_process.spawn` to manage `vibes` CLI instances.
    - Interface: MCP (Model Context Protocol) compatible endpoints.

## 3. UI Architecture
### 3.1 Layout Shell
- **Left Sidebar**: 80px fixed-width glass panel for global navigation icons.
- **Top Header**: Horizontal glass bar for system statistics and audio controls.
- **Main Viewport**: Scrollable grid container for agent management.

### 3.2 Component Specs
- **Agent Cards**:
    - Dimensions: 320px x 400px (flexible).
    - Style: 16px radius, `rgba(20, 20, 25, 0.7)` background.
    - Progress Indicator: Custom CSS-animated progress bar with gradient fill.
- **Creation Modal**:
    - Centralized overlay with 24px blur.
    - Form fields for `CWD` (path) and `Mission` (text).
    - Multi-step state: `Input` -> `Generating Tasks` -> `Review` -> `Active`.

## 4. Visual & Audio Engine
- **Background**: Three.js/FreeJS canvas rendering organic particle simulations.
- **Audio**: HTML5 Audio API for background music.
- **Visualizer**: Canvas-based frequency domain analyzer using `AnalyserNode`.
- **Reactivity**: CSS variables updated dynamically based on audio energy levels.

## 5. Security & Data
- **State**: Persistent local registry (JSON) for tracking active processes.
- **Isolation**: Each subagent runs in its own shell environment.
- **Safety**: Process termination on dashboard close or manual 'X' click.

---

## 6. Voice Control System

### 6.1 Voice Command Button
- **Location**: `#header-bar .header-right`, before the theme toggle button.
- **Icon**: SVG microphone/speech bubble, 36x36px, rounded 8px.
- **States**: Idle (glass surface) → Listening (pulsing blue glow) → Processing (spinner) → No-mic (red tint, denied permission).
- **Audio ducking**: Music volume drops to 20% while mic is active, restores on end.

### 6.2 Speech Recognition
- **API**: Browser-native `webkitSpeechRecognition` / `SpeechRecognition`.
- **Mode**: Single utterance, 5s silence timeout.
- **Fallback**: Hidden entirely if API unavailable; toast notification if permission denied.

### 6.3 Command Parser (`voice.js`)
- **Module**: `CommandParser` class with `normalize()`, `classify()`, `extractParams()`, `execute()`.
- **Matching**: Keyword/pattern matching against an intent catalog (no LLM required).
- **Destructive commands**: Prompt confirmation dialog before executing.
- **Plugin support**: Extensible via `registerIntents(intentArray)` — plugins add their own commands at startup.

### 6.4 TTS Feedback
- **API**: Browser-native `SpeechSynthesisUtterance`.
- **Trigger**: Brief spoken confirmation on successful command execution.
- **Configurable**: Voice, rate, volume sourced from settings (`vibes-voice-prefs`).

---

## 7. AI Chat Overlay

### 7.1 Sidebar Access
- **Location**: Left sidebar, above the music player icon.
- **Icon**: Minimalist robot/chat SVG, same size as other `sidebar-btn` elements.
- **Badge**: Optional unread indicator dot.

### 7.2 Chat Panel Spec
- **Position**: Fixed right overlay, slides in from `translateX(100%)` over 300ms.
- **Dimensions**: 380px wide, full viewport height.
- **Surface**: `rgba(20, 20, 25, 0.85)`, `backdrop-filter: blur(16px)`, left border `1px solid rgba(255, 255, 255, 0.1)`.
- **Layout**: Header → scrollable message history → input bar (mic button + text field + send button).

### 7.3 Chat Backend
- **Endpoint**: `POST /api/chat` — accepts `{ message, history, provider }`.
- **Provider support**: Ollama (`/api/chat`), LM Studio (`/v1/chat/completions`), OpenAI-compatible (`/v1/chat/completions`).
- **Streaming**: Optional SSE streaming for token-by-token responses.
- **Graceful degradation**: Returns helpful error if provider not configured.

### 7.4 Chat-to-Command Bridge
- `/slash` commands in chat trigger dashboard actions (e.g., `/launch agent to ...`)
- LLM responses can contain `[ACTION: intent_name]` tags that the frontend executes

---

## 8. Settings Modal

### 8.1 Modal Spec
- **Trigger**: Click `#nav-settings` sidebar icon.
- **Dimensions**: 520px wide, centered glass modal.
- **Tabs**: General | Voice | LLM Provider.

### 8.2 Persistence
- **Storage**: Browser `localStorage` under `vibes-*-prefs` keys.
- **SettingsManager module**: Reactive getters, dispatches `settings-changed` DOM events.
- **Security warning**: API key stored in localStorage with banner advising server-side storage for production.

### 8.3 LLM Provider Configuration
- **Providers**: Ollama (model discovery via `GET /api/tags`), LM Studio, OpenAI-compatible (OpenRouter, Anthropic, etc.), Disabled.
- **Connection test**: Ping endpoint and show success/failure before saving.

---

## 9. Wake-Word Detection (Phase 4)
- **Wake word**: "Vibes"
- **Mode**: Continuous `SpeechRecognition` with `interimResults: true`.
- **Lifecycle**: Listening for wake word → chime on detect → capture utterance → return to listening.
- **Auto-sleep**: Disable after 5 minutes tab backgrounded (`visibilitychange`).
- **Privacy**: Persistent "Mic active" indicator in header; all recognition is local.

---

## 10. Accessibility
- **Keyboard**: Tab/Enter/Escape navigation for chat overlay and settings modal.
- **ARIA**: `role="dialog"`, `role="tablist"`, `aria-label` on all interactive elements.
- **Focus trap**: Modal traps focus while open; returns to trigger on close.
- **Reduced motion**: Respect `prefers-reduced-motion` media query.
- **Screen readers**: Toast notifications use `aria-live="polite"` regions.
