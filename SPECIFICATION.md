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
