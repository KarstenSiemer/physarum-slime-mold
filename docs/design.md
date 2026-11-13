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
                             model/ params.ts (schema = single source of truth), presets.ts, url.ts, link.ts, color.ts
```

- `model/params.ts` defines every parameter once: key, label, unit, range, default, help
  text, paper reference. UI controls, URL validation and GPU uniform packing all read it.
- `engine/types.ts` defines the `Backend` and `Sim` interfaces. Both backends pass the same GPU
  test suite (`src/engine/sim.gpu.test.ts`).
- Food, light and walls are a list of edits in the engine: preset shapes and painted strokes, each
  with the arena it was painted in. Every new simulation (new grid, density or arena) paints the
  whole list before it places its agents. On another grid an edit goes through the canonical frame
  of the arena it was painted in, whatever arena runs, turned on a portrait grid: a dish keeps its
  short side as the unit, a box or a periodic grid stretches with the grid. After every erase or
  wall, the edits that later strokes cleared completely on the grid on screen leave the list (the
  sweep, ADR 0019). A stroke on a copy of a periodic grid, which the view shows around the grid, is
  kept where the copy shows it, inside the grid. The scene card counts food, light and walls that
  differ from the scene's as a change. `Sim.paint` takes the edits that the simulation does not
  hold yet in one call and writes `env` and the renderer's outlines together: WebGPU outlines each
  segment right after its paint, WebGL2 a run of segments after the run's paint, with the bytes of
  one segment after another (ADR 0009, item 11).
- The page address is a link to the settings, the scene and the engine's edit list:
  `#s=<settings>&e=<drawing>` (`model/url.ts`, `model/link.ts`, ADR 0021). The engine paints and
  records every stroke on whole steps of 1/16 cell, so the link holds the list exactly and paints
  the sender's grid as the sender's list. It names the scene's shapes by the scene, the revision
  of its shapes and one bit each, so an old link paints the shapes it was made with after a scene's
  shapes change (ADR 0027). A drawing too large for a link stays out of it: the link then holds the
  settings and the scene as it loads, and the app says so.
- One rAF loop: paint new edits → run _k_ simulation steps → render one frame. A frame renders only
  when it shows something new (a step, an edit, other settings, another view or canvas size, other
  auto levels) and for 30 frames after; paused, the canvas keeps its picture and the stats line reads
  "paused" (ADR 0028). The loop starts no frame while two frames are still on the GPU: the next one
  runs the steps of the time since the last. The sort of the agents (WebGPU, every 32 steps) takes
  the place of one step in its frame, so that frame stays inside a refresh interval. _k_
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
  It counts only active time (tab visible, not paused, no rebuild, no lattice), decides at 3, 6, 10
  and 15 s of it, restarts its window after a reset or rebuild, and never lowers a grid the user
  picked or a lattice.
- The scenes of Jones run on the lattice of their figure (ADR 0026): 200 × 200 cells for Fig. 4, 5,
  16, 18 and 19, 300 × 300 for Fig. 21 and 22, on every screen, because Jones' lengths are in cells.
  The other scenes use `resolution` cells on the long side of a grid shaped like the screen. The
  view fits a lattice into the canvas with free space beside it; around a periodic lattice its
  copies show dimmed. Below the grid choice, a scene on another grid says why its result differs
  from the paper and offers its lattice again. A lattice that the device cannot hold becomes a grid
  shaped like the screen, and a notice says so.

## 3. Simulation on the GPU

Grid `W × H` cells (any size, not only powers of two): a lattice of fixed size, or `resolution`
cells on the long side in the canvas's aspect (`gridOf()` in `src/engine/sizing.ts`). Up to 4
strains (one `vec4` lane each).

### Buffers and textures

