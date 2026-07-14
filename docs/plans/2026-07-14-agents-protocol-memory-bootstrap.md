# Agents Protocol Memory Bootstrap Implementation Plan

> **For Hermes:** Implement this plan task-by-task with grounded repository evidence and no automatic Git commits.

**Goal:** Add a safe, Vibes-specific Agents Protocol long-term-memory overlay that helps future agents recover durable project knowledge without replacing canonical documentation or risking uncommitted work.

**Architecture:** `.agent/memory-index.json` is the machine-readable discovery layer. Markdown entries beneath `.agent/memories/` are derived summaries whose claims point back to canonical source files, ADRs, tests, and verified Git history. `CONTEXT.md`, `HERMES.md`, and `docs/adr/` remain authoritative; the overlay must never auto-commit or use destructive Git recovery.

**Tech Stack:** Markdown, JSON, Node.js built-in test runner, existing repository documentation.

---

### Task 1: Define the memory-overlay contract

**Objective:** Make the expected structure, source references, and safety policy executable.

**Files:**
- Create: `test/agents-protocol-memory.test.js`

**Steps:**
1. Add assertions for the bootstrap guide, JSON index, semantic/decision/procedural entries, unique IDs, and existing source references.
2. Assert that explicit-commit approval is required and destructive Git recovery is forbidden.
3. Run `node --test test/agents-protocol-memory.test.js` and confirm RED because the overlay does not exist yet.

### Task 2: Create the bootstrap and indexed memory layer

**Objective:** Add a small discoverable memory system tailored to this repository.

**Files:**
- Create: `BOOTSTRAP.md`
- Create: `.agent/README.md`
- Create: `.agent/memory-index.json`

**Steps:**
1. Define canonical-source precedence and pre-task tag lookup.
2. Define update criteria, source-reference requirements, truth-audit procedure, and secret restrictions.
3. Explicitly prohibit automatic commits, `git reset --hard`, and overwriting dirty files.
4. Re-run the focused test; it should remain RED until all indexed entries exist.

### Task 3: Bootstrap grounded repository memories

**Objective:** Capture high-value hidden knowledge without copying whole architecture documents.

**Files:**
- Create: `.agent/memories/codebase_insights/module-runtime.md`
- Create: `.agent/memories/codebase_insights/durable-agent-harness.md`
- Create: `.agent/memories/codebase_insights/security-boundary.md`
- Create: `.agent/memories/codebase_insights/music-library.md`
- Create: `.agent/memories/architectural_decisions/decision-index.md`
- Create: `.agent/memories/patterns_and_lessons.md`

**Steps:**
1. Synthesize only claims grounded in current code, ADRs, tests, and named commits.
2. Mark every entry active and include a last-verified date plus canonical source list.
3. Keep runtime secrets, transient work, PR numbers, and raw conversation logs out of memory.
4. Run the focused test and confirm GREEN.

### Task 4: Integrate with canonical governance

**Objective:** Tell future agents when and how to consume the overlay while preserving existing authority.

**Files:**
- Create: `docs/adr/ADR-0007-derived-agent-memory-overlay.md`
- Modify: `AGENTS.md`
- Modify: `CONTEXT.md`
- Modify: `HERMES.md`
- Modify: `README.md`

**Steps:**
1. Record the derived-memory decision and rejected destructive Ratchet behavior in ADR-0007.
2. Add source-of-truth precedence and pre-task memory lookup to canonical agent docs.
3. Add the overlay to README project structure/documentation.
4. Keep existing design, security, module, API, and architecture rules unchanged.

### Task 5: Verify and hand off

**Objective:** Prove that the new protocol is internally consistent and does not disturb user work.

**Steps:**
1. Run `node --test test/agents-protocol-memory.test.js`.
2. Request a Resource Sentinel lease if a full test run is admitted as heavy work, then run `npm test`.
3. Run JSON parsing, link/path checks, `git diff --check`, and inspect `git status --short`.
4. Confirm `data/music/saved_playlist.json` and the supplied screenshot remain untouched.
5. Do not commit or push unless explicitly requested.
