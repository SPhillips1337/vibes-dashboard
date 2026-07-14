# tslfx — Three.js Shading Language VFX

**URL**: https://github.com/verekia/tslfx  
**License**: MIT  
**Stack**: Three.js r163+, TypeScript, TSL (Three.js Shading Language)  
**Last active**: 2024

## Why It Matters

TSL is Three.js's new node-based shader system (WebGPURenderer). tslfx is a collection of composable VFX nodes built on it — fire, sparks, smoke, energy waves. This represents the direction Three.js is heading for shader authoring.

## What to Cherry-Pick

- **Energy wave** and **distortion** nodes for reactive audio visualizer backgrounds
- The **composition pattern** — stacking effect nodes is cleaner than monolithic GLSL
- Inspiration for translating the existing Nebula Flow / Aurora Waves modes into TSL nodes

## What to Avoid

- Requires `WebGPURenderer` — not backwards compatible with `WebGLRenderer` which we currently use
- Don't migrate unless specifically targeting WebGPU support; keep WebGLRenderer for compatibility

## Notes

File this under "future" — worth revisiting when WebGPU lands in stable Chrome without flags.

*Evaluated: 2026-06-12*