| Resource           | Format                                           | Size             | Use                                                   |
| ------------------ | ------------------------------------------------ | ---------------- | ----------------------------------------------------- |
| `agents[2]`        | storage, `{pos: vec2f, heading: f32, meta: u32}` | 16 B × N each    | `meta`: strain (2 bit), alive (1 bit), id (24 bit)    |
| `trail[2]`         | `rgba32float` texture, ping-pong                 | 16 B × W × H     | chemoattractant per strain                            |
| `scent[2]`         | `rg32float` texture, ping-pong                   | 8 B × W × H      | food attractant (r), light repellent (g)              |
| `counts`           | storage `atomic<u32>` × 4 per cell               | 16 B × W × H     | agents that moved into the cell this step, per strain |
| `env`              | storage `u32` per cell                           | 4 B × W × H      | packed bytes: wall (from 128 on), food, light         |
| `shape`            | storage `u32` per cell (WebGL2: `RGBA8` texture) | 4 B × W × H      | renderer only: outline distances, light, wall shadow  |
| `occ[2]`, `claims` | storage `u32` per cell                           | 4 B × W × H each | occupancy and move claims                             |
| `params`           | uniform                                          | < 1 KiB          | all parameters, packed from `params.ts`               |
| `clearance`        | storage `u32` per 8 × 8 tile (WebGL2: `R32F`)    | 2 × 4 B per tile | wall in the tile; distance to walls (ADR 0020)        |
| growth (while on)  | storage per cell and agent (WebGL2: targets)     | 34 B × W × H     | window counts, births, sums; 6 B per agent (ADR 0025) |
| view trail, scent  | `rgba32float`, `rg32float` (WebGL2: targets)     | 24 B × W × H     | moving first with 2+ passes only: the view (ADR 0027) |
| flow (while on)    | `rgba32float` textures: memory × 2, pressure × 3 | 80 B × W × H     | flow in the tubes, extended model only (ADR 0029)     |

`occ[2]` and `claims` are allocated with the simulation, even with collisions off (WebGL2: only
with float blending). N is the capacity: the most agents the simulation holds, alive and dead
(ADR 0025). The first agents of each strain, as many as Agents per cell gives, start alive; the
others wait dead for growth and the inoculate tool. Without a Capacity above Agents per cell, N is the
start population, as before. `shape` is written by the brush next to `env`: the signed distances to the
wall and food outlines (±4 cells), the light and the drop shadow of the walls. Only the renderer
reads it, so outlines are smooth at any zoom while the model stays cell-exact (ADR 0009). Its
bytes are held to `env`: inside exactly where `env` holds the wall or food, and no outline nearer
than the cells of `env` allow, so nothing of an erased stroke stays. A stroke's distance counts
only as far as the cells it paints allow, so a stroke beside the edge of a box or the rim of the
dish changes no outline where it paints no cell. After a change of boundary,
and after a replay of edits painted under another boundary, they are held to `env` again under
the boundary on screen.

`rgba32float` and not `rgba16float`: with half floats `x · (1 − 0.0001)` rounds back to `x`,
so the small decay values from Jones Fig. 12 would stop working.

`clearance` (with `walled`, which marks the tiles that hold a wall cell) is measured again after
every paint with a wall, after a paint with the eraser while a wall was painted since the last
clear, and after `writeEnv` with walls. A walk of a move or a sensor whose cells all lie nearer to
its start than the clearance of the start's tile cannot meet a wall and is skipped. The passes
that measure it, and the agent passes that check for walls, are built at the first wall (ADR 0020).

### One step

Each scene runs the order of a step of its paper (`stepOrder`, ADR 0027), in both models. The
textures always hold the map as the agents sense it.

- **Move first** (the eight scenes of Jones 2010, p. 133): every agent moves and deposits, then
  every agent senses and turns, then the trail map diffuses. The textures hold the last diffusion
  plus the deposits, food and light of the last moves. So a step senses and turns for the moves of
  the step before, moves, diffuses, and then adds the deposits and sources of its own moves. The
  first step after a reset moves with the start heading, as Jones' first step does.
- **Sense first** (Jones 2011, p. 1350, and his later papers, Fogleman, every other scene and the
  default settings): every agent senses and turns, moves and deposits, then the map diffuses with
  the step's deposits and sources. The textures hold the map after the diffusion, and every step
  senses, the first too.

