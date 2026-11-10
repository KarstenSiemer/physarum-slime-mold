# 0019: Food, light and walls survive a new grid; agents start on cells of their own

- Status: accepted (the mapping rule is the maintainer's decision for the owner, who can revisit it)
- Date: 2026-11-10

## Context

Owner report, item 6: load the Maze, change the grid, and the walls and the food are gone. Food,
light and walls lived only in the environment buffer of one simulation (`src/engine/sim.ts`, `env`;
WebGL2 `gl/sim.ts`, an RGBA8 texture), and the engine kept no copy. Every change of grid or density
built a new simulation with an empty one. So did turning the one-agent-per-cell rule on above one
agent per cell (it caps the density), the startup check, the memory fit (also when the canvas had
changed shape and a later setting fed the new aspect into `fit()`) and the out-of-memory step-down.
Nothing painted it again. The research measured it with a CPU copy of the engine on a 16:10 canvas:
after 512 → 1024 the Maze had none of the 16,617 wall cells and 828 food cells of a fresh load.

Defects on the same paths and at the start of a simulation, measured on WebGPU and WebGL2 on the
base commit (seed 7; the two backends gave the same numbers):

- A preset placed its agents before it painted its walls: 394 agents of the Maze started inside a
  wall on 512 × 288, 551 on 236 × 512.
- A stroke drawn while a new grid was allocated was painted in cells of the old grid. A stroke
  queued in the same frame before "Clear" was painted after it.
- Preset shapes sat at fractions of the grid's width and height, so their layout followed the
  screen: Steiner's four foods formed a square only on a window of 1.3:1, one food of Shrinking
  plasmodium lay outside the dish on phones, and on a tall screen the Shortest path foods sat
  across the short side.
- A dish counted its agents over the whole grid, but agents live only in the dish: Shrinking
  plasmodium started with 73,728 agents for about 64,000 dish cells on 512 × 288.
- With one agent per cell only the mixed layout started agents on distinct cells. Shrinking started
  with 19,563 shared cells and 416 dead agents on 512 × 288 (17,296 and 1,114 on 236 × 512), Shortest
  path and Steiner tree with 1 to 14 shared cells and 5 to 9 dead agents, and the Transport network
  with 2 shared cells on 1024 × 576: `cellCoord(c)` plus an offset just below 1 rounds into the next
  cell in f32 from coordinate 256 on.
- A move checked only its destination for a wall, so a step longer than a wall is thick jumped it.
- WGSL counted any wall byte above 0 as a wall, GLSL only bytes of 128 and more.

## Options

1. **Keep every edit and paint it again on every new simulation.** Exact on the same grid, sharp
   edges on a finer one, no new GPU resources. Cost grows with the number of edits.
2. Read the old environment back and resample it into the new grid. Cost does not grow, but the
   research measured one round trip 512 → 256 → 512 of the Maze with 34 % more wall cells and 21 %
   more food cells, and a finer grid keeps the coarse staircase.

For an edit on another grid than the one it was painted on:

1. Positions in fractions of width and height: circles turn into ellipses when the shape of the
   screen changes, and a preset's layout follows the screen (the defects above).
2. **A canonical frame of the grid's short side**, turned on a portrait grid: a similarity
   transform.
3. The scale of the larger axis for strokes and the short side for presets (an earlier draft):
   the two drift apart when the screen turns.

## Decision

Option 1 with the canonical frame.

- **Edit list.** `Engine` (`src/engine/engine.ts`) keeps every edit since the last "Clear" or
  preset load: preset shapes in the canonical frame (`fromShape`), strokes in the cells of the grid
  the view shows (`fromStroke`, `paint()` at line 233), each with the boundary it was painted under
  (`Stroke.boundary`; both backends write it into the parameters of the paint pass). Every new
  simulation paints the whole list (`flushEnv()`, line 240) before it places its agents
  (`rebuild()`, line 180; `load()`, line 104). A frame paints the edits added since. "Clear" empties
  the list, also during a rebuild; a preset load replaces it. `Engine.paint` before the first
  simulation exists drops the stroke: no grid is on screen yet. On a periodic grid the view shows
  copies of the grid around it, and a stroke on a copy paints the grid where the copy shows it. So
  `fromStroke` moves such a stroke by whole periods until it starts inside the grid. Before, its
  raw coordinates lay beside the grid, and every other grid skipped it as outside: 131 food cells
  painted left of a 512 × 320 grid were none on 1024 × 640 (CPU engine test; the GPU engine test
  failed the same way on both backends).
- **Mapping** (`strokeOn`, `src/engine/environment.ts`). On the grid an edit was made on, it is
  painted with its original coordinates, byte for byte. On another grid it goes through the
  canonical frame: landscape, origin at the grid's centre, unit the grid's short side. A portrait
  grid (height above width) turns the frame by 90° clockwise, so a layout along the long side of a
  wide screen stays along the long side of a tall one. Positions and radii scale by the ratio of the
  short sides, so circles stay circles and a food source keeps its area relative to the dish. An
  edit that lies completely outside the new grid is skipped and kept for other grids. Preset shapes
  are given in this frame (`src/model/presets.ts`), with values that put every shape where the old
  fractions put it on a 16:10 window. Steiner's foods form a square whose corners lie as far from
  the centre as the old rectangle's.
- **Radius.** A brush covers at least `MIN_RADIUS` = 0.75 cells, on live painting and on every
  replay. A cell that a segment passes through has its centre at most half a cell diagonal (0.71)
  from it, so a 0.75 brush paints every such cell: painted walls stay closed on any grid, also where
  they run diagonally (a unit test samples 400 random segments: no gap at 0.75, gaps at 0.45).
- **Replay cost.** `Sim.paint` takes a list and is the only way the engine puts an edit into a
  simulation (`Sim.writeEnv` is for tests). WebGPU
  paints up to 4096 strokes per submission: each dispatch picks its brush and its boundary's
  parameters by dynamic offset (`src/engine/sim.ts`, `paint()` at line 213). WebGL2 scissors every
  paint draw to the stroke's bounding box grown by one cell, split at the edges of a periodic grid
  (`src/engine/brush.ts`), and changes parameters, color mask and blending only where the boundary
  or the kind of brush changes. Measured on an M3 Pro, paired in one page, grid 1536 × 864, strokes
  of radius 10 cells and 4 cells long, until the GPU finished:

  | Strokes | WebGPU, one call per stroke | WebGPU, one call | WebGL2, one call per stroke | WebGL2, one call |
  | ------- | --------------------------- | ---------------- | --------------------------- | ---------------- |
  | 1,000   | 34.6 ms                     | 4.0 ms           | 6.7 ms                      | 4.5 ms           |
  | 10,000  | 332 ms                      | 30.4 ms          | 49.1 ms                     | 9.9 ms           |
  | 100,000 | 3,540 ms                    | 249 ms           | 1,310 ms                    | 79 ms            |

  The JavaScript part of one call took 0.4, 4.0 and 37 ms on WebGPU and 0.5, 4.8 and 48 ms on
  WebGL2. Without the scissor, WebGL2 painted 1,000 strokes one call each in 70.1 ms, with it in
  6.5 ms: every stroke was a pass over the whole grid.

- **Strokes far out, long strokes and large brushes.** On a periodic grid both paint passes measure
  a cell's distance to the stroke and to its copies one period away. That finds the nearest copy
  for a segment that starts inside the grid and spans at most half of it along each axis, so both
  backends paint a stroke as such segments (`paintSegments` in `src/engine/brush.ts`): a longer
  one is cut, and each part moved by whole periods. A zoomed-out view shows many copies, and a
  fast drag there gives a stroke longer than the grid. Before, WebGL2 painted nothing for a stroke
  two periods away while WebGPU did. WebGPU dispatches over the segment's box cut to the grid, or
  to one period on a periodic grid (`paintBox`), so a brush larger than the grid costs one pass
  over the grid: a brush mapped from grid 256 to 2048 (radius 15,360 cells) took 53.5 ms on a
  periodic grid and 12.1 ms in a box, now 0.6 and 0.4 ms (M3 Pro, paired). Where a brush stays
  inside the grid, WebGPU skips the copies. Paired against the code before, 100,000 strokes in one
  call took 208.4 against 198.5 ms on WebGPU and 53.1 against 50.4 ms on WebGL2 on a periodic
  grid, 192.2 against 181.5 and 49.9 against 47.8 ms in a box.

- **Growth.** A drag records a segment only once the pointer has moved half a brush radius from
  the end of the last one, and paints exactly what it records (`paintTo` in `src/App.svelte`).
  Before, it recorded one stroke per pointer event: 59.8 per second at 300 px/s and 60.3 at 30 px/s
  (Playwright on the built app, Chrome at 60 Hz, brush 18 px). With the rule 29.8 and 3.4. A kept
  edit takes about 160 bytes (Node heap). Three minutes of fast painting now record about 5,400
  edits: under 1 MB, repainted in about 20 ms on this machine.
- **A drag across a new grid.** The drag keeps the end of its last segment in canvas pixels and
  reads it in the grid on screen when the next segment starts (`BrushDrag` in `src/ui/drag.ts`).
  When a new grid is built during a drag (the startup check lowers the grid in the first
  seconds), the next segment runs along the pointer's path. Before, it ran from the last point in
  cells of the old grid to the pointer in cells of the new one: a food drag along one row left
  7,003 food cells far off that row (unit test with the CPU engine).
- **Agents in a dish** (`agentCount`, `src/engine/sizing.ts`): density times the square of the
  grid's short side, as Jones counts his population %p over a square lattice that his dish fills
  (p. 134; p. 147: %p 50 on 300 × 300 is 45,000 agents). A box or a periodic grid counts all its
  cells. The memory estimate counts the same, and switching between the dish and another arena
  builds a new simulation. Steiner tree goes back to Jones' %p 2 (it had 1.2 % to make up for the
  old count).
