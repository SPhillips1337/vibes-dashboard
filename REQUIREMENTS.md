# 📋 Project Requirements: Vibes Dashboard

## 1. Functional Requirements

### 1.1 Agent Management
- **FR-1**: User MUST be able to launch a new Vibes subagent by specifying a working directory and a mission description.
- **FR-2**: User MUST be able to review a proposed task list from the agent before execution begins.
- **FR-3**: User MUST be able to view real-time progress (milestones/tasks) for each active agent.
- **FR-4**: User MUST be able to terminate an active agent and remove its card from the dashboard.
- **FR-5**: User MUST be able to expand an agent card to see detailed execution logs.

### 1.2 Dashboard Features
- **FR-6**: Dashboard MUST show aggregate statistics (Total Active Agents, Tasks Completed).
- **FR-7**: Dashboard MUST include a persistent music player with track selection.
- **FR-8**: Dashboard MUST feature an "Add New Agent" placeholder with hover transitions.

### 1.3 Aesthetics & Interaction
- **FR-9**: UI MUST implement high-quality glassmorphism effects across all panels.
- **FR-10**: UI MUST feature an animated background that reacts to audio and user input.
- **FR-11**: UI MUST include a frequency-reactive visualizer.

## 2. Non-Functional Requirements

### 2.1 Performance
- **NFR-1**: Dashboard SHOULD maintain 60fps for background animations and transitions.
- **NFR-2**: Subagent status updates SHOULD have less than 500ms latency from the backend.

### 2.2 User Experience
- **NFR-3**: Interface MUST feel premium and high-fidelity (Dark mode, glass effects).
- **NFR-4**: Responsive design for standard desktop resolutions (1920x1080+).

### 2.3 Compliance
- **NFR-5**: ALL significant tasks MUST trigger a voice log entry in the centralized reports directory.
- **NFR-6**: Project MUST follow the `DESIGN.md` tokens and guardrails.

---

## 3. Voice Control Requirements

### 3.1 Speech Recognition
- **VR-1**: Dashboard MUST provide a speech button in the top header bar for voice command input.
- **VR-2**: System MUST use browser-native Web Speech API (`SpeechRecognition`) for all voice capture.
- **VR-3**: Microphone button MUST show distinct visual states for idle, listening, processing, and permission-denied.
- **VR-4**: Music volume MUST auto-duck to 20% while the microphone is active and restore on completion.
- **VR-5**: System MUST gracefully handle missing `SpeechRecognition` API by hiding the button.
- **VR-6**: System MUST handle microphone permission denial with a persistent error state and tooltip.

### 3.2 Command Parsing
- **VR-7**: System MUST recognise at minimum: launch agent, navigate dashboard/logs/visualizer/settings, play/pause/skip music, toggle theme.
- **VR-8**: Unrecognised commands MUST show a helpful toast with suggested commands.
- **VR-9**: Destructive commands (terminate, delete, stop all) MUST show a glass-style confirmation dialog before executing.
- **VR-10**: Command parser MUST be extensible — plugins can register new intents via `registerIntents()`.

### 3.3 TTS Feedback
- **VR-11**: System MUST speak a brief confirmation on recognised commands using Web Speech API.
- **VR-12**: TTS voice, rate, and volume MUST be configurable via settings.
- **VR-13**: TTS feedback MUST be toggleable on/off in settings.

---

## 4. AI Chat Requirements

### 4.1 Chat Overlay
- **CR-1**: Dashboard MUST provide a sidebar icon (robot/chat) that opens a chat overlay panel.
- **CR-2**: Chat overlay MUST slide in from the right edge of the viewport with glassmorphism styling.
- **CR-3**: Chat MUST support text input with send button and voice input via microphone button.
- **CR-4**: Chat MUST display message history with user messages right-aligned and AI responses left-aligned.
- **CR-5**: Chat MUST show a typing indicator while awaiting LLM response.

### 4.2 LLM Backend
- **CR-6**: System MUST support Ollama, LM Studio, and OpenAI-compatible endpoints as LLM providers.
- **CR-7**: System MUST gracefully report when no LLM provider is configured.
- **CR-8**: `/slash` commands typed in chat MUST execute corresponding dashboard actions.
- **CR-9**: LLM responses MAY contain `[ACTION:]` tags for the frontend to execute.

---

## 5. Settings Requirements

### 5.1 Settings Modal
- **SR-1**: Settings icon MUST open a tabbed modal with at least: General, Voice/TTS, LLM Provider tabs.
- **SR-2**: General tab MUST include toggles for Voice Feedback and Auto-launch on command.
- **SR-3**: Voice/TTS tab MUST include voice selector, rate slider, volume slider, and test button.
- **SR-4**: LLM Provider tab MUST support selecting provider (Ollama/LM Studio/OpenAI Compatible/Disabled) and entering host URL, model name, API key, and max tokens.
- **SR-5**: LLM Provider tab MUST include a Test Connection button that validates the endpoint.
- **SR-6**: Ollama Test Connection MUST auto-discover installed models via `GET /api/tags` and populate a dropdown.

### 5.2 Persistence
- **SR-7**: All settings MUST persist across page refreshes via `localStorage`.
- **SR-8**: Settings changes MUST be reactive — other modules update immediately via `settings-changed` DOM events.
- **SR-9**: API keys stored in localStorage MUST display a security warning banner.

---

## 6. Wake-Word Requirements (Phase 4)

### 6.1 Continuous Listening
- **WR-1**: System MUST support enabling "wake word" mode via Settings toggle.
- **WR-2**: Wake word MUST be "Vibes".
- **WR-3**: When enabled, dashboard MUST show a persistent listening indicator in the header.
- **WR-4**: Wake word mode MUST auto-disable after 5 minutes of tab being backgrounded.
- **WR-5**: Wake word detection MUST be purely client-side — no audio leaves the browser.

---

## 7. Accessibility Requirements

### 7.1 Keyboard & Screen Reader
- **AR-1**: Chat overlay MUST support Tab/Enter/Escape keyboard navigation.
- **AR-2**: Settings modal MUST trap focus while open.
- **AR-3**: All voice/chat interactive elements MUST have ARIA labels.
- **AR-4**: Toast notifications MUST use `aria-live="polite"` regions.
- **AR-5**: System MUST respect `prefers-reduced-motion` for all animations.
