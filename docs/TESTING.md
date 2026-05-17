# Testing Guide

## Current Status

This project does not currently have an automated test suite. Testing is performed manually.

## Manual Testing

### Server

Start the server and verify the following:

```bash
npm start
```

1. **Server starts correctly** — Console should show the dashboard banner with port, WebSocket status, and execution mode
2. **REST endpoints** — Test with curl:
   ```bash
   curl http://localhost:9000/api/agents     # should return []
   curl http://localhost:9000/api/audio       # should return track list or []
   ```
3. **Static files** — Open `http://localhost:9000` — the dashboard should load with the glassmorphic UI

### Dashboard UI

1. **Agent creation** — Click the "+" card, enter a mission, submit
2. **Task review** — Verify tasks appear, then accept or decline
3. **Execution** — Watch progress bar update and log lines stream
4. **Agent detail** — Click an agent card to expand; verify live logs
5. **Agent termination** — Click terminate; verify agent is removed
6. **Music player** — Open music panel, play/pause, adjust volume
7. **Visualizer** — Verify frequency bars react to audio
8. **Settings** — Open settings, toggle theme, configure LLM provider
9. **Voice commands** — (HTTPS/localhost only) Click mic, speak a command

### HTTPS / Voice

1. Run `bash generate_cert.sh`
2. Start server and visit `https://localhost:9000`
3. Accept the self-signed certificate warning
4. Click the microphone button and grant microphone permission
5. Speak a command (e.g., "launch agent")

### Edge Cases

- **Concurrent agents** — Launch multiple agents; verify each runs independently
- **Rapid create/terminate** — Create and immediately terminate agents
- **Empty audio directory** — Remove audio files; verify `/api/audio` returns `[]`
- **No Vibes repo** — Run without Vibes installed; verify demo mode activated
- **Missing certs** — Run without `certs/`; verify HTTP fallback message

## Future

Automated tests should be added for:
- Server REST endpoints (supertest + Jest)
- Socket.io event handling
- VibesBridge JSON-RPC flow
- Frontend rendering and state management