- **A cell of its own at the start.** With one agent per cell, claim rounds follow the init pass
  (`init.wgsl` `claimStart` and `settleStart`; WebGL2 `points.vert` kind 5 and `init.frag`): every
  agent not placed yet claims its cell with a key unique per round, the highest key takes the cell,
  and the others draw again in their layout's region (the mixed layout in the dish or the grid). 32
  rounds; the mixed layout on a grid without walls and dish needs one (its first draw is a
  permutation of the grid, `startRounds` in `src/engine/pack.ts`). An agent without a free cell after
  the last round starts dead. A placed position is clamped below the next cell (`inCell`). Without
  the rule, an agent in a wall or outside the dish draws again in its region, up to 32 times. In
  the full dish of Shrinking plasmodium (64 %) the rounds rarely leave one agent without a cell: on
  WebGPU in 1 of 61 seeds on 512 × 288 and in 4 of 61 on 512 × 512, one agent each time. WebGL2
  rounds its floats otherwise and gives other seeds (seed 21 on 512 × 512, not on 512 × 288).
- **The wrap seam.** A move that ended a hair below x = 0 was wrapped to x = W in f32, which lies in
  cell 0, while WebGPU counted the move and its occupancy in cell W − 1. Another agent could then
  enter cell 0, two agents in one cell (older than this ADR). `wrapPos` in `common.wgsl` and
  `common.glsl` now keeps a position below W and H: in cell W − 1 on both backends.
