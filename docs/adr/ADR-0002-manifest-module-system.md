# ADR-0002 — Manifest-Driven Module Convention

**Date**: 2026-05-18  
**Status**: Accepted

## Context

The dashboard needs to be extensible without requiring server-side configuration changes every time a new panel is added.

## Decision

Modules are auto-discovered from `modules/*/manifest.json` at startup. Each module declares its own `id`, display `name`, `icon` SVG, and asset file names (`css`, `html`, `js`). The server exposes them via `GET /api/modules`. The frontend shell (`app.js`) loads and injects each module's assets dynamically.

**Manifest schema:**
```json
{
  "id": "my-module",
  "name": "Display Name",
  "subtitle": "Short description",
  "icon": "<svg>...</svg>",
  "css": "style.css",
  "html": "view.html",
  "js": "script.js"
}
```

## Consequences

- ✅ Adding a module = dropping a folder with 4 files; no server code change required
- ✅ Modules are sandboxed in their own IIFE scopes
- ✅ The sidebar icon list is always in sync with available modules
- ⚠️ Module load order is filesystem-dependent (alphabetical); don't rely on load order
- ⚠️ Modules share the global DOM — use panel-scoped `querySelector(panel, ...)` not `document.querySelector(...)`
