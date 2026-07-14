# lightning-vfx — GPU Lightning Shader (Three.js)

**URL**: https://github.com/SahilK-027/Lightning-VFX  
**License**: MIT  
**Stack**: Three.js, GLSL  
**Last active**: 2024

## Why It Matters

Reference implementation for a GPU-computed branching lightning bolt using Three.js. Directly relevant to the **Electrical Storm** background mode in `public/js/background.js`.

## What to Cherry-Pick

- The recursive branching algorithm for bolt geometry
- The glow pass / bloom approach (additive blending + emissive material)
- Audio-reactive bolt thickness — tie amplitude to `line.geometry` scale

## What to Avoid

- Copies of the full shader verbatim — adapt and credit
- Any dependency on Three.js `EffectComposer` from the examples (requires separate import)

## Notes

Current Electrical Storm mode is canvas-based. If upgrading to a WebGL lightning effect, start here.

*Evaluated: 2026-06-12*
