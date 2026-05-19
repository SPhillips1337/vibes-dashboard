# Logs & Visualizer MVP Implementation Plan

## 1. Routing & View State Management
To support multiple main views, we need to implement basic tab routing in `app.js`.
- **HTML Updates**: Wrap the current `#dashboard-grid` inside a `#view-dashboard` container. Add `#view-logs` and `#view-visualizer` containers (hidden by default).
- **JS Updates**: When a sidebar navigation button (`#nav-dashboard`, `#nav-logs`, `#nav-visualizer`) is clicked, toggle the `hidden` class on the respective view containers.

## 2. Logs View MVP
The Logs View will serve as a centralized, global feed of all system and agent activities.

**Features:**
- **Aggregated Stream**: Combine logs from all active agents into a single, scrollable terminal-like glass panel.
- **System Events**: Intercept global events (Agent created, accepted, terminated, Socket connections) and display them as system-level logs.
- **UI Design**: A full-width, glassmorphic terminal window. Each log line will have a timestamp, an origin badge (e.g., `[System]`, `[Agent: MyMission]`), and the message. Color-code the badges based on the agent's status.

**Tasks:**
- [ ] Add `#view-logs` structure to `index.html`.
- [ ] Add a `globalLogs` array to state in `app.js`.
- [ ] Update `socket.on('agent-log')` and system events to push to `globalLogs` and render to the Logs View.
- [ ] Implement auto-scrolling and a "Clear Logs" button.

## 3. Visualizer View MVP
The Visualizer View will provide an immersive, full-screen audio visualization experience tied to the existing Music Player.

**Features:**
- **Main Canvas**: A large `<canvas id="main-visualizer">` that takes up the entire main content area.
- **Premium Aesthetics**: Instead of simple bars, use a circular frequency visualizer or mirrored, glowing frequency bands that leverage the `AnalyserNode` data from `music.js`. Apply strong glassmorphic glows and dynamic colors based on the current theme or audio energy.
- **Integration**: Hook into the existing `renderFrame()` loop in `music.js` to draw to the `main-visualizer` canvas when the view is active.

**Tasks:**
- [ ] Add `#view-visualizer` container and `<canvas>` to `index.html`.
- [ ] Update `music.js` to accept and draw to `main-visualizer`.
- [ ] Implement a premium circular or glowing bar visualization algorithm.
- [ ] Ensure the canvas resizes correctly with the window.

## 4. Final Polish
- Add subtle CSS transitions when switching between views.
- Ensure the Voice Command overlay and Music Player panel play nicely with the new views.
- Create a Voice Log to announce the completion of these features once implemented.
