# Vibes Dashboard Agents Protocol Bootstrap

This repository uses a safe adaptation of the HappyMonkeyAI Agents Protocol. The `.agent/` tree is a derived memory layer for agent context enrichment; it does not replace project documentation or Git history.

## Canonical sources

Resolve conflicts in this order:

1. Current code and tests
2. Accepted records in `docs/adr/`
3. `CONTEXT.md`
4. `HERMES.md` and `AGENTS.md`
5. `.agent/memories/` derived summaries
6. Historical plans, research notes, and commit messages

When a memory disagrees with a higher source, follow the higher source and repair or retire the memory in the same scoped change.

## Before a task

1. Read `CONTEXT.md`, `HERMES.md`, and `AGENTS.md`.
2. Check `git status --short` and preserve unrelated dirty files.
3. Search `.agent/memory-index.json` by tags related to the task.
4. Read only the matching memory entries and then verify their source references against current files.
5. Map the blast radius before non-trivial changes and use the repository's existing test commands.

## Updating derived memory

Add or change a memory only when the knowledge is durable, non-obvious, and likely to prevent future re-discovery. Every active entry must:

- have a unique index ID, type, status, tags, path, and existing source references;
- state `Status` and `Last verified`;
- link to canonical sources rather than copying them wholesale;
- omit secrets, credentials, raw conversation logs, temporary TODOs, PR numbers, and transient runtime state;
- be updated or retired when a truth audit finds drift.

Use semantic entries for codebase facts, decision entries as ADR indexes, and procedural entries for reusable lessons. Architecture choices still require an ADR.

## Truth audit

Run an audit after a major architecture change or roughly every ten substantial tasks:

1. Validate `.agent/memory-index.json` and all referenced paths.
2. Compare each active claim with current code, tests, and ADR status.
3. Update `Last verified`, repair stale claims, or mark superseded entries retired.
4. Run `node --test test/agents-protocol-memory.test.js` and the relevant repository tests.

## Git and recovery safety

- Commit only when explicitly requested by the user.
- Never run destructive Git recovery such as `git reset --hard`, `git clean -fd`, or broad checkout/restore against a dirty worktree.
- Use targeted patches, preserve user-owned changes, and stop for scope clarification if ownership cannot be established.
- Verification failure triggers diagnosis and replanning, not automatic rollback.

## Verification

```bash
node --test test/agents-protocol-memory.test.js
npm test
git diff --check
git status --short --untracked-files=all
```
