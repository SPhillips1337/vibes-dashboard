# API Reference

## REST Endpoints

All REST endpoints are prefixed with `/api`.

### `GET /api/agents`

Returns a list of all active agents.

**Response**: `200 OK`
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

Queries the status of a specific agent via the Vibes bridge.

**Response**: `200 OK`
```json
{
  "status": "Agent running, 4/8 tasks complete"
}
```

### `GET /api/audio`

Lists available audio tracks from `public/audio/`.

**Response**: `200 OK`
```json
[
  {
    "name": "Midnight Protocol",
    "artist": "Antigravity Synthesis",
    "url": "/audio/midnight-protocol-1.mp3"
  }
]
```

## WebSocket Events (Socket.io)

The server uses Socket.io for real-time bidirectional communication.

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `agent-create` | `{ mission: string, cwd: string, llmPrefs?: object }` | Create a new agent |
| `agent-accept` | `{ id: string }` | Accept proposed tasks and begin execution |
| `agent-decline` | `{ id: string }` | Decline proposed tasks and remove agent |
| `agent-terminate` | `{ id: string }` | Terminate a running agent |
| `agent-logs` | `{ id: string }` | Request the full log history for an agent |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `agents-snapshot` | `Array<Agent>` | Full list of current agents (sent on connect) |
| `agent-created` | `{ id: string, ...Agent }` | A new agent has been created |
| `agent-updated` | `{ id: string, ...fields }` | Agent state changed (status, progress, tasks) |
| `agent-removed` | `{ id: string }` | Agent has been terminated and removed |
| `agent-log` | `{ id: string, log: string }` | New log line from an agent |

### Agent Object

```typescript
{
  id: string;
  mission: string;
  cwd: string;
  status: 'planning' | 'review' | 'executing' | 'complete' | 'error' | 'terminated';
  progress: number;       // 0–100
  totalTasks: number;
  completedTasks: number;
  tasks: Task[];
  logs: LogEntry[];
  createdAt: string;       // ISO 8601
  useVibes: boolean;       // true = real Vibes, false = demo simulation
  error?: string;          // present when status === 'error'
}
```
