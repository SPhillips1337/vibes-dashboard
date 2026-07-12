# Tutti Patterns for the Local Agent Control Plane Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add changed-aware verification, provider readiness contracts, and a real activity/approval control center to Stephen's local multi-agent stack.

**Architecture:** Keep orchestration ownership in the existing repositories. `ai-agent-teamwork-prompt` supplies a portable changed-file verification runner; `agent-communication-mcp` supplies normalized provider readiness and task activity projections; `vibes-dashboard` consumes those projections through a small server adapter and renders a control-center module. No Tutti runtime dependency is introduced.

**Tech Stack:** Python 3.11/pytest, FastMCP, Node.js 18+/Express/Socket.io, vanilla HTML/CSS/JS, Node test runner.

---

## Evaluation matrix

| Tutti pattern | Local fit | Decision |
|---|---|---|
| Changed-aware compact checks with durable logs | Directly reduces multi-CLI verification cost | Adopt now |
| Provider capability/readiness contracts | Prevents dispatch to missing or unauthenticated CLIs | Adopt now |
| Unified activity and approval control center | Existing Vibes Dashboard is the correct UI surface | Adopt now |
| Tutti desktop/runtime | Duplicates Hermes and current coordination services | Skip |

## Task 1: Portable changed-aware verifier

**Objective:** Add a project-configurable runner that maps changed files to validation lanes, executes selected lanes concurrently, prints a compact summary, and stores complete logs under `.tmp/check-runs/`.

**Repository:** `/home/stephen/projects/ai-agent-teamwork-prompt`

**Files:**
- Create: `scripts/check_changed.py`
- Create: `templates/checks.json`
- Create: `tests/test_check_changed.py`
- Modify: `README.md`

**TDD:** Test lane selection, explicit base refs, untracked files, parallel execution, exit status, log persistence, and compact summaries. Run focused tests red then green, followed by the repository test suite.

## Task 2: Provider readiness and activity projection

**Objective:** Expose normalized readiness/capability information for configured CLI profiles and a bounded control-center projection of recent task events and pending approvals.

**Repository:** `/home/stephen/projects/agent-communication-mcp`

**Files:**
- Create or extend the narrowest modules under `src/agent_communication_mcp/`
- Add focused tests under `tests/`
- Modify `src/agent_communication_mcp/server.py` to register read-only tools
- Update `README.md` and `CONTEXT.md`

**Contract:** Every provider projection includes stable ID, display name, binary availability, auth/readiness state, capabilities, diagnostics, and checked timestamp. Activity items use stable IDs, task/agent/project references, state, summary, timestamp, approval-required flag, and artifact references. Never expose secret values.

**TDD:** Test available/missing binary states, profile normalization, redaction, deterministic ordering, bounded activity output, and MCP tool registration. Run `uv run --extra dev pytest -q`.

## Task 3: Vibes control center

**Objective:** Add a dashboard module displaying provider readiness, recent agent activity, pending approvals, verification results, and artifact references using real adapter data with an explicit unavailable state.

**Repository:** `/home/stephen/projects/vibes-dashboard`

**Files:**
- Create: `server/coordination-adapter.js`
- Create: `modules/control-center/manifest.json`
- Create: `modules/control-center/view.html`
- Create: `modules/control-center/script.js`
- Create: `modules/control-center/style.css`
- Add tests using Node's built-in test runner
- Modify: `server/index.js`, `package.json`, `docs/API.md`, `docs/ARCHITECTURE.md`, `README.md`

**TDD:** Test adapter normalization, timeouts/failure states, no secret leakage, REST responses, and control-center rendering helpers. Verify with `npm test`, JS syntax checks, server startup, authenticated or documented unauthenticated API smoke as applicable, and browser inspection.

## Acceptance gates

1. The changed-aware runner selects only relevant lanes and preserves full logs.
2. Provider readiness distinguishes unavailable, authentication-needed, ready, and degraded states without leaking credentials.
3. Control-center activity comes from real local state; no random/demo values are presented as live.
4. Existing tests pass in all three repositories.
5. The Vibes Dashboard starts successfully and the control-center module renders at desktop and narrow widths without browser-console errors.
6. Existing user changes, especially `vibes-dashboard/DESIGN.md`, remain untouched.
