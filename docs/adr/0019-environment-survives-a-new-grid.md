# 0019: Food, light and walls survive a new grid; agents start on cells of their own

- Status: accepted (the mapping rule, the sweep and the scene-changed rule are the owner's decisions of 2026-11-10)
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
4. **A canonical frame per arena, each edit through the frame of the arena it was painted in**,
   turned on a portrait grid: a dish keeps its short side as the unit (option 2), a box and a
   periodic grid stretch with the grid (option 1). The paint pass cuts an edit at the rim of the
   arena it was painted in, so the cut always matches the frame. The review of the second draft
   (943a16e) found that edits of different arenas that lie on top of or beside each other then
   shift against each other on another screen shape: in Shrinking plasmodium switched to a box, an
   erase over a food missed that food on a square screen, and the food came back; back on 16:10 it
   was erased again.
5. One frame per edit list: option 4, but every edit since the last Clear or preset load uses the
   list's arena, the preset's or the first stroke's (f07d0f9). The review of the third draft found
   that the list's arena is a state the user cannot see. After a dish preset was switched to a box,
   a wall drawn across the whole box no longer reached its ends on a wider screen, and cut and
   frame disagreed: a dab on the dish's rim was cut otherwise on another grid.
6. The frame of the arena on screen, every edit anchored to the cells of the grid on screen at a
   switch (a5631bc). The review of the fourth draft found that an edit kept the cut of the arena
   it was painted in but moved by the frame of the arena on screen. Shrinking plasmodium on a
   square screen, switched to a box, then 16:9: two of its foods kept 0 of 37 and 0 of 38 cells. A
   periodic edit wrapped inside a dish to its other side: a dab at x = 20 on 512 × 320 lay at
   x = 390 on a square. And the order of a switch and a screen change distorted a scene for good:
   the Maze through the dish, a square screen, the box and 16:10 again had its walls at 10 % and
   89 % of the width instead of 24 % and 74 %, and both foods were lost. In a randomized test 19
   of 336 pairs of edits of different arenas that lay on top of each other came apart.

For an edit that later strokes cleared:

1. Keep it: on another screen shape an erase of another arena can miss what it erased (option 4).
2. **The sweep**: after a stroke that clears, delete the edits that later strokes cleared
   completely on the grid on screen, and the erases that clear nothing there any more.

## Decision

Option 1, option 4 for the frame and the sweep (the owner, 2026-11-10). With option 4 the cut
always matches the frame, nothing changes for good (back on an earlier screen shape every edit is
where it was before), and it needs the least code. The sweep keeps an erased food gone.

- **Edit list.** `Engine` (`src/engine/engine.ts`) keeps every edit since the last "Clear" or preset
  load that the sweep left: preset shapes in the canonical frame of the preset's own arena
  (`fromShape`; `load()` at line 118 takes that arena, also when the settings hold another
  boundary), strokes in the cells of the grid the view shows (`fromStroke`, `paint()` at line 289),
  each with the arena it was painted in (`EnvEdit.boundary`; both backends write it into the
  parameters of the paint pass, which cuts the stroke at that arena's rim or wraps it around its
  edges). Every new simulation paints the whole list (`flushEnv()`, line 353) before it places its
  agents (`rebuild()`, line 197; `load()`). A frame paints the edits added since. "Clear" empties
  the list, also during a rebuild; a preset load replaces it. At startup the engine loads once what
  the panel holds (`startScene` in `src/ui/state.svelte.ts`, line 153): the panel's settings, and
  the scene's shapes in the scene's own arena, or none after a Clear before the engine existed.
  Before, a second step applied a copy of the settings taken before the load and could undo a
  setting changed during it on WebGPU. `Engine.paint` before the first simulation exists drops the
  stroke: no grid is on screen yet. So does it with a stroke that does not clearly paint a cell
  (`paintsCell` in `src/engine/brush.ts`, line 344): a cell inside the brush and the rim of a dish by
  `SLACK` = 0.01 cells, and for light one whose byte is at least 1. Such a stroke changes nothing on
  screen, and on another grid or arena it must not either. Before, 69 of 10,721 random light
  strokes lit nothing where they were painted and lit other grids, and 6 of about 32,000 strokes
  had their deepest cell within 1e-4 of the radius, where float32 on the GPU may paint none (review
  of the fourth draft). A dropped stroke is not painted either, so the simulation and the list
  agree. On a periodic grid the view shows copies of the grid around it, and a stroke on a copy
  paints the grid where the copy shows it. So `fromStroke` moves such a stroke by whole periods
  until it starts inside the grid. Before, its raw coordinates lay beside the grid, and every other
  grid skipped it as outside: 131 food cells painted left of a 512 × 320 grid were none on
  1024 × 640 (CPU engine test; the GPU engine test failed the same way on both backends).
- **Mapping** (`strokeOn`, `src/engine/environment.ts`, line 126). On the grid an edit was made on,
  it is painted with its original coordinates, byte for byte. On another grid it goes through the
  canonical frame of the arena it was painted in (`toFrame` and `fromFrame`), whatever arena the
  simulation runs in: landscape, origin at the grid's centre. A dish is the circle on the grid's
  short side, so its frame has the short side as the unit on both axes: a similarity transform,
  circles stay circles and a food source keeps its area relative to the dish. A box and a periodic
  grid are the arena themselves, so their frame stretches with the grid: the long side spans 1.6
  units (`FRAME_ASPECT`; presets are laid out for 16:10) and the short side 1, and a shape keeps its
  place relative to the edges. In every arena the radius scales with the short side, so a dab stays
  round. On a 16:10 grid the frames are the same. A portrait grid (height above width) turns the
  frame by 90° clockwise, so a layout along the long side of a wide screen stays along the long
  side of a tall one. A periodic edit starts inside the grid it was painted on, and its frame maps
  that grid onto the new one; a shift by whole periods catches float rounding at the edges.
- **Each edit in its own arena.** An arena switch changes no byte on the grid on screen. On another
  screen shape a dish edit moves by the dish's frame and is cut at the new dish's rim, and a box or
  a periodic edit moves with the stretched grid, whatever arena runs. So in a box Shrinking
  plasmodium's foods lie where the dish puts them on every screen, a wall drawn across a box after
  a dish preset reaches both ends on a wider screen, a dab painted on a periodic grid stays at its
  place on the grid in a dish on a square screen, and after any order of switches and screen
  changes the Maze is byte for byte the Maze (CPU engine tests). The known limit: after a switch
  between the dish and a box or a periodic grid, strokes painted over or beside older strokes of
  the other arena shift against them on another screen shape. Two dabs painted on top of each other
  on 512 × 288, one on the periodic grid and one in the dish, lie 82 cells apart on 512 × 512 and on
  top of each other again on 512 × 288. A dish food erased in part in a box is whole on a square
  screen, where the erase lies beside it, and erased in part again back on 16:10. The sweep covers
  what matters most: what was erased completely stays gone. A periodic edit wraps around the grid's
  edges in a dish too: a food dab at the far left of a 1024 × 640 periodic grid, beside the dish
  after a switch, lies inside the 1024 × 1024 dish of a square screen at its place, and 48 of its
  1,672 cells lie across the edge at the opposite rim, 26 of them inside the dish (built app, both
  backends).
- **The sweep** (`sweeping` in `src/engine/sweep.ts`, line 469, after every recorded erase or wall;
  `Engine.sweepFor` at line 313). On the grid on screen: (1) an older food, light or wall edit is
  deleted when every cell it paints is cleared by a stroke recorded after it: an erase clears every
  kind, a wall food and light. An edit that paints no cell of that grid is kept: that grid cannot
  judge it. (2) Then an erase is deleted when no older food, light or wall edit that stays paints a
  cell it erases; the erases looked at are the new stroke and those over an edit that went. The
  deletion changes no byte on that grid: an erase writes all four bytes of a cell and a wall writes
  [255, 0, 0, 0], so after the stroke that cleared a cell last, the cell holds what that stroke and
  later strokes wrote, and none of them reads the deleted edit; and an erase over cells that hold
  only zeros changes nothing. Float32 on the GPU may decide a cell near the edge of a brush or the
  rim the other way, so every judgement keeps `SLACK`: an edit's cells count with its brush and the
  rim widened, the cells a clearing stroke surely clears with both narrowed. One case needs no
  margin: a later stroke with the edit's own segment on that grid, bit for bit, at least its radius
  and an arena that holds the edit's (the same one; a box or a periodic one over a dish edit; a
  periodic one painted as it is over a box edit) clears every cell the edit paints (`coversExactly`,
  line 365). Both paint passes decide every cell of every kind by the same distance to the segment
  and `d > radius` (`paint.wgsl` lines 49 and 50, `paint.frag` line 28; a periodic stroke takes the
  smaller distance to a copy), and light paints only within its radius. Before, an Erase click on a
  Food click with the same brush kept both in 13 of 24 trials (a Wall click in 8 of 16, the
  keyboard's 3 then 6 in 2 of 10), the card said "changed", and after a switch from the dish to the
  box such a dab came back on a square screen in 3 of 10 trials (review of the fifth draft); now in
  none of 24, 24 and 10 trials, nor in any of 10 after the switch, on both backends. The simulation
  holds the first `painted` edits; when the sweep deletes one of them, the engine first paints the
  strokes not painted yet, because the stroke that cleared the last cells of a food can go too and
  the simulation would keep those cells until the next rebuild. So a food erased completely in a box
  stays gone on a square screen, by one large erase or a drag of smaller segments, and its erases go
  with it. A wall over food deletes the food when it covers it, a wall over a wall or food over food
  keeps both, light under a wall goes when the wall covers every lit cell, and an edit that lies
  outside the grid on screen stays under an erase there (CPU engine tests). A property test checks
  the rule after every recorded stroke of 160 random sequences (every kind and arena, grids from 37
  × 61 to 237 × 512 and 511 × 287, strokes across the edges, the periodic seam and the dish's rim; a
  fifth of the strokes an erase or a wall on the last stroke's segment): 3,950 checks, 1,863 deleted
  edits, each byte for byte against the list of every stroke recorded since the grid on screen last
  changed. Through the engine the simulation holds exactly what its list paints after each of 720
  random operations (strokes, also while a new grid is allocated, arena, grid and screen changes,
  Clear, loads). GPU tests on both backends compare the simulation with the CPU replay of the list
  after sweeps and after a rebuild on another grid, and after strokes that each lose an edit painted
  before them with the same segment, brush edges on cell centres.

  Speed: the sweep judges a row of cells at a time (`Rows` in `src/engine/brush.ts`, line 259). In
  a row the cell centres within a distance of a segment form one interval (the brush is convex), and
  so do those within the rim of a dish; on a periodic grid each part of a stroke and each copy one
  period around gives one, and light's lit cells (byte at least 1) lie within 98.2 % of its radius.
  So a row costs a few square roots, however many cells the brush covers. Every edge moves by a hair
  of float64 rounding, 1e-9 cells per cell of radius: out for an edit's cells and for an erase in
  rule 2, in for the cells a clearing stroke surely clears (a unit test checks the runs against a
  reference written apart, cell by cell, at +`SLACK` and −`SLACK`). The sweep keeps every edit on the
  grid on screen and its box in one typed array (`Placement`, line 94), kept in step with every
  stroke, deletion, Clear and load, and across a new simulation on the same grid; from 256 edits on,
  tiles of 32 × 32 cells index the clearing strokes and the painting ones, so the strokes recorded
  after an edit and the edits under an erase are found without a pass over the list. Rule 1 first
  asks the new stroke alone (both ends of the edit's capsule within its capsule), then visits the
  edit's rows from the first one not known to be cleared, the strokes that cleared the row before
  first, stops at the first cell left open and remembers it and that row: a cleared cell stays
  cleared, so the next sweep looks at the edit again only when the new stroke covers that cell.
  Rule 2 tests the older edits under an erase row by row, stops at the first that shares a cell and
  keeps it as the erase's witness: the erase is looked at again only when its witness goes. The
  sweep pauses after 32 rows of work: the pointer handler runs 256 rows of it (about 0.5 ms on an
  M3 Pro before the JIT has optimized it), each frame 1 ms more, and a deletion changes no byte on
  screen. A new grid finishes a waiting sweep first; a Clear and a preset load drop it. Measured with
  the scripts of the review of the fifth draft (3caa152, "before"), in the same run as that draft
  and the fourth (a5631bc, no sweep), M3 Pro with two other workflows on the GPU:

  | Built app, 120 px brush, the second drag (Engine.paint per segment, mean / max) | a5631bc       | Before         | After         |
  | ------------------------------------------------------------------------------- | ------------- | -------------- | ------------- |
  | Grid 2048 (192 cells), an erase drag along a wall drag, WebGPU                  | 0.01 / 0.1 ms | 15.1 / 25.1 ms | 0.65 / 1.5 ms |
  | The same, WebGL2                                                                | 0.01 / 0.1 ms | 17.1 / 33.0 ms | 0.41 / 1.1 ms |
  | Grid 2048, a wall drag over a food drag, WebGPU                                 | 0.01 / 0.1 ms | 15.1 / 33.8 ms | 0.56 / 1.2 ms |
  | The same, WebGL2                                                                | 0.01 / 0.1 ms | 15.8 / 30.5 ms | 0.41 / 1.0 ms |
  | Grid 2048 zoomed out one wheel step (384 cells), an erase along a wall, WebGPU  | 0.02 / 0.1 ms | 41.1 / 53.1 ms | 0.57 / 0.9 ms |
  | The same, WebGL2                                                                | 0.00 / 0.0 ms | 44.7 / 60.1 ms | 0.45 / 1.0 ms |
  | Grid 1536 (144 cells), an erase along a wall, WebGPU                            | 0.00 / 0.0 ms | 10.6 / 14.4 ms | 0.46 / 1.7 ms |
  | The same, WebGL2                                                                | 0.01 / 0.1 ms | 9.3 / 13.4 ms  | 0.52 / 1.2 ms |

  Each drag has 10 to 21 segments. The first drag costs 0.09 to 0.22 ms per segment after (0.03 to
  0.11 ms with a5631bc). During the second drag frames came at most 19 to 27 ms apart after, 31 to
  77 ms apart before, and 18 to 31 ms apart with a5631bc, apart from one stall of 240 ms there.

  In Chromium with the engine and a backend that paints nothing, per recorded segment or stroke: the
  pointer handler, mean (p95), and in brackets the whole sweep over the frames it takes; "before"
  is the same scripts on 3caa152 in the review of the fifth draft:

  | List on 1536 × 864                                                        | Before                   | After                                                |
  | ------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------- |
  | 5,400 recorded edits (3,792 kept), largest eraser (96 cells), 96 segments | 8.6 ms (28 ms)           | 0.14 ms (0.3 ms) [0.21 ms, 0.5 ms]                   |
  | 18,000 recorded edits (13,113 kept), the same                             | 26.7 ms (63 ms)          | 0.03 ms (0.1 ms) [0.40 ms, 0.8 ms]                   |
  | One erase of radius 300 over 2,000 / 10,000 / 30,000 / 100,000 edits      | 13 / 55 / 302 / 2,053 ms | 0.3 / 0.2 / 0.4 / 0.9 ms [0.7 / 2.1 / 5.7 / 22.0 ms] |

  The frames that finish such an erase take at most 1.5 ms up to 30,000 edits; with 100,000 the one
  that ends it takes 3.4 ms, as it also compacts the list of 83,420 edits. On a new grid, where no
  open cell is known yet, the erase over 100,000 edits takes 53.8 ms in all, over 49 frames.

- **Scene changed.** The scene card shows "changed" and "Reload scene" when a model setting or the
  food, light and walls differ from the loaded scene: when the engine's list is not the scene's
  shapes in the scene's arena (`Engine.matches`, line 143; `Engine.onEdits` after every change of
  the list; `app.envChanged` in `src/ui/state.svelte.ts`). A Clear of a scene with shapes, a
  recorded stroke or a sweep that deleted a shape changes the scene; a stroke and an erase that the
  sweep took back leave it unchanged. Before the engine exists, a Clear of a scene with shapes sets
  the flag, and a preset load resets it. Before, the card counted only settings: after a Clear it
  offered no Reload scene (also on `main`), and the Preset select cannot load the preset already
  chosen, so the walls came back only through another preset.
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
- The Maze keeps its walls and both food sources on every screen shape, also after arena switches in
  any order, where the old fractions put them (turned on a tall screen): 166 food cells on 512 × 288, 212 on 512 × 320, 340 on
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
  copy of the paint shaders (`cpu-backend.ts`; `engine-env.test.ts`, `sweep.test.ts`);
  `sim.gpu.test.ts` checks that copy against both backends, in one call and one call per stroke,
  across the edges, under other boundaries, on copies of the grid two and three periods away, for
  strokes longer than the grid and for brushes larger than it. `someCell`, which `paintsCell` and
  the sweep use, visits exactly the cells that copy paints (1,500 random strokes, `brush.test.ts`).
- In the built app on both backends (the scripts of the review of the fourth draft): Shrinking
  plasmodium on 800 × 800, switched to a closed box, keeps all 8 foods on 1280 × 800, byte for byte
  as the box chosen there directly (6 foods before); the Maze through the dish, 800 × 800, the box
  and 1280 × 800 again is byte for byte the Maze (6,128 wall and 212 food bytes differed before),
  without "changed" on the card; and a food erased with the Erase tool after a switch to the box on
  1280 × 720 stays gone on 800 × 800, with the bytes of the scene without that food and 7 edits in
  the list.
- The sweep judges on the grid on screen only. An edit that lies outside that grid or paints no cell
  there stays, also under a complete erase there. And an erase that went because it clears nothing
  there any more no longer erases what it reached only on another grid: there, a part of another
  stroke that it erased comes back. Without the sweep the same erase would erase things on other
  grids that it never erased on screen.
- If a later model changes the environment on the GPU (food that gets eaten), the edit list no
  longer describes it, and that part needs a readback for a new grid.
- Shared links still carry only the settings, not the edits (owner decision D8, its own pull
  request).
