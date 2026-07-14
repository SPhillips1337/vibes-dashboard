# Patterns and Lessons

**Status: Active**  
**Last verified: 2026-07-14**

## Success patterns

1. **Trace the shipped surface first.** Follow the shell/module registry into the manifest and loaded asset before editing. This prevents work landing in plausible but inactive files.
2. **Use RED–GREEN plus live verification.** Source-level tests protect wiring and security invariants; browser inspection catches invisible controls, overflow, stale assets, and background/readability issues.
3. **Persist before publishing.** Durable harness mutations become visible only after authoritative storage succeeds. Derived documents and socket events never outrank the event log.
4. **Keep trust boundaries shared.** Authentication/MFA policy, CSRF checks, trusted-proxy handling, and independent verification must be enforced at every transport boundary rather than duplicated ad hoc.
5. **Treat mutable data as user-owned.** Use temporary roots for tests and preserve `data/` changes during unrelated feature work.

## Failure lessons

- Escaping an SVG string and placing it in a card displays raw markup; directly trusting it creates XSS risk. Rebuild only allowlisted SVG nodes and values.
- Hover-only destructive controls can technically exist while appearing absent. Keep essential actions visible and labelled.
- An already-open module retains old JavaScript/CSS after on-disk edits. Reload before concluding a static fix failed.
- Unquoted spaces in a shell-sourced `.env` value execute the trailing words as commands. Quote non-secret values such as display labels.
- Exit code zero and agent self-report are not completion evidence. Run the repository's independent verifier/tests and inspect resulting artifacts.
- Node `spawn` can report a valid shell as `ENOENT` when its `cwd` was removed. Validate the working directory separately, and settle the process lifecycle once because a spawn failure can emit both `error` and `close`.

## Memory hygiene

Only promote durable, reusable lessons. Do not append task logs, ephemeral failures, secrets, PR identifiers, or claims that cannot be traced to current code, tests, ADRs, or Git evidence.

## Canonical sources

- `docs/TESTING.md`
- `test/module-manager-ui.test.js`
- `test/music-ui.test.js`
- `test/session-policy.test.js`
- `test/terminal-exec.test.js`
- `docs/adr/ADR-0005-durable-harness-runs.md`
