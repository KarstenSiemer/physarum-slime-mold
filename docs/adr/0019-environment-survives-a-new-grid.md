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

1. Positions in fractions of width and height in every arena. In a dish the layout then follows
   the screen, not the dish: the three defects above are all dish scenes.
2. One canonical frame of the grid's short side in every arena, turned on a portrait grid: a
   similarity transform. In a box the layout then loses its edges. The first draft of this ADR did
   this. The Maze's foods lie 0.64 short sides from the centre, so they lay beside every grid from
   1:1 to about 1.25:1: no food on 512 × 512 and 512 × 427, 12 food cells on 512 × 410. On a square
   its outer corridors shrank to a tenth of the width (review of the first draft).
3. The scale of the larger axis for strokes and the short side for presets (an earlier draft):
   the two drift apart when the screen turns.
4. A canonical frame per arena, turned on a portrait grid: a dish keeps its short side as the unit
   (option 2), a box and a periodic grid stretch with the grid (option 1). Each edit uses the arena
   it was painted under. The review of the second draft found that edits then come apart after an
   arena switch: in Shrinking plasmodium switched to a box, an erase over a food missed that food
   on a square screen, and the food came back.
5. A canonical frame per arena, one arena per edit list: option 4, but every edit since the last
   Clear or preset load uses the list's arena, the preset's or the first stroke's. The review of the
   third draft found that the list's arena is then a state the user cannot see. After a dish preset
   was switched to a box, a wall drawn across the whole box no longer reached its ends on a wider
   screen, and a dab that painted nothing beside the dish appeared inside it on another grid.
6. **The canonical frame of the arena on screen**: every edit maps through the frame of the arena
   the simulation runs in now. When the arena changes its frame, every edit is first anchored to
   the cells of the grid on screen, where it lies as before.

## Decision

Option 1 with option 6.

- **Edit list.** `Engine` (`src/engine/engine.ts`) keeps every edit since the last "Clear" or preset
  load: preset shapes in the canonical frame of the preset's own arena (`fromShape`), strokes in the
  cells of the grid the view shows (`fromStroke`, `paint()` at line 249), each with the boundary it
  was painted under (`Stroke.boundary`; both backends write it into the parameters of the paint
  pass). Every new simulation paints the whole list (`flushEnv()`, line 257) before it places its
  agents (`rebuild()`, line 183; `load()`, line 107). A frame paints the edits added since. "Clear"
  empties the list, also during a rebuild; a preset load replaces it. A Clear before the engine
  exists waits for it, and the engine then starts without the scene's shapes (`clearEnvironment` and
  `startScene` in `src/ui/state.svelte.ts`). `Engine.paint` before the first simulation exists drops
  the stroke: no grid is on screen yet. So does it with a stroke that paints no cell, beside a box
  or outside the dish (`paintsCell` in `src/engine/brush.ts`, the rule of the paint passes): it
  changes nothing on screen, and on another grid or arena it must not either. On a periodic grid the
  view shows copies of the grid around it, and a stroke on a copy paints the grid where the copy
  shows it. So `fromStroke` moves such a stroke by whole periods until it starts inside the grid.
  Before, its raw coordinates lay beside the grid, and every other grid skipped it as outside: 131
  food cells painted left of a 512 × 320 grid were none on 1024 × 640 (CPU engine test; the GPU
  engine test failed the same way on both backends).
- **Mapping** (`strokeOn`, `src/engine/environment.ts`). On the grid an edit was made on, it is
  painted with its original coordinates, byte for byte. On another grid it goes through the
  canonical frame of the arena on screen (`toFrame` and `fromFrame`): landscape, origin at the
  grid's centre. A dish is the circle on the grid's short side, so its frame has the
  short side as the unit on both axes: a similarity transform, circles stay circles and a food
  source keeps its area relative to the dish. A box and a periodic grid are the arena themselves,
  so their frame stretches with the grid: the long side spans 1.6 units (`FRAME_ASPECT`; presets
  are laid out for 16:10) and the short side 1, and a shape keeps its place relative to the edges.
  In every arena the radius scales with the short side, so a dab stays round. On a 16:10 grid the
  frames are the same. A portrait grid (height above width) turns the frame by 90° clockwise, so a
  layout along the long side of a wide screen stays along the long side of a tall one. A stroke
  under the periodic boundary is moved by whole periods into the grid instead of skipped: such a
  grid has no outside, and its paint pass wraps a stroke that lies partly outside anyway.
- **The arena on screen.** When the arena changes its frame (the dish against a box or a periodic
  grid), `Engine.apply` anchors every edit to the cells of the grid on screen through the frame of
  the arena before (`anchorEdits`, `anchor` in `src/engine/environment.ts`). So every edit keeps
  its place on screen, edits that lie on top of each other stay so, and a new screen shape then
  moves them all through the frame of the new arena. In Shrinking plasmodium switched to a box, an
  erase over a food stays on that food on a square screen, and a wall drawn across the box reaches
  both ends on a wider one. The anchor keeps the exact radius, so a thin stroke anchored on a coarse
  grid comes back thin on a fine one. A grid used before the switch is then reached through the new
  frame, so its old bytes come back only where both frames agree, as on 16:10. A preset loads under
  its own arena. At startup, a boundary chosen in the panel before the engine existed then applies
  as a switch on screen (`startScene`).
