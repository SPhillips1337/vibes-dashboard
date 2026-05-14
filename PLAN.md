# 🌌 Plan: Glass Vibes Dashboard

## 🎯 Overview
The **Glass Vibes Dashboard** will be a premium, glassmorphic orchestration interface for managing **Vibes** subagents. It will blend the visual excellence of SimCity's UI, the reactive aesthetics of TranceAngel, and the autonomous power of the Vibes agentic loop.

---

## 🏗️ Technical Architecture

### 1. Frontend (Vanilla Premium)
- **Base**: HTML5, CSS3 (Vanilla), JS (ES6+).
- **UI Framework**: No heavy frameworks (React/Vue/etc.) unless strictly necessary. We will use a component-based approach with Vanilla JS.
- **Design System**: Glassmorphism (from SimCity) with `backdrop-filter`, `rgba` colors, and subtle borders.
- **Icons**: Lucide/FontAwesome (CDN).
- **Typography**: Inter / Outfit (Google Fonts).

### 2. Backend (The Orchestrator)
- **Tech**: Node.js / Express.
- **Vibes Bridge**: A specialized service to spawn `vibes` processes, capture their TUI output/state, and expose it via a REST API or WebSockets.
- **MCP Integration**: An internal MCP server (or bridge) that allows the dashboard to "spin up" and "terminate" Vibes subagents using standardized tools.

---

## 🎨 UI/UX Design Components

### 🛰️ Sidebar (Control Strip)
- Adapted from the SimCity toolbar.
- Vertical layout on the left.
- Icons for: **Dashboard**, **Logs**, **Settings**, **Visualizer**, **Audio**.

### 📊 Header (Stats Bar)
- Glass panel at the top.
- Real-time stats: `Total Agents Active`, `Success Rate`, `Uptime`, `Memory Usage`.

### 🃏 The Card Grid (Mission Control)
- **Agent Cards**:
    - High-level mission summary.
    - Real-time progress bar (animated).
    - Status badge (Planning, Executing, Paused, Success).
    - **Close Button**: A subtle '×' in the top-right to terminate and remove the agent.
- **Expansion**: Clicking a card expands it into a full-page view (simulating SimCity's "About Us" / "Help" modals) showing detailed logs and task lists.

### ➕ Add Agent Placeholder
- Positioned at the top of the grid.
- Dashed border with a large `+` symbol.
- **Interaction**: On hover, the border and plus symbol transition to pure white.
- **Click**: Opens the **Creation Modal**.

### 🪄 Creation & Planning Flow (Modal)
1. **Input Screen**: Specify `Working Directory` and `Mission Description`.
2. **Loading Phase**: Glass spinner while Vibes initializes and generates a task list.
3. **Review Phase**: Displays the proposed tasks with **Accept** and **Decline** (Glassmorphism buttons).
4. **Activation**: On accept, the modal closes and a new live card is added to the grid.

---

## 🎭 Visuals & Audio

### 🌊 Animated Background (FreeJS)
- A dynamic, organic background (possibly particles or fluid simulation) that lives behind the glass panels.
- Changes "intensity" or "color" based on user actions (clicking icons, starting missions).

### 🔊 Music Player & Reactive Visuals
- Persistent SimCity-style music player.
- **Reactive Visualizer**: A canvas-based visualizer (from TranceAngel) that reacts to the MP3 frequencies.
- **Action Reactivity**: UI elements (borders, shadows) pulse slightly in time with the music or react to input events (color shifts).

---

## 📅 Implementation Roadmap

### Phase 1: Foundation & Design Port (Day 1)
- [ ] Initialize repository structure.
- [ ] Port SimCity CSS tokens and baseline HTML layout.
- [ ] Implement the left-hand Sidebar and Top Bar.
- [ ] Setup the Card Grid with dummy data.

### Phase 2: Agent Orchestration (Day 2)
- [ ] Build the Node.js backend to wrap `vibes`.
- [ ] Create the state management system for active subagents.
- [ ] Implement the **Creation Modal** and its multi-step flow.

### Phase 3: Expansion & Real-time Logs (Day 3)
- [ ] Implement the "Expanded Card" view for detailed logs.
- [ ] Connect the frontend to the backend via WebSockets for live progress updates.
- [ ] Implement the "Close" functionality to kill subagents.

### Phase 4: Aesthetics & Audio (Day 4)
- [ ] Integrate the Music Player.
- [ ] Implement the FreeJS background effects.
- [ ] Add the reactive visualizer and color-shift effects based on user input.

### Phase 5: Polish & Vibe Check (Day 5)
- [ ] Audit animations (transitions, hover effects).
- [ ] Ensure full SEO/Accessibility best practices.
- [ ] Final bug squashing and performance optimization.

---

*Maximize Momentum. Minimize Gravity. Let the Vibes Flow.*
