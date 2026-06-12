# AGENTS.md — AI Agent Guidelines for Vibes Dashboard

> **Non-negotiable rules for any AI agent working in this repo.**
> Full project context in [CONTEXT.md](CONTEXT.md). Workflow conventions in [HERMES.md](HERMES.md).

---

## Design System (Enforced)

All UI work must conform to the glassmorphic design system:

| Token | Value |
|---|---|
| Panel background | `rgba(20, 20, 25, 0.7)` |
| Backdrop blur | `backdrop-filter: blur(12px)` |
| Border | `1px solid rgba(255, 255, 255, 0.1)` |
| Primary color | `#3b82f6` |
| Secondary color | `#60a5fa` |
| Deep background | `#0a0a0c` |
| Font (body) | `Inter`, sans-serif |
| Font (accent) | `Outfit`, sans-serif |
| Transition easing | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Border radius | `16px` minimum |

### Hard Design Rules
- **No opaque panels** — `#fff` or `#000` backgrounds on UI elements are a build failure
- **No Tailwind** — all styles use the CSS custom properties in `public/css/style.css`
- **No sharp corners** — everything has a border radius
- **No default fonts** — Inter and Outfit only

---

## Security Rules

- **Never** set `innerHTML` with unescaped strings. Use `escapeHtml()` (in each module's `script.js`) or `textContent`
- **Never** skip CSRF token on mutating requests: `headers: { 'X-CSRF-Token': window.Dashboard.csrfToken }`
- **Never** store secrets in source files — use `localStorage` or environment variables
- **Never** trust `req.body` for user identity — read from `req.session`

---

## Music Rules

- **All music must be royalty-free** — Jamendo API only for discovery
- **No Apple/iTunes CDN URLs** — `audio-ssl.itunes.apple.com` is banned
- **No local MP3 downloads** from external sources — save metadata only to `data/music/saved_playlist.json`
- If you see Apple CDN URLs in `saved_playlist.json`, remove them immediately

---

## Module Rules

- Each module wraps its script in an IIFE: `(function() { 'use strict'; /* ... */ })()`
- Modules access session data only via `window.Dashboard.*` globals
- Modules must call `window.vibePlayer.playClick()` for UI sound effects where appropriate
- Do not use `document.querySelector()` globally — scope all queries to the panel element passed to `init(panel)`

---

## What Agents Must Not Do

- ❌ Modify `public/index.html` shell structure without a design review
- ❌ Add npm packages without justification in the commit message
- ❌ Use `eval()`, `Function()`, or dynamic `import()` calls
- ❌ Bypass the CSRF guard middleware in `server/index.js`
- ❌ Save binary audio files from external APIs to disk
- ❌ Introduce a frontend build step without an ADR

---

*Maximize Momentum. Minimize Gravity.*
