# API Reference

All API requests are prefixed with `/api`. Rate limiting is implemented for authentication endpoints, and standard routes are protected by session-based authentication guards and CSRF token validation.

---

## 🔐 Authentication & Session Endpoints

### `POST /api/auth/login`
Authenticates user credentials and establishes a secure HTTPS session cookie.
* **Payload**:
  ```json
  { "username": "operator", "password": "securepassword" }
  ```
* **Response**: `200 OK`
  ```json
  { "success": true, "user": { "username": "operator", "role": "operator" } }
  ```

### `POST /api/auth/logout`
Destroys the active operator session and clears cookie credentials.
* **Response**: `200 OK`
  ```json
  { "success": true }
  ```

### `GET /api/auth/status`
Checks the current session validation state.
* **Response**: `200 OK`
  ```json
  { "authenticated": true, "user": { "username": "operator", "role": "operator" } }
  ```

### `GET /api/auth/csrf`
Retrieves a valid CSRF token mapped to the session for header verification on state-changing requests.
* **Response**: `200 OK`
  ```json
  { "csrfToken": "12afbc...3e" }
  ```

---

## 🤖 Vibes Agents & Process Bridge

### `GET /api/agents`
Returns a list of all active, planning, and completed Vibes agents.
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "agent-1712345678901-a1b2c3",
      "mission": "Refactor authentication module",
      "cwd": "~/projects/my-app",
      "status": "executing",
      "progress": 45,
      "totalTasks": 8,
      "completedTasks": 4,
      "tasks": [
        { "id": 1, "name": "Analyze project structure", "status": "complete" },
        { "id": 2, "name": "Create implementation plan", "status": "in-progress" }
      ],
      "createdAt": "2025-04-05T12:00:00.000Z",
      "useVibes": true
    }
  ]
  ```

### `GET /api/agents/:id/status`
Queries the live execution status of a specific running agent process via the bridge.
* **Response**: `200 OK`
  ```json
  {
    "status": "Agent running, 4/8 tasks complete"
  }
  ```

---

## 🎵 Music Player & Jamendo Discovery

### `GET /api/audio`
Returns all local MP3 audio tracks found in the `public/audio/` playlist folder merged with virtual/saved streaming tracks.
* **Response**: `200 OK`
  ```json
  [
    {
      "name": "Midnight Protocol",
      "artist": "Antigravity Synthesis",
      "url": "/audio/midnight-protocol-1.mp3"
    }
  ]
  ```

### `GET /api/music/search`
Queries the Jamendo API for royalty-free tracks matching the keyword parameter.
* **Query Parameters**: `q` (search query term)
* **Response**: `200 OK`
  ```json
  {
    "hits": [
      {
        "id": 14408544,
        "tags": "Synthwave Escape",
        "user": "Neon Vector",
        "duration": 180,
        "audio": "https://prod-1.tunes.jamendo.com/..."
      }
    ]
  }
  ```

### `POST /api/music/download`
Saves Jamendo track streaming metadata (artist, URL, name) into the virtual saved playlist database (`/data/music/saved_playlist.json`) to stream it directly from the CDN without downloading copyright MP3 assets locally.
* **Payload**:
  ```json
  {
    "url": "https://prod-1.tunes.jamendo.com/...",
    "id": 14408544,
    "tags": "Synthwave Escape",
    "artist": "Neon Vector"
  }
  ```
* **Response**: `200 OK`
  ```json
  {
    "success": true
  }
  ```

### `GET /api/music/download-all`
Compiles all local tracks in `public/audio/` and initiates a zip archive file download.
* **Response**: `200 OK (application/zip binary)`

---

## 🎨 Theme Customization

### `GET /api/themes`
Scans `public/themes/*/theme.css` for modular glassmorphic design configurations.
* **Response**: `200 OK`
  ```json
  [
    {
      "id": "cyberpunk",
      "name": "Cyberpunk Neon",
      "path": "themes/cyberpunk/theme.css"
    }
  ]
  ```

---

## 🔗 LLM Gateway Proxies (CORS-Bypass)

### `POST /api/llm/proxy/models`
Proxies request to discover and list models on OpenAI-compatible LLM endpoints.
* **Payload**:
  ```json
  { "host": "http://localhost:1234/v1", "key": "optional-key" }
  ```
* **Response**: `200 OK` (original gateway JSON models array)

### `POST /api/llm/proxy/ollama-tags`
Proxies local request to fetch tags from Ollama API providers.
* **Payload**:
  ```json
  { "host": "http://localhost:11434" }
  ```
* **Response**: `200 OK` (original Ollama tags list)

---

## 📊 LinkedIn Content Workbench & RSS Job

### `GET /api/linkedin/overview`
Retrieves content metrics, scheduled items, pending reviews, and latest updates from calendar.
* **Response**: `200 OK`
  ```json
  {
    "sourcePath": "/data/linkedin/content_calendar.json",
    "totalPosts": 24,
    "pendingReviewCount": 2,
    "statusCounts": { "published": 15, "pending_review": 2, "scheduled": 7 },
    "latestCreatedAt": "2026-06-11T12:00:00.000Z",
    "nextScheduled": { "id": "p123", "topic": "AI Agents", "scheduled_time": "2026-06-15" },
    "recentPosts": [...],
    "pendingReviewPosts": [...]
  }
  ```

### `POST /api/linkedin/posts/:id`
Updates calendar details (topic, content, status, schedules) for a specific post.
* **Payload**:
  ```json
  {
    "status": "scheduled",
    "topic": "Future of Coding",
    "content": "AI pair programming holds massive potential...",
    "scheduled_time": "2026-06-18T10:00:00Z"
  }
  ```
* **Response**: `200 OK`
  ```json
  { "success": true, "post": { "id": "p123", "status": "scheduled", ... } }
  ```

### `GET /api/linkedin/rss-status`
Checks the logs and processes active on local Python RSS automation scripts.
* **Response**: `200 OK`

### `POST /api/linkedin/rss-trigger`
Triggers the background python pipeline to parse RSS feeds and queue drafts.
* **Payload**:
  ```json
  { "count": 5 }
  ```
* **Response**: `200 OK`
  ```json
  { "success": true, "jobId": "rss_5f3a...b2", "logPath": "/logs/rss_job_rss_...log", "count": 5 }
  ```

---

## ⚙️ Settings, Layout, and Workspace Helpers

### `GET /api/settings`
Loads settings from the project root `settings.json`.
* **Response**: `200 OK` (JSON config dictionary)

### `POST /api/settings`
Saves or merges parameters into `settings.json`.
* **Response**: `200 OK`
  ```json
  { "success": true }
  ```

### `POST /api/users/module-order`
Saves user-specific preferences for active sidebar layout ordering.
* **Payload**:
  ```json
  { "moduleOrder": ["orchestrator", "music", "terminal", "web-browser"] }
  ```
* **Response**: `200 OK`
  ```json
  { "success": true }
  ```

### `GET /api/fs/suggestions`
Provides autocomplete directory listings based on partial input path parameters.
* **Query Parameters**: `path` (absolute or relative search prefix)
* **Response**: `200 OK`
  ```json
  [ "/home/stephen/projects/", "/home/stephen/documents/" ]
  ```

### `GET /api/modules`
Discovers and returns manifests for modules under `/modules/*/manifest.json`.
* **Response**: `200 OK` (list of manifests including HTML templates)

### `GET /api/proxy`
Sandboxed reverse-proxy used by the iframe Web Browser module to load external web pages.
* **Query Parameters**: `url`, `csrf` (session CSRF token validation)
* **Response**: `200 OK (proxied document content)`

---

## 🔌 Socket.io Events Reference

### Client → Server Events
* `agent-create` `{ mission: string, cwd: string, llmPrefs?: object }` — Spawns new Vibes instance.
* `agent-accept` `{ id: string }` — User confirms proposed tasks and triggers code runs.
* `agent-decline` `{ id: string }` — Reject proposed task list and remove agent.
* `agent-terminate` `{ id: string }` — Force quit running vibes agent process.
* `agent-logs` `{ id: string }` — Query full log text history.

### Server → Client Events
* `agents-snapshot` `Array<Agent>` — Sends list of all active or cached agents on handshake.
* `agent-created` `{ id: string, ...Agent }` — Notifies client that planning has begun.
* `agent-updated` `{ id: string, ...fields }` — Streams task progression, status updates, or failures.
* `agent-removed` `{ id: string }` — Confirms process cleanup.
* `agent-log` `{ id: string, log: string }` — Broadcasts individual stdout lines.
