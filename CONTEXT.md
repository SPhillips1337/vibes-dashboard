# CONTEXT.md — Vibes Dashboard Operating Manual

> **Read this before making changes.** This is the source of truth for stack assumptions, non-negotiable rules, architecture decisions, and workflow protocols.

---

## Stack & Runtime

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 18+ | No transpilation — raw ESM/CJS |
| Server | Express 4.x + HTTPS | Self-signed certs via `generate_cert.sh` |
| Realtime | Socket.io 4.x | Agent log streaming and status events |
| Frontend | Vanilla HTML/CSS/JS | No React, no Vue, no Tailwind |
| 3D/VFX | Three.js (CDN) | Background WebGL engine in `public/js/background.js` |
| Audio | Web Audio API | AnalyserNode for visualizer; SpeechRecognition for voice |
| Music API | Jamendo API v3 | `client_id=709fa152` (dev key) — royalty-free only |
| Auth | scrypt + `__Host-` cookies | CSRF tokens required on all mutating requests |
| OS | Ubuntu Linux | Tested on Chrome; SpeechRecognition requires Chrome or Edge |

---

## Non-Negotiable Rules

### Design
- All panels, cards, and modals **must** use the glass effect: `background: rgba(20, 20, 25, 0.7)`, `backdrop-filter: blur(12px)`, `border: 1px solid rgba(255, 255, 255, 0.1)`
- **No opaque backgrounds** (`#fff`, `#000`) on any UI panel
- **No Tailwind** — use CSS custom properties defined in `public/css/style.css`
- **No serif/default fonts** — use `Inter` or `Outfit` from Google Fonts only
- All elements must have a border radius; no sharp corners
- Transitions use `cubic-bezier(0.4, 0, 0.2, 1)`

### Security
- All state-changing API endpoints require a valid `X-CSRF-Token` header
- Sessions use `__Host-` prefixed cookies: `httpOnly`, `secure`, `sameSite: Strict`
- Do **not** trust `req.body` for user identity — always read from `req.session`
- SSRF: the browser proxy blocks private/loopback ranges by default

### Music
- **Never** stream or download copyright tracks — iTunes/Apple CDN URLs are banned
- Jamendo `saved_playlist.json` stores metadata only (name, artist, CDN stream URL)
- `public/audio/` holds local MP3s only (royalty-free, manually curated)

### Modules
- Each module lives in `modules/<name>/` with `manifest.json`, `view.html`, `style.css`, `script.js`
- Modules are sandboxed — no direct access to shell globals; use `window.Dashboard.*` APIs
- Adding a module requires no server changes — auto-discovered on startup

---

## Workflow Protocols

### Making Changes
1. Identify the relevant module or server route
2. Make the smallest change that satisfies the requirement
3. If the change affects an API endpoint, update `docs/API.md` in the same commit
4. If the change resolves an architecture question, add or update an ADR in `docs/adr/`

### Music Discovery
- Search: `GET /api/music/search?q=<term>` → Jamendo API → mapped hits
- Save: `POST /api/music/download` → writes metadata to `data/music/saved_playlist.json`
- Play: `GET /api/audio` → merges local `public/audio/*.mp3` + saved playlist
- Do not persist Apple CDN URLs — purge them if found in `saved_playlist.json`

### Agent Execution
- Real mode: `server/vibes-bridge.js` spawns `tsx src/mcp/server.ts` as a child process
- Demo mode: simulated task lists and randomized progress
- Mode is auto-detected; override with `USE_VIBES=true|false`

---

## Resolved Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | Vanilla JS | Avoid build toolchain; fast iteration, no hydration overhead |
| Module system | Manifest-driven file convention | Drop-in extensibility without registry config |
| Music source | Jamendo API (royalty-free) | iTunes is copyright-encumbered; Pixabay has no audio API |
| Playlist persistence | JSON file (`saved_playlist.json`) | No DB dependency; simple for single-user local dashboard |
| Auth mechanism | scrypt + session cookies | No JWT complexity; server-side sessions fit local-use model |
| Background engine | Three.js | Already a dependency; richer than raw Canvas for 3D modes |
| Voice recognition | Web Speech API (Chrome/Edge) | No server-side dependency; adequate for local use |
| Durable harness runs | Append-only versioned JSONL + atomic JSON snapshots | Auditable restart recovery without a database; verifier events exclusively grant completion |
| Harness verification policy | Server-owned allowlisted argv recipes + fail-closed real-run default | Agents may request recipe IDs but cannot select commands, policy paths, cwd, or limits |
| Harness child/checkpoint retention | Shallow depth-4 lineage, metadata-only checkpoints, dry-run retention | Prevent recursive explosion, forged lineage, unsafe rollback, and implicit deletion |

See `docs/adr/` for full ADR files.

---

## What Not To Do

- ❌ Do not add a frontend build step (webpack, vite, etc.) without an ADR
- ❌ Do not use `innerHTML` with unescaped user input — always use `escapeHtml()` or `textContent`
- ❌ Do not store API keys in source code — use `localStorage` (client) or env vars (server)
- ❌ Do not add npm dependencies without checking bundle impact — keep it lean
- ❌ Do not modify the glassmorphic shell layout (`public/index.html` structure) without updating `DESIGN.md`
- ❌ Do not save Apple CDN URLs to `saved_playlist.json`
- ❌ Do not bypass CSRF checks — all `POST`/`PUT`/`DELETE` routes must validate `X-CSRF-Token`
- ❌ Do not use Tailwind classes

---

## Project-Specific Guidance

### CSS Custom Properties
All tokens are in `public/css/style.css` under `:root`. Reference them by variable name — never hardcode hex values in component stylesheets.

### Module Script Isolation
Each module's `script.js` is injected into the page but must follow the IIFE pattern (`(function() { 'use strict'; ... })()`). Expose only what is needed via `window.<ModuleId>`.

### CSRF Flow
Fetch the token once after login: `GET /api/auth/csrf` → store in `window.Dashboard.csrfToken`. Pass it as `X-CSRF-Token` header on all mutating requests.

### Socket.io Events
- `agent-updated` — full agent object snapshot
- `agent-log` — `{ id, log }` — single log line
- `agent-error` — `{ id, error }`
- `agent-exit` — `{ id, code }`

### Three.js Background Modes
Defined in `public/js/background.js`. Current modes: `Nebula Flow`, `Cyber Stream`, `Aurora Waves`, `Ember Storm`, `Electrical Storm`, `Kinetic Clockwork`, `Gargantua Singularity`. Mode is set via `window.bgEffect.setMode(name)`.

---

*Last updated: 2026-06-12*
