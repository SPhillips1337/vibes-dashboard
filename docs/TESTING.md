# Testing

## Phase 4 harness reads and UI

Run `npm test` for the complete Node suite or `npm run test:harness` for durable-harness coverage. `test/harness/harness-api.test.js` covers pagination validation, traversal, stable errors, bounded log tails, and evidence envelopes. `test/orchestrator-render.test.js` covers Timeline/Evidence view models and statically prohibits `innerHTML` assignment in orchestrator live-data paths. Browser smoke should additionally exercise authenticated tab keyboard navigation and evidence-to-timeline focus.

## Automated Tests

The project uses Node's built-in `node:test` runner and has no testing dependencies.

```bash
npm test                 # all top-level and durable-harness tests
npm run test:harness     # durable-harness contract, store, and projector tests
```

Harness tests live in `test/harness/*.test.js`; secret-free replay fixtures live in `test/fixtures/harness-runs/`. The suite covers event validation/redaction, filesystem durability and recovery, concurrent append serialization, path containment, and deterministic run projection.

`test/harness/phase5-6.test.js` covers operation-key conflict and crash repair, child isolation/depth and targeted required-child fail-closed outcomes, event-first checkpoint repair/resume, independent age/count/byte retention with lineage/quarantine safety, exact serialized export bounds, and `.env` credential echo redaction.

Production CommonJS files can be syntax-checked directly:

```bash
node --check server/harness/event-contract.js
node --check server/harness/run-store.js
node --check server/harness/run-projector.js
```

## Manual Testing

### Server

Start the server and verify the following:

```bash
npm start
```

1. **Server starts correctly** — Console should show the dashboard banner with port, WebSocket status, and execution mode.
2. **REST endpoints** — Test with curl:
   ```bash
   curl http://localhost:9000/api/agents
   curl http://localhost:9000/api/audio
   ```
3. **Static files** — Open `http://localhost:9000`; the dashboard should load with the glassmorphic UI.

### Dashboard UI

Verify agent creation and review, execution progress/logs, agent termination, music and visualizer controls, settings, and voice commands. HTTPS or localhost and browser microphone permission are required for voice testing.

### Edge Cases

- Launch multiple agents and verify independent progress.
- Create and immediately terminate an agent.
- Verify `/api/audio` returns `[]` when no audio is configured.
- Run without Vibes installed and verify demo mode.
- Run without certificates and verify HTTP fallback messaging.

## Remaining Coverage

Automated coverage is still needed for Socket.io behavior, VibesBridge JSON-RPC flow, and broader frontend rendering/state management.
