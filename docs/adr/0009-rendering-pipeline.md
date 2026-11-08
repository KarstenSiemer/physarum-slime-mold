# 0009: Rendering pipeline

- Status: accepted (revised 2026-11-08 after the visual review loop)
- Date: 2026-11-08

## Context

Trail values span orders of magnitude: thin side branches next to dense nodes, and the scale
changes with deposit, decay, density and strain count. Fogleman normalises each species to a
percentile range and applies gamma 1/2.2, then adds species colors and clamps
([variants](../knowledge-base/variants.md#michael-fogleman-2020-go)). Clamping in sRGB loses
highlights and gives banding in dark gradients.

Measured in the gallery loop (`npm run gallery`, contact sheets reviewed by eye):

- With only a white level (99th percentile), Jones' dense presets looked washed out: their
  lacunae hold trail too. A black level at the 25th percentile did not help (it lies inside the
  lacuna values); the median helped partly; the 65th percentile gave dark lacunae.
- An unthresholded bloom that summed five blur levels added about three times the scene
  energy: 0 % dark pixels on the hexagon preset (mean luminance 120). With a threshold and
  normalisation: 22 % dark pixels (mean 60) at the same strength, sparse scenes still glow.

## Decision

1. **Render pass** (canvas resolution): sample the trail (manual bilinear, because
   `rgba32float` is not filterable everywhere; four taps when zoomed out), apply auto levels,
   then `L = Σ_s trail_s · gain · color_s` in linear light, per-channel tone curve
   `1 − e^(−x)` (overlaps turn white-hot), sRGB encoding, triangular dither of ±1 LSB.
2. **Auto levels**: a log₂ histogram of the summed trail (compute shader with workgroup bins on
   WebGPU; a 160-wide sample grid read back on WebGL2) every few frames, read back without
   stalling. Black = 65th percentile, white = 99th percentile → radiance 1.3; smoothed over
   time. Sparse networks have > 65 % empty cells, so their black level stays 0. `settle()`
   measures at once for exports. A manual exposure offset (EV) remains.
3. **Bloom** (glow style only): trail-space mip chain on half resolution (`rgba16float`),
   prefilter keeps only radiance above 0.5, dual-filter down/up sampling, sum divided by the 5
   levels, added per strain before the tone curve, strength 0–2 (default 1).
4. Styles: _glow_ (dark background), _gel_ (height-field normals, wet specular highlight),
   _paper_ (Beer–Lambert ink on white, like the paper's figures), _agents_ (agent counts).
5. Strain palette: gold, cyan, coral, violet at similar lightness; OKLCH helper for new colors.

Not done: HDR canvas output (`rgba16float` + extended tone mapping exists only in Chrome 129+;
Firefox has neither). Listed under "later" in TODO.

## Consequences

- One full-screen pass plus five small bloom passes per frame, independent of the step count.
- Every preset is exposed without manual tuning, because levels follow the data.
- Screenshot comparisons must call `settle()` first; the gallery and PNG export do.