1. `clearBuffer(counts)` (and `claims` in collision mode).
2. **Agent pass** (1 thread per agent, 256 per workgroup, 2-D dispatch above 65 535 groups):
   - skip dead agents; apply shrinkage (`p_remove`), then the agent tools (ADR 0023): inoculation
     takes dead agents of its strain into the brush, cut takes the agents of a wound out of it. Such an
     agent spends its step there: no move, no deposit;
   - **sense** at F, FL, FR (moving first, not in the first step after a reset):
     `s = dot(trail, A[strain]) + food·scent.r − light·scent.g`,
     walls and the outside read as −∞; in the extended model also a wall on the way to the
     sensor (ADR 0020). With trail saturation K ≥ 1 (extended model only) each lane of `trail`
     reads as `t / (1 + t / K)`. The Jones model packs Jones' one trail map: its one strain weighs
     food as its own trail, and light has no weight (ADR 0022);
   - **rotate** with the Jones rule (exact, see knowledge base); random turn with `pCD`;
   - **move** by SS; wrap (periodic) or block (closed box, dish, wall, also a wall cell on the
     way);
   - blocked: random new heading, no deposit. Success: `atomicAdd(counts[cell][strain], 1)`.
3. **Claim pass** (collision mode only, Jones' one agent per cell): pass 2a sets the
   heading and calls `atomicMax(claims[target], key)` with a unique per-step key (bijective
   hash of the agent id). Pass 2b moves the winners. Free target = empty at step start.
   An agent that a tool places or moves claims its cell the same way, and a loser stays dead or
   where it was (ADR 0023). Deterministic: integer atomics and unique keys.
4. **Diffuse pass** (16 × 16 tiles with a 1-cell halo in workgroup memory; on an M3 Pro the
   tile saves about 25 % of this pass, see
   [webgpu-platform.md](knowledge-base/webgpu-platform.md#swiftshader-and-the-tiled-diffuse-pass-measured-2026-11-09)),
   repeated `passes` times (Jones 1, Fogleman 2): the 3 × 3 mean of 9 cells at every site of the
   arena (Jones' mean filter), then on the last pass `× (1 − decay)`. Moving first, the last pass
   then adds `counts · deposit`; sensing first, the first pass adds it before the mean.
   Outside a closed arena the cells hold 0, so trail and scent that leave it are lost (absorbing
   edges, Jones 2011). Walls diffuse as part of the lattice in the Jones model and are sinks that
   hold 0 in the extended model; they take no deposit or source (ADR 0027). The same for `scent` with
   `food · 255 · wProj · g` and `light · 255 · wLight · g` as sources. In the Jones model g = 1,
   the scent decays with the strain's decay and light has no source, so trail + scent is Jones'
   one trail map (ADR 0022). In the extended model `g = d / 0.1` moving first and
   `g = (d / (1 − d)) / (0.1 / 0.9)` sensing first, with the scent decay d, so a large food reaches
   the same scent at every decay in either order (ADR 0027). The cut tool
   clears trail and scent in the wound only in the extended model. With covered food on, a food
   cell releases the covered-food factor (0.001 by default, Adamatzky and Jones 2010) while the
   3 × 3 window around it holds an agent after the moves (the occupancy comes from collision mode,
   else from the `occupy` pass).

Between 3 and 4, on the steps whose number is a multiple of Gf or Sf and only while growth is on
with the rule, **growth and shrinkage** (Jones 2011, Sec. 5.1; ADR 0025, `growth.wgsl`,
`gl/glsl/growth.frag`): a separable box sum of the occupancy after the moves gives each cell the
agents in its Gw × Gw and Sw × Sw window, its own agent included. Shrinkage deletes an agent whose
count lies outside [Smin, Smax]. A survivor that moved in this step and counts [Gmin, Gmax] claims a
random empty habitable cell of its 3 × 3 neighbourhood with the key of a move. The winners write
births; two pyramids of sums with a fan-in of 4, over the births (one lane per strain, in an order
that a new bijection of the cells gives every step) and over the dead agents (by id), let the dead
agent with rank r of a strain take the birth with rank r of that strain. The child gets a random
position in its cell and a random heading and deposits nothing in its step. Then the occupancy and
the alive count are counted anew. A step without a test runs no new pass.

After 4, only while **Flow in the tubes** is on in the extended model (ADR 0029, `flow.wgsl`,
`gl/glsl/flow.frag`; `flow-reference.ts` mirrors both for the tests): the grid is a network whose
cells conduct by g = B (0.02 + D), with the tube body B (the trail smoothed over time; no tube below
0.05) and the flow memory D. A food site is the centre cell of a food stroke; the colony covers it
while that cell holds a tube. `update` takes the flux of each cell from the pressure of the step
before, adapts D as Tero et al. do (dD/dt = f(Q) − D, f(Q) = Q^1.8 / (1 + Q^1.8)) while at least two
sites give or take, and writes the body, the conductivity and the roles: among the covered sites as
many give the flux I0 (Flow strength) as take it, in four pressure fields with their own draws, drawn
again every 300 steps (`flowRoles()` in `flow.ts` is the same rule for the tests). Then `pressure`
runs 16 times: a damped Jacobi iteration of Kirchhoff's law from the pressure of the step before,
with a momentum term on the cells that conduct. A site gives or takes only up to a pressure limit, so
no part of the network runs away from the rest. The agent passes read D of the step before: in step 2
an agent on a cell with low D dies with a chance of up to 2 % per step, and a dead agent draws one
random cell and comes to life there if the cell is open, holds a tube and has D above 0.5. With
growth, an agent on a cell with D below 0.01 does not divide. The lines of the flow in `agents.wgsl`
and `growth.wgsl` stand between `//#if FLOW` markers; a pass without the flow compiles from the
source without them (`shaders/variant.ts`), so it keeps its bytes. Thirty steps stand for one minute
of model time.

All random numbers come from a PCG hash of `(seed, step, agent id)`. The whole step is
deterministic on one GPU: integer atomics make the deposit order-independent. Every 32 steps a
counting sort by 8 × 8 tiles reorders the agents into the second buffer, so agents near each
other on the grid run together and hit the cache (ADR 0005). The model reads only the id, never
the buffer slot.

### Initial layouts

`mixed` (uniform), `bands` (strains side by side), `sectors`, `colonies` (one disc per strain),
`ring`, `center`, `empty` (every agent starts dead; the inoculate tool places them), `food` (every
agent starts dead, and one step of the inoculate tool places about 50 agents of strain A on the
first food, at half the density of a full sheet; ADR 0025). An agent whose cell is a wall or outside
the arena draws again in its layout's region. In collision mode claim rounds give every alive agent
a cell of its own, in every layout (ADR 0008, ADR 0019). A dish counts its agents over the square of
its short side, as Jones counts %p; a box or a periodic grid over all its cells.

## 4. Interaction

| Area                | Controls                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Playback            | play/pause, single step, speed (steps per second), reset, new seed                                            |
| Scene               | presets, scene card, agent count, grid, layout, boundary, the rule, model; extended: scent decay, K           |
| Strains (1–4 cards) | color, SA, SO, RA, SS, deposit, decay, random turn, sensor diagram; extended: share, food and light weight    |
| Interactions        | strain × strain attraction matrix (−2 … +2) with quick presets (extended model, several strains)              |
| Environment         | food strength, covered food, random shrinkage; extended: diffusion passes, light strength                     |
| Growth              | growth and shrinkage (Jones 2011) with Gf, Gw, Gmin, Gmax, Sf, Sw, Smin, Smax; capacity                       |
| Tools               | pan/zoom, inoculate (selected strain, uses only dead agents), food, light (extended), wall, erase, cut; brush |
| Look                | style (glow, gel relief, paper, agents), palette, background, exposure (auto), bloom; scent view (toolbar, S) |
| Learn               | what Physarum is, Jones 2010 and the six sub-steps, parameter help, every scene with its source and settings  |
| Share               | the page address as a link: settings, scene, food, light and walls (ADR 0021); PNG export                     |

Guided experiments (each sets a preset, an environment and a text that says what to watch):
dynamic network (Fig. 4), hexagonal minimization (Fig. 5), scale by SO (Fig. 10), SA × RA
classes (Fig. 13), repulsion spots and stripes (Fig. 16), shortest path between two foods
(Fig. 18), Steiner tree (Fig. 19), shrinking sheet (Fig. 21), wound repair (Fig. 22–23),
competing strains (Fogleman presets).

While the pointer is held, inoculate and cut act on every step. Inoculate uses only dead agents. It
places an amount per second of holding at any frame rate. With none left, a notice says so. A
Capacity above Agents per cell keeps dead agents in a full scene, so the tool works there too, and
growth brings dead agents to life as well (ADR 0025). While
paused, a held tool runs 60 steps per second; inoculate runs none while every agent of its strain
lives (ADR 0023), and no tool runs any beside a closed arena, where it reaches no cell. On a
periodic grid the tools act on the cells under the pointer, also on a copy of the grid and across
its edges (ADR 0026).

Keyboard: Space pause, `.` step, R reset, 1–7 tools, `[`/`]` brush size, F fit view, S scent view, H hide UI, L Learn.
A key is a shortcut unless the focused element uses it: a field takes every key, a button Space and Enter, a slider
the arrows.

## 5. Look

- The view fits the grid into the canvas, centred. Beside a closed arena the free space shows a
  dark background; around a periodic lattice its copies show at 0.15 of their light, so a tool
  on a copy paints where the copy shows it (ADR 0026). A grid shaped like the screen shows its
  copies as they are when zoomed out.
- Zoomed out, above 1 cell per pixel, a pixel shows the mean of the trail over its square: from the
  trail itself up to 2 cells per pixel, above from a coarser map of the mean over 2, 4, 8 or 16 cells
  per side, filled only when the trail changed (ADR 0009, amendment of 2026-11-12).
- The view draws the map after the step's diffusion in either order (ADR 0027). Sensing first
  the trail and scent are that map. Moving first they hold the map as the agents sense it; once
  per frame after a change, the step's diffusion passes without sources (`VIEW`) write the map
  after the diffusion, trail and scent, into the free pair and, from a second pass on, a third
  one. The render pass, height field, glow, auto levels, the scent view (its glow, line, coarse
  map and strand) and PNG read it; the simulation never does.
- Linear-light compositing: radiance `L = Σ trail_s · gain · color_s`, then tone mapping,
  then sRGB encoding. Overlaps turn white-hot instead of clipping.
- **Auto levels**: black at the 65th, white at the 99th percentile of a GPU histogram, smoothed
  (the GPU version of Fogleman's percentile levels; tuning evidence in ADR 0009).
- Bloom: thresholded, normalised mip chain on a half-resolution `rgba16float` target.
- Gel relief style: trail as a height field, normals from finite differences, wet specular
  highlight; yellow plasmodium on dark agar.
- Paper style: dark trails on white, like the figures in Jones 2010.
- Food and walls (ADR 0009): outlines rebuilt from distances with a smooth spline, one pixel of
  anti-aliasing at any zoom, every cell centre on the side of the outline that `env` holds. Food
  is an oat flake below the trail (grain, a lit rim), which also shows through the gel style's
  trail; walls are bevelled ridges lit like the gel, with a soft drop shadow, and the trail goes
  on up to them. In collision mode, agents sitting on food are drawn as trail at a fixed level
  (they deposit nothing, Jones 2010, p. 133), and the agents style also shows the agents that
  stayed put. Without anything painted the render pass runs without this code.
- Scent view (ADR 0009, amendment and revision of 2026-11-11): a switch of the look draws the food scent as a green
  glow and the light repellent (extended model only) as a pink glow over the picture, below the oat flake and the
  walls. The glow rises with log10 of the scent from 0 at 0.01 to its top at 10,000, on a fixed scale, so scenes and
  models compare. One thin line marks where the food steers an agent across its left and right sensors as hard as a
  strand of trail holds it (the strand: the 99th percentile of the trail that the auto levels measure). A legend shows
  the scale, what the line means and what the scene holds. Zoomed out the view reads a coarser map of the scent, filled again only when the scent changed. It changes
  nothing in the simulation, goes into the link like the style, stays on when a scene loads, and without it the
  render pass draws the pixels of before at the same cost.
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

- mass balance: `Σ trail' = (1 − decay) · Σ trail + deposit · Σ counts` with periodic
  boundary, moving first, and `Σ trail' = (1 − decay) · (Σ trail + deposit · Σ counts)` sensing
  first (ADR 0027);
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
