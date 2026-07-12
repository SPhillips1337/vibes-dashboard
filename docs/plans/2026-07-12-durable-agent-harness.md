# Durable Agent Harness Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn Vibes Dashboard from an in-memory agent launcher into a durable, inspectable harness that persists runs, separates execution claims from verified outcomes, restores state after restart, and provides an evidence-backed timeline in the existing orchestrator UI.

**Architecture:** Keep `VibesBridge` as the adapter to the existing Vibes MCP process, but move run ownership into a small server-side harness layer. Every lifecycle change becomes a typed, append-only event persisted under `data/harness/runs/<run-id>/`; a projector rebuilds the current run snapshot from those events. Socket.io continues to update the vanilla frontend, while the expanded agent view gains Timeline, Evidence, and Logs projections. Security policy and verification remain outside the agent process.

**Tech Stack:** Node.js 18+, Express, Socket.io, JSON/JSONL filesystem persistence, vanilla HTML/CSS/JS, Node's built-in `node:test` runner.

**Source:** Lilian Weng, [Harness Engineering for Self-Improvement](https://lilianweng.github.io/posts/2026-07-04-harness/) — particularly workflow automation, filesystem persistence, explicit subagent/backend jobs, verifier-grounded failure records, and permission controls outside the editable harness.

---

## Current-state findings

- `server/index.js` owns all active agents in `const agents = new Map()`; state disappears on restart.
- Logs are capped at 200 in-memory lines.
- Task progress is inferred from stderr strings beginning with `[TASK_STATUS]`.
- `handleVibesExecution()` sets `status = 'complete'` whenever the MCP call returns content; no independent verification is required.
- `modules/orchestrator/script.js` already has the correct user surface: cards, review flow, detail overlay, retry, termination, and interventions.
- The existing untracked Tutti plan proposes a wider control center. This plan supplies its durable run/activity substrate; do not build a second competing run model.
- `DESIGN.md` has pre-existing user modifications and must remain untouched.

## Scope decisions

| Capability | Decision |
|---|---|
| Durable run/event storage | Build now |
| Restart recovery | Build now |
| Typed timeline and evidence UI | Build now |
| Verification gate before green completion | Build now |
| Parent/child run relationships | Include in schema and projection; minimal UI now |
| Checkpoint metadata | Include now; filesystem rollback engine later |
| Automated harness mutation/evolution | Defer |
| Model-weight updates | Out of scope |
| Agent-controlled security policy | Explicitly prohibited |
| Database dependency | Avoid; JSONL is sufficient for the local single-node dashboard |

## Target run layout

```text
data/harness/runs/<run-id>/
├── run.json                 # immutable identity/schema metadata
├── events.jsonl             # append-only typed lifecycle events
├── plan.json                # latest accepted plan
├── verification.json        # current verification summary
├── artifacts/
│   └── manifest.json        # references only; no secret or arbitrary file copying
└── checkpoints/
    └── manifest.json        # metadata for future rollback integration
```

`data/harness/runs/` must be gitignored. A committed, secret-free fixture belongs under `test/fixtures/harness-runs/`.

## Lifecycle

```text
created → planning → awaiting_approval → executing
         ↘ failed              ↓
                         verifying → completed
                              ↘ failed | blocked
```

A process exit and an agent's success claim are observations, not proof of completion. Only a passing verifier may transition a real run to `completed`.

## Event contract

Every event has:

```json
{
  "schemaVersion": 1,
  "eventId": "evt_<stable-id>",
  "runId": "run_<stable-id>",
  "type": "task.started",
  "timestamp": "2026-07-12T00:00:00.000Z",
  "actor": { "type": "harness", "id": "vibes-dashboard" },
  "data": {}
}
```

Initial event types:

- `run.created`, `run.restored`, `run.terminated`
- `plan.requested`, `plan.proposed`, `plan.approved`, `plan.declined`
- `execution.started`, `execution.claimed_complete`, `execution.failed`
- `task.started`, `task.completed`, `task.failed`
- `log.emitted`
- `artifact.declared`, `artifact.validated`
- `verification.started`, `verification.passed`, `verification.failed`
- `intervention.requested`, `intervention.resolved`
- `checkpoint.recorded`

Unknown future event types must be preserved and ignored safely by older projectors.

---

## Phase 0: Architecture and test foundation

### Task 0.1: Record the persistence decision

**Objective:** Make filesystem event sourcing and external verification explicit architecture decisions.

**Files:**
- Create: `docs/adr/ADR-0005-durable-harness-runs.md`
- Modify: `CONTEXT.md`
- Modify: `HERMES.md`
- Modify: `docs/ARCHITECTURE.md`

**Steps:**
1. Document why append-only JSONL is preferred over another database for this local dashboard.
2. State that agents cannot alter permission policy, verifier definitions, or event history.
3. Record atomic-write, schema-version, recovery, retention, and redaction requirements.
4. Add ADR 0005 to the ADR index and architecture decision table.
5. Commit: `docs: define durable harness run architecture`.

### Task 0.2: Add the built-in test runner

**Objective:** Establish a dependency-free automated test command before harness code is added.

**Files:**
- Modify: `package.json`
- Create: `test/smoke.test.js`
- Modify: `docs/TESTING.md`

**Steps:**
1. Add `"test": "node --test"` and `"test:harness": "node --test test/harness/*.test.js"`.
2. Write a smoke test that imports a small existing pure helper or validates the test fixture contract without starting the server.
3. Run `npm test`; expected: PASS.
4. Commit: `test: add node test runner`.

**Phase gate:** `npm test && node --check server/index.js && node --check server/vibes-bridge.js`.

---

## Phase 1: Typed events and durable storage

### Task 1.1: Define and validate harness events

**Objective:** Reject malformed or unsafe event envelopes before persistence.

**Files:**
- Create: `server/harness/event-contract.js`
- Create: `test/harness/event-contract.test.js`

**TDD cases:**
- accepts every supported event type;
- rejects missing run ID, timestamp, actor, or data;
- rejects unsupported schema versions;
- rejects oversized event data;
- strips or rejects known secret-shaped fields such as `apiKey`, `token`, and `password`;
- preserves an unknown event when reading an existing log but rejects it from an untrusted socket client.

**Verification:** `node --test test/harness/event-contract.test.js`.

**Commit:** `feat: define typed harness event contract`.

### Task 1.2: Implement append-only run storage

**Objective:** Create runs and append/read events without partial files or path traversal.

**Files:**
- Create: `server/harness/run-store.js`
- Create: `test/harness/run-store.test.js`
- Modify: `.gitignore`

**TDD cases:**
- creates the expected run directory and immutable `run.json`;
- appends one valid JSON object per line;
- serializes concurrent appends per run;
- rejects `../` and malformed run IDs;
- ignores a truncated final JSONL line during recovery and reports a warning;
- writes replaceable JSON documents atomically via temp file + rename;
- lists runs in deterministic newest-first order;
- never writes outside the configured root.

**Verification:** run the focused test with a temporary storage root; inspect that no files were written under real `data/harness/`.

**Commit:** `feat: persist append-only harness runs`.

### Task 1.3: Build the event projector

**Objective:** Derive the current run/task/verification snapshot deterministically from an event sequence.

**Files:**
- Create: `server/harness/run-projector.js`
- Create: `test/harness/run-projector.test.js`
- Create: `test/fixtures/harness-runs/verified-run/events.jsonl`
- Create: `test/fixtures/harness-runs/failed-run/events.jsonl`

**TDD cases:**
- complete lifecycle projection;
- task counts and progress;
- claimed-complete remains `verifying`, not `completed`;
- only `verification.passed` yields `completed`;
- failed verification yields `failed` with evidence;
- duplicate event IDs are idempotent;
- out-of-order timestamps do not override append order;
- parent/child IDs and artifact references survive projection;
- unknown stored events do not crash recovery.

**Commit:** `feat: project run state from harness events`.

**Phase gate:** `npm run test:harness` plus a temporary-directory create/append/reload probe.

---

## Phase 2: Harness service and restart recovery

### Task 2.1: Add the run service

**Objective:** Provide one API for lifecycle transitions so `server/index.js` no longer mutates agent state directly.

**Files:**
- Create: `server/harness/run-service.js`
- Create: `test/harness/run-service.test.js`

**Public operations:**

```text
createRun
recordPlan
approvePlan
declinePlan
startExecution
recordTaskStatus
recordLog
claimExecutionComplete
recordArtifact
startVerification
finishVerification
requestIntervention
resolveIntervention
terminateRun
getRun
listRuns
restoreRuns
```

**TDD cases:** legal transitions, illegal transitions, repeated Socket.io messages, concurrent runs, event emission after persistence, and no `completed` transition without passing verification.

**Commit:** `feat: add durable harness run service`.

### Task 2.2: Restore persisted runs on startup

**Objective:** Reconstruct dashboard state after process restart while marking interrupted work honestly.

**Files:**
- Modify: `server/index.js`
- Modify: `docs/ARCHITECTURE.md`
- Create: `test/harness/recovery.test.js`

**Rules:**
- Restore terminal states unchanged.
- Convert persisted `planning`, `executing`, or `verifying` runs to `interrupted` unless their process can be proven live.
- Append `run.restored` rather than silently mutating history.
- Never automatically restart execution after a dashboard reboot.
- Preserve the existing `agents-snapshot` client contract during migration.

**Verification:** start against a temporary fixture root, query the snapshot, restart, and confirm the same run ID and history return with `interrupted` status.

**Commit:** `feat: restore harness runs after restart`.

### Task 2.3: Migrate lifecycle writes in `server/index.js`

**Objective:** Replace direct `agents` mutations with run-service transitions while retaining current Socket.io event compatibility.

**Files:**
- Modify: `server/index.js`
- Create: `test/harness/socket-projection.test.js`
- Modify: `docs/API.md`

**Migration order:**
1. create/plan/review;
2. accept/decline;
3. task status and logs;
4. retry/intervention;
5. terminate/exit;
6. execution result.

Keep a projected in-memory cache if useful, but make disk events the source of truth. Do not parse general stderr into authority-bearing state; retain `[TASK_STATUS]` only as a compatibility adapter that emits typed events.

**Commit:** `refactor: route agent lifecycle through durable harness`.

**Phase gate:** `npm test`, syntax checks, server startup, create demo run, restart server, confirm restoration.

---

## Phase 3: Verification and evidence gate

### Task 3.1: Define verification recipes

**Objective:** Allow the harness—not the agent—to choose bounded verification commands per workspace.

**Files:**
- Create: `server/harness/verification-policy.js`
- Create: `test/harness/verification-policy.test.js`
- Create: `data/harness/verification-policies.example.json`
- Modify: `.gitignore`

**Initial policy:**
- A run may declare requested checks, but only configured/allowlisted checks execute.
- Commands run with argv arrays where possible, fixed timeout, bounded output, and the run workspace as cwd.
- No shell interpolation from model output.
- Capture command, cwd, start/end time, exit code, timeout state, and bounded stdout/stderr references.
- Default policy may verify declared artifacts exist without running commands.

**Commit:** `feat: define external harness verification policy`.

### Task 3.2: Execute and persist verification

**Objective:** Produce independent evidence before assigning a green completion state.

**Files:**
- Create: `server/harness/verifier.js`
- Create: `test/harness/verifier.test.js`
- Modify: `server/harness/run-service.js`

**TDD cases:** passing command, failing command, timeout, missing artifact, output truncation, signal termination, and attempted command injection.

**Integration:** after `executePlannedMission()` returns, append `execution.claimed_complete`, run verification, then append `verification.passed` or `verification.failed`.

**Commit:** `feat: gate run completion on verification evidence`.

### Task 3.3: Record verifier-grounded failures

**Objective:** Preserve useful failure records for later bounded harness improvement.

**Files:**
- Modify: `server/harness/run-service.js`
- Create: `test/harness/failure-record.test.js`

**Failure record fields:** terminal verifier cause, relevant agent behaviour, exposed mechanism, retryability, evidence event IDs, and optional human note. Do not ask an LLM to rewrite the harness in this phase.

**Commit:** `feat: persist verifier-grounded failure records`.

**Phase gate:** demonstrate one passing fixture and one failing fixture; confirm only the passing run becomes `completed`.

---

## Phase 4: Timeline and evidence UI

### Task 4.1: Expose bounded run APIs

**Objective:** Let the orchestrator load timelines and evidence without sending unbounded logs in every snapshot.

**Files:**
- Modify: `server/index.js`
- Modify: `docs/API.md`
- Create: `test/harness/run-api.test.js`

**Endpoints:**
- `GET /api/harness/runs?limit=&status=`
- `GET /api/harness/runs/:id`
- `GET /api/harness/runs/:id/events?cursor=&limit=`
- `GET /api/harness/runs/:id/evidence`

All routes require the existing authenticated session. Responses must be bounded and redact secrets. No new mutation endpoint is needed in this slice; existing authenticated Socket.io controls remain authoritative.

**Commit:** `feat: expose bounded harness run APIs`.

### Task 4.2: Add detail tabs without changing the shell

**Objective:** Extend the existing agent detail overlay with Overview, Timeline, Evidence, and Logs tabs.

**Files:**
- Modify: `modules/orchestrator/view.html`
- Modify: `modules/orchestrator/script.js`
- Modify: `modules/orchestrator/style.css`
- Create: `test/frontend/orchestrator-render.test.js`

**UI requirements:**
- Use existing glass tokens and scoped module queries.
- Use DOM APIs/`textContent` for event and evidence values; never interpolate unescaped event data.
- Timeline groups events by task but preserves append order.
- Evidence shows checks, exit codes, artifacts, and timestamps.
- Visually distinguish `Claimed complete`, `Verifying`, `Verified`, `Failed`, and `Interrupted`.
- Parent/child run references are clickable when present.
- Empty/unavailable states are explicit; never fill with demo evidence.

**Commit:** `feat: add harness timeline and evidence views`.

### Task 4.3: Stream typed events

**Objective:** Update an open timeline incrementally without reloading the full run.

**Files:**
- Modify: `server/index.js`
- Modify: `modules/orchestrator/script.js`
- Modify: `docs/API.md`
- Create: `test/harness/event-stream.test.js`

**Socket event:** `harness-event` with the validated/redacted event envelope. Keep `agent-updated` and `agent-log` during migration.

**Commit:** `feat: stream typed harness events to orchestrator`.

**Phase gate:** automated tests, JS syntax checks, live server, browser inspection at desktop and narrow widths, and zero browser-console errors.

---

## Phase 5: Checkpoints, child runs, and control-center integration

### Task 5.1: Add checkpoint metadata

**Objective:** Record recoverable points without pretending rollback exists.

**Files:**
- Modify: `server/harness/run-service.js`
- Create: `test/harness/checkpoint.test.js`

Record git ref, dirty-state summary, event ID, timestamp, and declared artifact references. Label checkpoints `metadata-only` until a separate safe rollback implementation is approved.

**Commit:** `feat: record harness checkpoint metadata`.

### Task 5.2: Project parent/child jobs

**Objective:** Make subagents and backend jobs explicitly inspectable.

**Files:**
- Modify: `server/harness/run-projector.js`
- Modify: `modules/orchestrator/script.js`
- Modify: `modules/orchestrator/style.css`
- Add focused tests.

Render a shallow run tree with status, elapsed time, and artifact/evidence count. Avoid recursive orchestration logic in the UI.

**Commit:** `feat: visualize parent and child harness runs`.

### Task 5.3: Feed the planned control center

**Objective:** Reuse durable harness projections in the existing Tutti-pattern control-center plan.

**Files:**
- Update: `docs/plans/2026-07-12-tutti-patterns-local-agent-control-plane.md`
- Future implementation files from that plan.

The control center consumes `RunService.listRuns()`/bounded REST projections. It must not create another activity store or infer verification state from logs.

**Commit:** `docs: align control center with durable harness runs`.

---

## Phase 6: Hardening and documentation

### Task 6.1: Retention, corruption, and concurrency hardening

**Objective:** Keep local persistence bounded and recoverable.

**Files:**
- Modify: `server/harness/run-store.js`
- Add focused tests.

Add configurable retention by terminal-run age/count, retain failure/evidence manifests, quarantine corrupted runs, serialize same-run writes, and ensure cleanup cannot follow symlinks outside the run root.

### Task 6.2: Security review

Verify:
- user-supplied run IDs cannot choose paths;
- events and logs cannot leak configured secrets;
- verification commands are policy-selected;
- sockets use the existing authenticated session;
- API responses are bounded;
- artifact references cannot read arbitrary host files;
- agents cannot modify verifier policy or historical events through MCP output.

### Task 6.3: Documentation and manual test update

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API.md`
- Modify: `docs/TESTING.md`
- Modify: `TASKS.md`

Document recovery semantics, storage location, lifecycle vocabulary, verification policy, retention, and prototype limitations.

**Final commit:** `docs: document durable verified agent harness`.

---

## End-to-end acceptance scenario

1. Start Vibes Dashboard in demo mode with a temporary harness root.
2. Create a mission and approve its plan.
3. Observe typed planning/task events in the Timeline tab.
4. Stop the dashboard during execution.
5. Restart it and confirm the same run is restored as `interrupted`, not silently resumed or marked successful.
6. Retry the run.
7. Complete execution and observe `execution.claimed_complete` followed by `verification.started`.
8. Run one intentionally failing verifier and confirm the card shows `Failed`, with evidence and no green success state.
9. Retry with a passing verifier and confirm the run becomes `Verified`/`completed`.
10. Inspect Evidence for commands, timestamps, exit codes, and artifact validation.
11. Confirm logs/timeline remain available after another server restart.
12. Confirm no secrets appear in API responses, events, logs, or persisted fixtures.

## Canonical verification commands

```bash
npm test
node --check server/index.js
node --check server/vibes-bridge.js
node --check server/harness/event-contract.js
node --check server/harness/run-store.js
node --check server/harness/run-projector.js
node --check server/harness/run-service.js
node --check server/harness/verifier.js
node --check modules/orchestrator/script.js
npm start
```

After startup, perform authenticated API smoke tests and browser inspection. Do not report the harness complete based only on syntax checks.

## Delivery sequence

1. Phase 0–2: durable event substrate and recovery.
2. Phase 3: external verification gate.
3. Phase 4: timeline/evidence UI — first user-visible vertical slice.
4. Phase 5: child runs/checkpoints/control-center reuse.
5. Phase 6: hardening and documentation.

Do not start automated harness self-editing until enough real failure records exist and a separate design defines editable surfaces, held-out regression scenarios, human promotion, and immutable permission boundaries.