- **Wall jumps.** A move checks every cell the segment from the agent to its destination enters
  (`clearPath` in `agents.wgsl` and `agents.frag`): a supercover walk, where a segment that passes
  within 0.001 cells of a grid corner counts both cells beside the corner. `advance`, `claim` and
  `settle` and the GLSL agent pass use it. A blocked agent behaves as before: random new heading, no
  deposit. The walk is skipped while no wall was painted since the last clear (`Params.extra.y`).
- **One wall threshold.** A cell is a wall when its wall byte is at least 128 (0.5): `isWall` in
  `common.wgsl` and `common.glsl`, used by every simulation shader that reads walls.
- **The grid is a model scale.** Sensor offset and step size stay in cells. On another grid the
  same edits cover the same share of the screen, but the agents see them at another scale, so a
  different grid is a different experiment. This is not changed.

## Consequences

- The Maze survives the owner's grid change on both backends, byte for byte when the old grid
  comes back (GPU and e2e tests). On the base commit the e2e test fails.
- Start placement on the shipped scenes, both backends, 16:9 and 9:19.5 (seed 7): every scene with
  the rule starts with 0 dead agents, 0 agents in a wall and 0 shared cells; with other seeds
  Shrinking plasmodium rarely has one dead agent (above). Shortest path now starts with
  415 / 278 agents (737 / 604 before), Steiner tree with 415 / 278 (442 / 362), Shrinking
  plasmodium with 41,472 / 27,848 (73,728 / 60,416), 64 % of the dish as in the paper.
