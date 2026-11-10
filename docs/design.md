# Design: Physarum simulator for the browser

Status: plan, 2026-11-08. Decisions are recorded in [`docs/adr/`](adr/). Facts and sources are
in [`docs/knowledge-base/`](knowledge-base/). Progress is tracked in [`TODO.md`](../TODO.md).

## 1. Goal

An interactive and informative web page that simulates the plasmodium of _Physarum
polycephalum_ with the Jones (2010) agent model, with millions of agents in real time on the
user's GPU. The user places several **strains** (species) side by side, picks their colors and
behaviour, adds food, light and walls, and sees transport networks form, compete, shrink and
heal. Short texts explain what happens and why.

Quality bar:

1. Performance: ≥ 60 frames/s with ≥ 2 M agents on a 2024 laptop GPU (Apple M-series,
   integrated Intel/AMD); scales to 16 M agents on discrete GPUs.
2. Fidelity: reproduces the paper's behaviours (table in
   [jones-2010-model.md](knowledge-base/jones-2010-model.md#results-to-reproduce)).
3. Visual quality: crisp filaments, no banding, good exposure for every preset.
4. Interaction: every parameter changes live; tools work with mouse, touch and keyboard.
5. Runs in current Chrome, Edge, Safari and Firefox. Static hosting, no backend.

Non-goals: 3-D simulation, server-side rendering, user accounts, analytics.

## 2. Architecture

```
index.html ── main.ts ── App.svelte ── ui/ (Svelte 5: Panel, StrainCard, Matrix, Toolbar, Learn)
                             │
                             └── engine/engine.ts   settings, frame loop, view, tools (backend-independent)
                                    ├── webgpu.ts   WebGPU backend: sim.ts, render.ts, bloom.ts, exposure.ts, shaders/*.wgsl
                                    └── gl/         WebGL2 fallback: sim.ts, backend.ts, glsl/*.{vert,frag} (ADR 0003)
                             model/ params.ts (schema = single source of truth), presets.ts, url.ts, color.ts
```

- `model/params.ts` defines every parameter once: key, label, unit, range, default, help
  text, paper reference. UI controls, URL validation and GPU uniform packing all read it.
- `engine/types.ts` defines the `Backend` and `Sim` interfaces. Both backends pass the same GPU
  test suite (`src/engine/sim.gpu.test.ts`).
- Food, light and walls are a list of edits in the engine: preset shapes and painted strokes, each
  with the boundary it was painted under. Every new simulation (new grid, density or arena) paints
  the whole list before it places its agents. On another grid an edit goes through the canonical
  frame of the list's arena, turned on a portrait grid: a dish keeps its short side as the unit, a
  box or a periodic grid stretches with the grid. The list's arena is the preset's own arena, or
  that of the first stroke after a Clear (ADR 0019). A stroke on a copy of a periodic grid, which the
  view shows around the grid, is kept where the copy shows it, inside the grid.
- One rAF loop: paint new edits → run _k_ simulation steps → render one frame. _k_
  follows the speed, within a budget of steps per frame that the GPU keeps up with
  (`src/engine/budget.ts`): with two frames still on the GPU at the next frame it drops by a
  quarter (to at least 1), with the GPU idle for over a third of the last frame interval it rises
  by 1/8 (to at most 16). It starts at 1 and stays at most one step above the steps of the last
  frame, so it rises past the speed only while it is the limit. A slow GPU then lowers the
  simulation speed instead of the frame rate. Steps it could not run are dropped, not caught up
  later: after a pause in rendering (a hidden tab) or a speed raise, a frame runs at most one
  step more than the frame before, and the steps follow a raise at 1/8 step per frame.
- A startup check (`src/ui/tune.ts`) lowers the grid one step, at most twice and not below 512
  cells, when over a window of at least 2 s the frame rate is below 40 fps or fewer than 3/4 of
  the steps the speed asked for ran. The requested steps are summed per frame (speed times frame
  interval, at most 16), so a speed change inside the window counts from when it happened; steps
  the budget held back while the GPU had time to spare (the budget still rising) do not count. A
  browser can give fewer than 40 fps whatever the grid (iOS Safari gives 30 in Low Power Mode,
  and Chrome's Energy Saver lowers the frame rate too). The frames that started with no frame on
  the GPU show that rate; when they are at least half of the window, 90 % of their rate is enough.
  It counts only active time (tab visible, not paused, no rebuild), decides at 3, 6, 10 and 15 s
  of it, restarts its window after a reset or rebuild, and never lowers a grid the user picked.

## 3. Simulation on the GPU

Grid `W × H` cells (any size, not only powers of two). Up to 4 strains (one `vec4` lane each).

### Buffers and textures

| Resource           | Format                                           | Size             | Use                                                   |
| ------------------ | ------------------------------------------------ | ---------------- | ----------------------------------------------------- |
| `agents[2]`        | storage, `{pos: vec2f, heading: f32, meta: u32}` | 16 B × N each    | `meta`: strain (2 bit), alive (1 bit), id (24 bit)    |
| `trail[2]`         | `rgba32float` texture, ping-pong                 | 16 B × W × H     | chemoattractant per strain                            |
| `scent[2]`         | `rg32float` texture, ping-pong                   | 8 B × W × H      | food attractant (r), light repellent (g)              |
| `counts`           | storage `atomic<u32>` × 4 per cell               | 16 B × W × H     | agents that moved into the cell this step, per strain |
| `env`              | storage `u32` per cell                           | 4 B × W × H      | packed bytes: wall (from 128 on), food, light         |
| `occ[2]`, `claims` | storage `u32` per cell                           | 4 B × W × H each | occupancy and move claims                             |
| `params`           | uniform                                          | < 1 KiB          | all parameters, packed from `params.ts`               |

`occ[2]` and `claims` are allocated with the simulation, even with collisions off (WebGL2: only
with float blending).

`rgba32float` and not `rgba16float`: with half floats `x · (1 − 0.0001)` rounds back to `x`,
so the small decay values from Jones Fig. 12 would stop working.

### One step

1. `clearBuffer(counts)` (and `claims` in collision mode).
2. **Agent pass** (1 thread per agent, 256 per workgroup, 2-D dispatch above 65 535 groups):
   - skip dead agents; apply shrinkage (`p_remove`), inoculation and cut tools;
   - **sense** at F, FL, FR: `s = dot(trail, A[strain]) + food·scent.r − light·scent.g`,
     walls and outside read as −∞;
   - **rotate** with the Jones rule (exact, see knowledge base); random turn with `pCD`;
   - **move** by SS; wrap (periodic) or block (closed box, dish, wall, also a wall cell on the
     way);
   - blocked: random new heading, no deposit. Success: `atomicAdd(counts[cell][strain], 1)`.
3. **Claim pass** (collision mode only, Jones' one agent per cell): pass 2a sets the
   heading and calls `atomicMax(claims[target], key)` with a unique per-step key (bijective
   hash of the agent id). Pass 2b moves the winners. Free target = empty at step start.
   Deterministic: integer atomics and unique keys.
4. **Diffuse pass** (16 × 16 tiles with a 1-cell halo in workgroup memory; on an M3 Pro the
   tile saves about 25 % of this pass, see
   [webgpu-platform.md](knowledge-base/webgpu-platform.md#swiftshader-and-the-tiled-diffuse-pass-measured-2026-11-09)),
   repeated `passes` times (Jones 1, Fogleman 2): `v = trail + counts · deposit` (first pass only),
   3 × 3 mean over non-wall cells, `× (1 − decay)` on the last pass. The same for
   `scent` with `food · 255 · wProj` and `light · 255 · wLight` as sources.

All random numbers come from a PCG hash of `(seed, step, agent id)`. The whole step is
deterministic on one GPU: integer atomics make the deposit order-independent. Every 32 steps a
counting sort by 8 × 8 tiles reorders the agents into the second buffer, so agents near each
other on the grid run together and hit the cache (ADR 0005). The model reads only the id, never
the buffer slot.

### Initial layouts

`mixed` (uniform), `bands` (strains side by side), `sectors`, `colonies` (one disc per strain),
`ring`, `center`, `empty` (paint with the inoculate tool). An agent whose cell is a wall or outside
the arena draws again in its layout's region. In collision mode claim rounds give every alive agent
a cell of its own, in every layout (ADR 0008, ADR 0019). A dish counts its agents over the square of
its short side, as Jones counts %p; a box or a periodic grid over all its cells.

## 4. Interaction

| Area                | Controls                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Playback            | play/pause, single step, speed (steps per second), reset, new seed                                               |
| Scene               | presets in groups, scene card, agent count (density readout), resolution, layout, boundary (wrap, box, dish)     |
| Strains (1–4 cards) | color, share, SA, SO, RA, SS, deposit, decay, random turn, food attraction, light avoidance, live sensor diagram |
| Interactions        | strain × strain attraction matrix (−2 … +2) with quick presets                                                   |
| Environment         | collisions (Jones), diffusion passes, food strength (wProj), scent decay, shrinkage                              |
| Tools               | pan/zoom, inoculate (selected strain), food, light, wall, erase, cut; brush size                                 |
| Look                | style (glow, gel relief, paper, agents), palette, background, exposure (auto), bloom                             |
| Learn               | what Physarum is, Jones 2010 and the six sub-steps, parameter help, every scene with its source and settings     |
| Share               | URL with full state, PNG export                                                                                  |

Guided experiments (each sets a preset, an environment and a text that says what to watch):
dynamic network (Fig. 4), hexagonal minimization (Fig. 5), scale by SO (Fig. 10), SA × RA
classes (Fig. 13), repulsion spots and stripes (Fig. 16), shortest path between two foods
(Fig. 18), Steiner tree (Fig. 19), shrinking sheet (Fig. 21), wound repair (Fig. 22–23),
competing strains (Fogleman presets).

Keyboard: Space pause, `.` step, R reset, 1–7 tools, `[`/`]` brush size, H hide UI.

## 5. Look

- Linear-light compositing: radiance `L = Σ trail_s · gain · color_s`, then tone mapping,
  then sRGB encoding. Overlaps turn white-hot instead of clipping.
- **Auto levels**: black at the 65th, white at the 99th percentile of a GPU histogram, smoothed
  (the GPU version of Fogleman's percentile levels; tuning evidence in ADR 0009).
- Bloom: thresholded, normalised mip chain on a half-resolution `rgba16float` target.
- Gel relief style: trail as a height field, normals from finite differences, wet specular
  highlight; yellow plasmodium on dark agar.
- Paper style: dark trails on white, like the figures in Jones 2010.
- Palettes in OKLCH (even lightness and chroma), plus Fogleman's palettes.
- Dither before 8-bit output against banding. HDR canvas (`rgba16float`, extended tone
  mapping) when the browser and display support it.

## 6. Testing (the development loop)

| Layer               | Tool                                                                                            | Runs where       |
| ------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| Types, lint, format | `tsc`, ESLint, Prettier, `svelte-check`                                                         | pre-commit, CI   |
| Unit                | Vitest (Node): params, URL parsing (fuzz), presets, colors, RNG, CPU reference model, engine    | pre-commit, CI   |
| GPU                 | Vitest browser mode, Chromium + `--enable-unsafe-webgpu` (Metal locally, SwiftShader in CI)     | CI, local        |
| E2E                 | Playwright: boot, no console errors, non-blank canvas, tools, presets, URL round trip, axe a11y | CI, local        |
| Visual              | Playwright screenshots at fixed seed/steps, reviewed by eye; pattern metrics as asserts         | local loop       |
| Performance         | steps/s via `timestamp-query`, JSON report                                                      | local (real GPU) |

GPU tests compare against a small CPU reference model and check invariants:

- mass balance: `Σ trail' = (1 − decay) · (Σ trail + deposit · Σ counts)` with periodic
  boundary;
- agent conservation; at most one agent per cell in collision mode;
- determinism: two runs with the same seed give identical buffers;
- behaviour: networks form (coefficient of variation rises), pattern wavelength grows with
  SO (Fig. 10).

## 7. Delivery

- GitHub Actions: lint, unit, GPU and e2e tests on every PR; build and deploy to GitHub
  Pages from `main`.
- Renovate PRs run the same checks and auto-merge when green.
- pre-commit hooks for fast checks; the full suite runs in CI.
- Security: strict CSP, no third-party code at runtime, validated URL state, pinned and
  hardened workflows. Details in the ADRs.
