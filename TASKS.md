# ✅ Task List: Vibes Dashboard Implementation

## Phase 1: Foundation & Base UI
- [x] **T1.1**: Initialize Node.js project and install dependencies (Express, Socket.io).
- [x] **T1.2**: Create `index.html` with basic shell (Sidebar, Header, Grid Container).
- [x] **T1.3**: Implement base `style.css` with CSS variables from `DESIGN.md`.
- [x] **T1.4**: Port glassmorphism utility classes and layout positioning.
- [x] **T1.5**: Implement the Sidebar icons and hover states.

## Phase 2: Card Grid & Modals
- [x] **T2.1**: Build the "Add New Agent" placeholder card with dashed border animations.
- [x] **T2.2**: Create the Glass Modal system (show/hide, backdrop-blur).
- [x] **T2.3**: Implement the Creation Form (CWD, Mission inputs).
- [x] **T2.4**: Build the reusable "Agent Card" component (Progress bar, 'X' button).

## Phase 3: Backend & Process Bridge
- [x] **T3.1**: Create Backend service to spawn `vibes` as a child process.
- [x] **T3.2**: Implement log capturing and parsing for mission progress.
- [x] **T3.3**: Setup WebSocket event handlers for `agent-update`, `agent-start`, `agent-stop`.
- [x] **T3.4**: Implement mission planning review phase (intercepting task list).

## Phase 4: Visuals & Audio
- [x] **T4.1**: Integrate background music player with track switching.
- [x] **T4.2**: Implement FreeJS/Three.js animated background.
- [x] **T4.3**: Build the reactive canvas visualizer (AudioContext + AnalyserNode).
- [x] **T4.4**: Connect visualizer energy levels to CSS variable updates for "pulsing" effects.

## Phase 5: Details & Polish
- [x] **T5.1**: Implement "Full Page" expansion for agent cards (Detailed logs view).
- [x] **T5.2**: Add sound effects for UI interactions (Clicks, Modal open/close).
- [x] **T5.3**: Final animation audit (Spring transitions, stagger effects).
- [x] **T5.4**: Verification against `REQUIREMENTS.md`.

## Recurring
- [x] **TR-1**: Generate Voice Logs for every milestone.

---

## Phase 6: Voice Command Button

- [ ] **T6.1**: Add microphone speech button SVG to `index.html` header bar
- [ ] **T6.2**: Implement speech button CSS with idle/listening/processing/no-mic states
- [ ] **T6.3**: Create `voice.js` — `CommandParser` class with `normalize()`, `classify()`, `extractParams()`, `execute()`
- [ ] **T6.4**: Implement Web Speech API glue — start/stop recognition, transcript capture
- [ ] **T6.5**: Build initial intent catalog: launch agent, navigate, music, theme toggle
- [ ] **T6.6**: Implement audio ducking — lower music volume to 20% while mic active
- [ ] **T6.7**: Build destructive action confirmation dialog (glass-style, Confirm/Cancel)
- [ ] **T6.8**: Wire microphone permission-denied state with tooltip
- [ ] **T6.9**: Implement TTS feedback via `SpeechSynthesisUtterance` — voice, rate, volume from settings
- [ ] **T6.10**: Build glass-style toast notification system for command feedback
- [ ] **T6.11**: Verify against VR-1 through VR-13

## Phase 7: Settings Modal Overhaul

- [ ] **T7.1**: Build settings modal HTML with tabbed layout (General / Voice / LLM Provider)
- [ ] **T7.2**: Implement tab switching CSS/JS with active underline indicator
- [ ] **T7.3**: Create `settings.js` — `SettingsManager` module with localStorage persistence
- [ ] **T7.4**: General tab — Voice Feedback toggle, Auto-launch toggle, Theme selector
- [ ] **T7.5**: Voice/TTS tab — voice dropdown (populated from `getVoices()`), rate slider, volume slider, test button
- [ ] **T7.6**: LLM Provider tab — provider selector (Ollama/LM Studio/OpenAI Compatible/Disabled)
- [ ] **T7.7**: LLM Provider tab — dynamic fields per provider (host URL, model, API key, max tokens)
- [ ] **T7.8**: Implement Test Connection button — ping Ollama `/api/tags`, LM Studio / OpenAI `/v1/chat/completions`
- [ ] **T7.9**: Ollama model discovery — auto-populate model dropdown from `/api/tags` on successful test
- [ ] **T7.10**: API key field — masked input with show/hide toggle + security warning banner
- [ ] **T7.11**: Dispatch `settings-changed` DOM events for reactive updates
- [ ] **T7.12**: Verify against SR-1 through SR-9

## Phase 8: AI Chat Overlay

- [ ] **T8.1**: Add robot/chat SVG icon to sidebar, above music player
- [ ] **T8.2**: Build chat overlay HTML — slide-in right panel with header, message area, input bar
- [ ] **T8.3**: Implement chat overlay CSS — glass surface, slide animation, message bubbles
- [ ] **T8.4**: Create `chat-overlay.js` — open/close, message rendering, scroll-to-bottom
- [ ] **T8.5**: Wire mic button in chat input to Web Speech API for voice-to-text
- [ ] **T8.6**: Create `POST /api/chat` backend endpoint reading provider config from settings
- [ ] **T8.7**: Create `chat-bridge.js` — LLM client supporting Ollama/LM Studio/OpenAI-compatible
- [ ] **T8.8**: Implement typing indicator while awaiting LLM response
- [ ] **T8.9**: Wire /slash commands in chat to trigger dashboard actions
- [ ] **T8.10**: Wire `[ACTION:]` tag parsing from LLM responses
- [ ] **T8.11**: Verify against CR-1 through CR-9

## Phase 9: Accessibility & Polish

- [ ] **T9.1**: Add ARIA labels to speech button, chat overlay, settings tabs
- [ ] **T9.2**: Implement focus trap in settings modal (Tab/Shift+Tab cycle, Escape closes)
- [ ] **T9.3**: Implement keyboard navigation in chat overlay (Tab messages, Enter send, Escape close)
- [ ] **T9.4**: Add `aria-live="polite"` to toast notification container
- [ ] **T9.5**: Respect `prefers-reduced-motion` — disable slide/fade animations
- [ ] **T9.6**: Focus management — return to trigger element on overlay/modal close
- [ ] **T9.7**: Verify against AR-1 through AR-5

## Phase 10: System Discovery (Future)

- [ ] **T10.1**: Create `GET /api/discover` endpoint querying launcher registry MCP
- [ ] **T10.2**: Implement plugin registration format and command merging
- [ ] **T10.3**: Add dynamic sidebar icon generation from discovered projects

## Phase 11: Wake-Word Detection (Future)

- [ ] **T11.1**: Add Wake Word toggle to Settings General tab
- [ ] **T11.2**: Implement continuous `SpeechRecognition` with interim results
- [ ] **T11.3**: Build wake-word indicator in header bar (pulsing "Vibes" state)
- [ ] **T11.4**: Implement wake-word detection → capture utterance → command execution loop
- [ ] **T11.5**: Add auto-sleep on tab backgrounding via `visibilitychange`
- [ ] **T11.6**: Verify against WR-1 through WR-5