- **What a new screen shape changes.** An edit that lies completely outside the new grid is
  skipped and kept for other grids: in a dish's frame when the screen narrows, in a box's frame
  for a dab over its long edge. In a box's or a periodic grid's frame
  the positions stretch with the grid while the radius follows the short side. So a line changes
  its angle, and along the long side a gap between two painted walls narrows against the walls on
  a squarer screen and widens on a wider one: two walls of radius 6 with 8 open cells between them
  on 512 × 320 leave 4 on 512 × 427 and none on 512 × 512. Preset shapes before this ADR did the
  same. Preset shapes are given in the canonical frame of the preset's own arena
  (`src/model/presets.ts`), with values that put every shape where the old fractions put it on a
  16:10 window. In a box or a periodic grid they lie there on every screen (turned on a tall one).
  Steiner's foods form a square whose corners lie as far from the centre as the old rectangle's.
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
  the end of the last one, and paints exactly what it records (`BrushDrag` in `src/ui/drag.ts`).
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
- The Maze keeps its walls and both food sources on every screen shape, where the old fractions
  put them (turned on a tall screen): 166 food cells on 512 × 288, 212 on 512 × 320, 340 on
  512 × 410, 366 on 512 × 427, 530 on 512 × 512 and 112 on 236 × 512 (CPU, `strokeOn` and
  `paint-reference.ts`). On every landscape grid these are the cells of the base commit.
- Maze walls are 0.008 short sides thick in radius. On WebGPU the painted walls are 4 cells across
  at 512 × 288 (the two short walls 5), 6 at 512 × 320, 4 at 236 × 512 and 8 at 512 × 512. The
  sensor distance of 7 reaches across them on the first three grids, not on 512 × 512. At step
  10,000 on 512 × 288 (seeds 31 to 42) the trail 1 to 3 cells beside a wall was 0.9 to 3.4 times
  the mean of open cells. A path (trail above twice that mean) ran within 3 cells of a wall on both
  sides along 2.7 to 12.5 % of the long walls' rows, and along 3.5 to 12.2 % with walls 8 cells
  across: such paths do not need agents that sense across the wall. The table counts the runs of 12
  with a path of trail from food to food: a flood fill from one food over open cells whose 3 × 3
  mean trail is above the mean of open cells reaches the other food (WebGPU on an M3 Pro, the built
  app, seeds 31 to 42; in brackets at half that threshold).

  | Grid (window)                  | Walls across | Step 2,000 | Step 5,000 | Step 10,000 | Step 15,000 |
  | ------------------------------ | ------------ | ---------- | ---------- | ----------- | ----------- |
  | 512 × 288 (1280 × 720, 16:9)   | 4, short 5   | 12 (12)    | 12 (12)    | 9 (12)      | 0 (5)       |
  | 512 × 320 (1280 × 800, 16:10)  | 6            | 12 (12)    | 11 (12)    | 11 (12)     | 9 (9)       |
  | 236 × 512 (375 × 812, 9:19.5)  | 4            | 11 (12)    | 9 (11)     | 1 (3)       | 1 (5)       |
  | 512 × 512 (800 × 800, 1:1)     | 8            | 12 (12)    | 12 (12)    | 11 (12)     | 12 (12)     |
  | 512 × 288, wall radius 0.01422 | 8            | 12 (12)    | 12 (12)    | 12 (12)     | 11 (12)     |
  | 512 × 512, wall radius 0.0045  | 4, short 5   | 12 (12)    | 8 (11)     | 7 (11)      | 5 (9)       |

  The last two rows are controls: they swap the walls' radius in cells between the two grids
  (4.10 cells on 512 × 288, 2.30 on 512 × 512). Walls 8 cells across kept the path on 16:9, and
  walls 4 cells across broke it on 1:1 in 7 of 12 runs at step 15,000. So the walls' thickness
  against the sensor distance decides more than the shape of the screen. A second run of seeds 31
  and 37 on 16:9, 9:19.5 and 1:1 gave the same trail byte for byte. The scene text says that the
  path holds on a square screen and breaks sooner on a wider or taller one.

- Tests: the engine runs in Node with a CPU backend that paints with `paint-reference.ts`, the CPU
  copy of the paint shaders (`engine-env.test.ts`); `sim.gpu.test.ts` checks that copy against both
  backends, in one call and one call per stroke, across the edges, under other boundaries, on copies
  of the grid two and three periods away, for strokes longer than the grid and for brushes larger
  than it.
- If a later model changes the environment on the GPU (food that gets eaten), the edit list no
  longer describes it, and that part needs a readback for a new grid.
- Shared links still carry only the settings, not the edits (owner decision D8, its own pull
  request).