- Cost of the claim rounds, a reset with the rule against one without, paired, M3 Pro: Shrinking on
  512 × 288 2.5 against 0.7 ms (WebGPU) and 6.6 against 3.7 ms (WebGL2); 1.3 million agents in the
  mixed layout on 1536 × 864 8.8 against 1.7 ms and 20.6 against 4.3 ms. All 32 rounds there would
  take 259 ms on WebGL2, hence the one-round case.
- Cost of the wall walk, paired, walk on and off at the same state: Maze 512 × 288 0.158 against
  0.169 ms per step (WebGPU) and 0.352 against 0.344 ms (WebGL2); Transport network 1024 × 576 with a
  wall 0.897 against 0.891 and 1.588 against 1.589 ms; Three strains 1536 × 864, 4 million agents,
  step 1.4, with a wall 5.13 against 4.27 and 22.0 against 19.2 ms. Without its env reads the walk
  cost nothing measurable.
- On WebGPU (M3 Pro, 16:9 and 9:19.5, 5 to 10 seeds): Shortest path ends as one band in 4 of 5 wide and 5
  of 5 tall runs by step 12,000; Steiner tree as two three-way junctions joined by a short bridge in
  10 of 10 runs; Shrinking plasmodium in the same network in 7 of 10 wide and 9 of 10 tall runs, the
  others tear a hole beside the middle food early. The scene texts say so. On 512 × 288, seeds 21
  to 23 and 31 to 42, a hole of 2,500 to 7,400 cells opened by step 1,000 or 2,800 in 3 of 15 runs
  at density 0.5, in none at 0.6 (77 % of the dish) and in none with the old count of 73,728
  agents. Jones' %p 50 is 0.5, so a higher density is an open owner decision (TODO.md).
- The Maze's food sources lie 0.64 short sides from the centre along the long side. On a window
  between square and about 1.25:1 (either way up) they lie outside the grid and are skipped: on
  512 × 512 and 512 × 427 the Maze has no food, on 512 × 410 only 12 food cells. From 1.3:1 on both are
  there, whole from 4:3 on. Moving them inward would change the Maze on every other screen, so it is
  an open owner decision (TODO.md).
- Maze walls are 0.008 short sides thick in radius: 4 to 5 cells across at 512 × 288 (the middle
  wall 4, the outer walls 5), 5 to 6 at 512 × 320, 3 to 4 at 236 × 512. The sensor distance of 7
  reaches across them. At step 10,000 (16:9, 3 seeds) the trail 1 to 3 cells beside a wall was 1.5
  to 2.6 times the mean of open cells, and a path ran within 3 cells of a wall on both sides along
  7 to 20 % of the walls' rows. A path of trail from food to food (open cells whose 3 × 3 mean
  trail is above the mean of open cells, seeds 31 to 42) held in 12, 10, 7 and 5 of 12 runs at
  steps 2,000, 5,000, 10,000 and 15,000 on 16:9, and in 7, 5, 4 and 1 of 12 on 9:19.5. The scene
  text says that it breaks in most runs.
- Tests: the engine runs in Node with a CPU backend that paints with `paint-reference.ts`, the CPU
  copy of the paint shaders (`engine-env.test.ts`); `sim.gpu.test.ts` checks that copy against both
  backends, in one call and one call per stroke, across the edges, under other boundaries, on copies
  of the grid two and three periods away, for strokes longer than the grid and for brushes larger
  than it.
- If a later model changes the environment on the GPU (food that gets eaten), the edit list no
  longer describes it, and that part needs a readback for a new grid.
- Shared links still carry only the settings, not the edits (owner decision D8, its own pull
  request).
