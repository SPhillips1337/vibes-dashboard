# HERMES.md — Agent Workflow Guide

> Guidelines for AI agents and contributors working on this repository. Read [CONTEXT.md](CONTEXT.md) first for project rules; this file covers repo conventions and workflow.

---

## Repo Conventions

### File Naming
- Module folders: `modules/<kebab-case-name>/`
- ADRs: `docs/adr/ADR-NNNN-<slug>.md` (zero-padded, e.g. `ADR-0001-vanilla-frontend.md`)
- Research notes: `research/github-projects/<repo-name>.md`

### Commit Discipline
- One logical change per commit
- If you update an API endpoint, update `docs/API.md` in the same commit
- If you make an architecture decision, create or update an ADR in the same commit
- Do not commit `node_modules/`, `certs/`, or `settings.json`

### Branch Workflow
- Feature branches off `main`
- Name: `feature/<short-description>` or `fix/<short-description>`
- No long-lived branches — merge or close within the same session

---

## When Adding a Module

1. Create `modules/<name>/manifest.json`:
   ```json
   { "id": "name", "name": "Display Name", "subtitle": "Short subtitle",
     "icon": "<svg>...</svg>", "css": "style.css", "html": "view.html", "js": "script.js" }
   ```
2. Follow the IIFE pattern in `script.js`: `(function() { 'use strict'; ... })()`
3. Expose a single init export: `window.<ModuleId> = { init }`
4. Use `window.Dashboard.csrfToken` for authenticated fetch calls
5. Update `README.md` project structure if the module is significant

---

## When Adding an API Route

1. Add the route to `server/index.js` in the appropriate section (auth, music, agents, etc.)
2. Ensure it is behind the CSRF/session guard middleware (line ~204)
3. Document it in `docs/API.md` (method, path, params, response shape)
4. Update `project.json` → `api_endpoints` array

---

## When Changing Architecture

1. Write an ADR in `docs/adr/ADR-NNNN-<slug>.md`
2. Update `CONTEXT.md` → "Resolved Architecture Decisions" table
3. Update `docs/ARCHITECTURE.md` if the system diagram or component descriptions change

---

## ADR Index

| # | Title | Status |
|---|---|---|
| [0001](docs/adr/ADR-0001-vanilla-frontend.md) | Use vanilla JS — no frontend framework | Accepted |
| [0002](docs/adr/ADR-0002-manifest-module-system.md) | Manifest-driven module convention | Accepted |
| [0003](docs/adr/ADR-0003-jamendo-music-api.md) | Jamendo API for music discovery (not iTunes, not Pixabay) | Accepted |
| [0004](docs/adr/ADR-0004-json-file-playlist.md) | JSON file persistence for saved playlist | Accepted |
| [0005](docs/adr/ADR-0005-durable-harness-runs.md) | Durable harness runs | Accepted |
| [0006](docs/adr/ADR-0006-mfa-and-network-access-control.md) | TOTP MFA and network access control | Accepted |

---

## Research

External references live in `research/`. See [research/README.md](research/README.md) for structure.
Quick reference: [research/LINKS.md](research/LINKS.md)

---

## Checklist Before Finishing Any Task

- [ ] Code change is minimal and scoped to the task
- [ ] Any touched API endpoint is documented in `docs/API.md`
- [ ] Any architecture decision is captured in an ADR
- [ ] `CONTEXT.md` is still accurate
- [ ] No Apple/iTunes CDN URLs appear anywhere in source or data files
- [ ] No hardcoded secrets or API keys in source code

---

*Maximize Momentum. Minimize Gravity.*
