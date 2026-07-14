# Durable Agent Harness

**Status: Active**  
**Last verified: 2026-07-14**

## Hidden knowledge

- `events.jsonl` is authoritative for run lifecycle; `plan.json`, `verification.json`, artifact manifests, and checkpoint manifests are derived documents.
- Persistence precedes cache mutation and notification. Coupled transitions are validated together and appended in one queued write before projection or emission.
- A worker's successful exit or completion claim is diagnostic only. A real run reaches `completed` exclusively through independent `verification.passed` evidence from server-owned allowlisted recipes.
- Startup replay never silently resumes execution. Non-terminal work is projected as interrupted unless it is already in a durable review or blocked state.
- Child lineage, retention, checkpoint, export, and evidence reads are bounded. Destructive retention is opt-in and directory-granular.

## Evidence

Commit `c353eb7` established the event contract, store, projector, service, verifier, policy boundary, and focused tests. Later harness tests expanded idempotency, recovery, cursor bounds, evidence, and child-run safety.

## Canonical sources

- `docs/adr/ADR-0005-durable-harness-runs.md`
- `docs/ARCHITECTURE.md`
- `server/harness/run-service.js`
- `server/harness/verifier.js`
- `test/harness/`
