# ADR-0001 — Use Vanilla JS (No Frontend Framework)

**Date**: 2026-05-14  
**Status**: Accepted

## Context

The dashboard is a local-use SPA for a single developer. It needs fast iteration, no build step, and minimal cognitive overhead for AI agents working in the codebase.

## Decision

Use vanilla HTML5, CSS3, and ES6+ JavaScript. No React, Vue, Svelte, or similar. No bundler (webpack, Vite, Parcel). Express serves static files directly.

## Consequences

- ✅ No build step — `npm start` runs immediately
- ✅ AI agents can read and modify any file without understanding a framework's abstractions
- ✅ CSS custom properties and `backdrop-filter` work without transpilation
- ⚠️ No component hot-reload — server auto-restarts via `--watch`, browser refresh is manual
- ⚠️ State management is manual; each module owns its own state in its IIFE closure

## What This Rules Out

- React, Vue, Svelte, Angular
- Tailwind CSS (use CSS custom properties instead)
- Any bundler or transpilation pipeline
