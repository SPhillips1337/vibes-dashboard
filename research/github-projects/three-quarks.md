# three.quarks — Three.js Particle System

**URL**: https://github.com/Alchemist0823/three.quarks  
**License**: MIT  
**Stack**: Three.js, TypeScript  
**Last active**: 2024

## Why It Matters

The most mature open-source particle system built on Three.js. Has a visual node editor, batched rendering, and support for sub-emitters, trails, and mesh particles. Most relevant for replacing or augmenting the current canvas-based background particle engine in `public/js/background.js`.

## What to Cherry-Pick

- **BatchedParticleRenderer** — reduces draw calls significantly vs. per-particle meshes
- **TrailBatch** for energy trail effects (relevant to Cyber Stream / Electrical Storm modes)
- JSON-serialisable particle configs — could allow users to import VFX presets

## What to Avoid

- The visual editor is a separate package — don't bundle it into the dashboard
- TypeScript source requires build step; use the pre-built CDN dist instead

## Notes

Already has a Three.js `r152+` compatible API. If we add a new background VFX mode, scaffold it using three.quarks before writing raw particle code.

*Evaluated: 2026-06-12*
