# Event Horizon

A Schwarzschild black hole ray-traced in real time with three.js.

Every pixel traces a light ray backwards from the camera through curved spacetime, so the lensing is computed, not faked: the far side of the accretion disk bends up over the shadow and down beneath it, the photon ring shows up as a thin line around the shadow, and the starfield smears into Einstein arcs. The disk is shaded with blackbody colours, relativistic Doppler beaming, gravitational redshift and Keplerian shear.

```bash
npm install
npm run dev
```

**Controls:** drag to orbit · scroll to zoom · `G` toggle gravity (watch spacetime un-bend) · `Space` auto-rotate · `H` hide UI. The panel has view presets and sliders for the disk, sky and post-processing.

## How it works

- `src/shaders/blackhole.frag.glsl` draws the whole scene in one full-screen quad. Light rays follow `x'' = -3/2 h² x / r⁵`, which gives exactly the Schwarzschild photon orbit equation in plain Cartesian coordinates. The step size adapts to distance from the hole, and a ray stops when it falls through the horizon, escapes, or has passed through enough disk to be opaque.
- Stars are blurred to the size of their pixel footprint on the sky (`fwidth` of the bent ray direction), with their total brightness preserved. That anti-aliases them, and in strongly lensed regions it lets them fade into a smooth glow.
- Post-processing: UnrealBloom on the HDR image, then ACES tone mapping, then a finishing pass that adds vignette, chromatic fringing and grain.
- Adaptive resolution lowers the render scale on slower GPUs to keep the frame rate up.
