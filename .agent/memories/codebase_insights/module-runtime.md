# Module Runtime

**Status: Active**  
**Last verified: 2026-07-14**

## Hidden knowledge

- The live panel implementation is selected by `modules/<id>/manifest.json`; similarly named files under `public/js/` may be shell helpers or legacy surfaces. Trace `GET /api/modules` through `public/js/app.js` before editing a module.
- Module HTML, CSS, and JavaScript are loaded dynamically into a shared document. IIFE scope prevents JavaScript-name collisions, but it is not a DOM or security sandbox; selectors must remain panel-scoped.
- Manifest icons are SVG source strings. They must be reconstructed through an element/attribute/value allowlist, not rendered as escaped source text and not inserted with untrusted `innerHTML`.
- Module assets are read from disk, but an already-open browser retains loaded JavaScript and CSS. A reload is required to observe static changes.

## Evidence

ADR-0002 defines manifest discovery. Commit `6bc1b81` introduced module UI sanitization; commit `e2cf0e1` replaced escaped icon markup with safe SVG reconstruction and a bounded responsive grid.

## Canonical sources

- `docs/adr/ADR-0002-manifest-module-system.md`
- `public/js/app.js`
- `server/index.js`
- `AGENTS.md`
