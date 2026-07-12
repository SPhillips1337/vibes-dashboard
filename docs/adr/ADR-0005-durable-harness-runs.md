# ADR-0005 — Durable Harness Runs

**Date**: 2026-07-12
**Status**: Accepted

## Context

Agent runs must survive process restarts, retain an auditable history, and remain understandable without a database. A worker's claim of completion must never grant completed status without an independent verifier event.

## Decision

Store each run beneath `data/harness/runs/<run-id>/`:

- `run.json` contains immutable run identity and schema metadata and is never replaced. Mutable projections are restricted to `plan.json`, `verification.json`, `artifacts/manifest.json`, and `checkpoints/manifest.json`; each uses write-to-temp plus atomic rename.
- `events.jsonl` is an append-only event log. Each line is one complete JSON event. Writes are serialized per run so concurrent append calls cannot interleave. Coupled transitions (currently intervention resolution plus retry request) validate every event first, then append both JSONL lines with one queued `appendFile` call; cache mutation and notification happen only after that write succeeds, in event order.
- Retries append `execution.retry_requested` with an operation key and incremented attempt. Projection deliberately resets current retry task state without deleting prior events, logs, or evidence.
- Events carry `schemaVersion: 1`, a unique event ID, run ID, supported type, ISO timestamp, actor, and object data. New untrusted events are strictly validated and size-limited.
- Readers use compatibility mode: canonical fields remain required, while additive envelope fields and valid stored envelopes with unknown future event types remain readable; projectors ignore types they do not understand.

On recovery, complete JSONL records are replayed in append order. A malformed, unterminated final record is treated as a crash-truncated append: preceding records are returned with an explicit warning. Other corruption remains an error. Duplicate event IDs are idempotent during projection.

Run IDs use a restricted filename-safe grammar, and all resolved paths must remain direct children of the configured root. Runtime data is gitignored. Operators may apply age/count retention to whole run directories, but retention must never rewrite or selectively remove events from a retained run.

Secret-bearing fields are rejected at ingestion. Run metadata strictly allowlists only LLM `provider`, `hostUrl`, `model`, and `maxTokens`; launch credentials remain in ephemeral server memory and are lost on restart. Callers that intentionally sanitize input may use structural redaction before validation; redacted values are stored as `[REDACTED]`. Event payloads and fixtures must not contain credentials, authorization headers, cookies, private keys, or tokens.

The permission and verifier boundary is immutable: execution actors may emit `execution.claimed_complete`, which projects the run to `verifying`; only a distinct `verification.passed` event projects `completed`. `verification.failed` projects `failed`. Workers cannot bypass or mutate this boundary through run metadata.

Verification recipes are loaded only from an injected server object or the absolute path in `HARNESSES_VERIFICATION_POLICY`, which must live outside agent-editable run workspaces. Recipes identify an allowlisted absolute executable and argv array, fixed `run_workspace` cwd, timeout, output-byte bound, and expected relative artifacts. Shell interpolation, metacharacter-bearing argv, traversal artifacts, symlinks, and realpath escapes are rejected. Artifact validations are events emitted before the terminal verification event. No selected recipes or artifacts is an explicit `no_checks_configured` failure for real runs; the no-policy demo server owns a deterministic Node fixture recipe.

## Consequences

- Durable runs are inspectable and recoverable with Node.js filesystem primitives only.
- Append-only history supports auditing and deterministic reprojection.
- Atomic mutable-document replacement avoids partially written projection files while preserving immutable run identity.
- Compatibility reads permit forward evolution while strict ingestion prevents accidental unsupported events.
- Filesystem serialization and symlink/containment checks are process-local. Linux `O_NOFOLLOW` protects final-component event/document opens, while `lstat`/`realpath` protect root, run, and nested directories. Batch atomicity is defined at the single append syscall/single-writer boundary: one process-local queued append either rejects before cache publication or commits the complete payload. This design assumes a trusted single writer; hostile concurrent directory replacement, partial low-level filesystem writes, or multi-process writers require a future directory-handle/locking or transactional design.
- Retention is directory-granular and must be configured operationally.
