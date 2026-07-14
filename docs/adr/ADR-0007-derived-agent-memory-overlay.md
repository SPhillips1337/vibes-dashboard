# ADR-0007 — Derived Agent Memory Overlay

**Date:** 2026-07-14  
**Status: Accepted**

## Context

The HappyMonkeyAI Agents Protocol proposes repository-local long-term memory for codebase insights, architectural decisions, and reusable lessons. Vibes Dashboard already has canonical operating documentation, ADRs, comprehensive tests, and Git history. Copying those sources into an independent memory system would create drift, while the upstream Ratchet examples of automatic commits and `git reset --hard HEAD` conflict with this repository's requirement to preserve user-owned changes and obtain explicit commit approval.

Future agents still benefit from a compact, tag-searchable map of non-obvious boundaries such as the manifest-loaded frontend surface, verifier-owned completion, MFA session enforcement, and mutable music-library data.

## Decision

Adopt `.agent/` as a **derived context overlay**:

1. `.agent/memory-index.json` provides versioned discovery metadata, tags, status, and source references.
2. `.agent/memories/` contains concise semantic, decision-index, and procedural summaries. Entries state status and last verification date.
3. Authority order is current code/tests, accepted ADRs, `CONTEXT.md`, `HERMES.md`/`AGENTS.md`, then derived memory. A lower source never overrides a higher one.
4. Architecture decisions remain in `docs/adr/`; memory links to them rather than becoming a second decision log.
5. Memory updates require current source references and omit secrets, raw conversations, temporary tasks, PR identifiers, and runtime state.
6. `BOOTSTRAP.md` defines pre-task lookup, truth audits, and focused validation.
7. Agents commit only after an explicit user request. Automatic commit behavior is not adopted.
8. Destructive recovery such as `git reset --hard`, `git clean -fd`, or broad restoration of a dirty worktree is forbidden. Repeated failure triggers diagnosis and replanning instead.

## Consequences

- Agents can retrieve relevant hidden knowledge without loading the entire documentation set.
- Tests detect missing entries, duplicate IDs, invalid types, broken source references, and weakened safety policy.
- The overlay adds maintenance work: architecture changes must update affected memories or retire them.
- `Last verified` indicates review recency, not independent truth; agents must still inspect canonical sources.
- The adaptation intentionally differs from upstream automatic Ratchet behavior to preserve local work and user control.
