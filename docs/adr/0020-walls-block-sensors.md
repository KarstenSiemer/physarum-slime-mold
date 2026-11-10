# 0020: Walls block sensors

- Status: accepted (owner decision, 2026-11-10: "Wände blocken Sensoren")
- Date: 2026-11-10

## Context

A sensor read the cell at its point (ADR 0007). Only a sensor whose cell was a wall or outside the arena read
`BLOCKED` (−10³⁰). A wall between the agent and its sensor did not count, so through a wall thinner than the sensor
distance an agent read the trail on the far side. Jones 2010 keeps obstacles in the data map (p. 131, Table 1 on
p. 134) and does not say what a sensor reads behind one.

The Maze showed the effect (ADR 0019). A path of trail from food to food (the flood fill of ADR 0019) held at step
15,000 in 12 of 12 runs on 512 × 512, in 0 of 12 on 512 × 288 and in 1 of 12 on 236 × 512 (WebGPU, seeds 31 to 42).
Its walls are 4 cells across on 512 × 288 and 236 × 512 and 8 on 512 × 512, and the sensor distance is 7. Control runs
that swapped the walls' thickness in cells between 16:9 and 1:1 swapped the result. The pictures show why: on 512 × 288
the paths ran along both sides of the long middle wall, and no path went through the gap above it, so the flood fill
from one food stopped at that wall (seed 31, step 15,000).

## Options

1. **Thicker Maze walls.** Walls 8 cells across kept the path on 512 × 288 (11 of 12 at step 15,000, ADR 0019). On a
   coarse grid such as 256 × 144 the same walls are 4 cells across again. The user can pick that grid in the panel, and
   the memory fit and the out-of-memory step-down can choose it (`fitResolution` in `src/engine/sizing.ts`,
   `src/engine/engine.ts`); the startup check stops at 512 (`MIN_GRID` in `src/ui/tune.ts`). A painted wall stays as
   thin as the user drew it. It changes the Maze only.
2. **A sensor behind a wall reads 0.** A strain that flees its own trail weighs the trail with a negative number, so it
   reads trail as values below 0. A sensor behind a wall would then read the highest value, and repelling strains
   (Turing spots, Turing stripes, Wound healing) would turn toward every wall.
3. **A sensor clipped at the wall** reads the last open cell before the wall. Near a wall the sensors then sample the
   trail at a shorter distance than the sensor distance, which is the scale of the pattern (Jones 2010, Fig. 10), and an
   agent cannot tell a wall from open ground. It needs the same walk as option 4.
4. **A sensor reads `BLOCKED`** when the segment from the agent to the sensor point passes through a wall: the value of
   a sensor inside a wall. One rule for every sensor that a wall stops. `BLOCKED` is lower than any value of the trail,
   so every strain, attracted or repelled, turns away from it.

## Decision

Option 4, the owner's decision.

- **The walk.** A sensor uses the walk of the moves (`clearPath` in `agents.wgsl` and `agents.frag`, ADR 0019): every
  cell the segment enters between the agent's cell and the sensor's cell, and both cells beside a grid corner that the
  segment passes closer than 0.001 cells (`CORNER`). `sense()` checks the sensor's cell itself, as before. The walk
  wraps around the periodic grid. In a box or a dish a cell outside the arena is not a wall, and a sensor point outside
  the arena reads `BLOCKED` already. `advance` and `claim` sense; `settle` moves along the heading that `claim` chose
  and checks only the move. A walk enters at most `WALK` = 92 cells: a segment with sides dx and dy enters fewer than
  |dx| + |dy| + 2 cells, which is floor(64 · √2) + 2 = 92 for the longest sensor distance (64 cells,
  `src/model/params.ts`) and 13 for the longest step (8 cells). Moves and sensors share the one walk and bound, alike on
  both backends; `pack.test.ts` checks the bound against `params.ts`.
- **Passes with and without the check.** The check, built into a pass but never run, changes how the compiler rounds
  the sensor positions. With three strains on 160 × 144 and 256 × 144 cells (Three strains settings, 3 agents per cell)
  the agents then differed by step 4 on both backends (M3 Pro). The first agent that turned otherwise had a sensor
  point on a cell edge, at y = 71.0 in a float32 copy of its step on the CPU. So WebGPU builds `advance` and `claim`
  with and without the check (the override `SENSE_WALLS`), WebGL2 the agent pass (`#define SENSE_WALLS`), and both use
  the passes with the check only while the walls flag of ADR 0019 is set (a wall was painted since the last clear).
  Without walls the passes are those of the code before.
- **Built at the first wall.** The two clearance passes and the agent passes with the check are created at the first
  paint of a wall or the first `writeEnv` with one (`Kernels.walled` in `sim.ts`, `Programs.walled` in
  `gl/programs.ts`). An eraser stroke without walls creates none. On WebGPU `createComputePipeline` returns at once, and
  the queue waits for the compiler before the first pass with walls. Built with all other pipelines at the start, they
  made the first page load of "a preset chosen while the engine starts" reach the engine 2.6 s later in the CI image
  (median of 6 runs paired with the base, ADR 0010).
- **No division per cell.** The walk keeps the cell wrapped into the periodic grid next to the unwrapped one and moves
  it one cell at a time. Before, every cell went through `cellAt()`, with two integer divisions per axis.
- **Clearance.** Every tile of 8 × 8 cells keeps its clearance: a lower bound of the Chebyshev distance from any of its
  cells to the nearest wall cell (`walls.wgsl`, `walls.frag`). Every cell of a walk lies at most max(|Δx|, |Δy|) cells
  from the start cell, so a walk with a smaller span than the clearance of the agent's tile cannot meet a wall and ends
  at once. An agent reads its clearance once per pass. Two passes measure it: one marks the tiles that hold a wall cell,
  one searches 10 tiles in every direction. A tile 11 or more tiles away lies at least 74 cells away (`FAR`), because
  only the last tile of the grid can hold fewer than 8 cells, so the clearance is exact as a lower bound up to 74 cells;
  the longest walk spans 65. Distances count around the periodic grid in every arena, which in a box or a dish gives the
  true distance or less. `Sim.paint` measures the clearance again after a list with a wall or an eraser stroke while
  the walls flag is set, `Sim.writeEnv` after it wrote walls.

## Consequences

- Without walls nothing changes. This was checked off-line, not by a test in the repository: a scratch GPU test wrote
  the SHA-256 of the agents and of the trail at the end of each scene, once with the base commit (`f07d0f9`) and once
  with this code. 15 scenes without walls gave the same digests on WebGPU and WebGL2, on an M3 Pro and on SwiftShader
  in the CI image: the mixed layout on 64 × 64 cells with the default settings and with one agent per cell (100
  steps); Three strains (110,592 agents), Shrinking plasmodium and Turing spots on 256 × 144 (64 steps) and Dot grid
  there (147,456 agents, 32 steps); Fleeing light and the Maze with its walls erased on 256 × 160 (64 steps); the
  Fig. 10 setup on 200 × 200 (6,000 agents, one agent per cell, 100 steps); and, for 24 to 40 steps, the default
  settings on 128 × 72, three strains that flee each other in sectors (69,120 agents on 160 × 144), sensors of 9, 30
  and 64 cells in a box with food and light, a dish with one agent per cell, one agent per cell with shrinkage,
  inoculate and cut, and walls painted and then cleared. With walls, this code with the sensor check cut out gave the
  bytes of the base in 13 scenes on both backends (M3 Pro): the new walk and the clearance change no move. And the
  clearance changes nothing: every walk run to its end gave the same bytes in 9 scenes with walls.
  Joined onto PR 3 (`0a11791`, the outlines of ADR 0009), this code gives the same in the built app: after 500 steps
  from seed 7, the trail, the agents and the environment of the 14 shipped scenes without walls, and of two strains on
  512 × 288, gave the same SHA-256 as PR 3 on WebGPU and WebGL2 (M3 Pro). The Maze, with walls, did not.
- The GPU tests (`sim.gpu.test.ts`) compare the shipped passes with versions of this code in which the sensor check or
  the clearance skip is cut out, on the same device. They show that the passes for scenes without walls give the bytes
  of the source without the check (on an M3 Pro a check built in but never run would not), and that the clearance
  skips only walks that cannot meet a wall. They cannot show that the passes give the bytes of the base commit: a
  change in the code that both versions share passes them. That is what the digests above show, for this code.
- The Maze keeps a path from food to food on every screen shape. Same metric, seeds and steps as ADR 0019, runs of 12 at
  the threshold (in brackets at half of it), WebGPU on an M3 Pro, the built app:

  | Grid (window)                 | Walls across | Step 2,000 | Step 5,000 | Step 10,000 | Step 15,000 |
  | ----------------------------- | ------------ | ---------- | ---------- | ----------- | ----------- |
  | 512 × 288 (1280 × 720, 16:9)  | 4, short 5   | 12 (12)    | 12 (12)    | 12 (12)     | 12 (12)     |
  | 512 × 320 (1280 × 800, 16:10) | 6            | 12 (12)    | 12 (12)    | 12 (12)     | 12 (12)     |
  | 236 × 512 (375 × 812, 9:19.5) | 4            | 12 (12)    | 12 (12)    | 12 (12)     | 12 (12)     |
  | 512 × 512 (800 × 800, 1:1)    | 8            | 12 (12)    | 12 (12)    | 12 (12)     | 12 (12)     |

  The base commit, run again with the same tools, gave the 192 trail dumps of ADR 0019 byte for byte. Joined onto PR 3,
  this code gave the 192 trail dumps of the table byte for byte. The network itself
  is as large as before: at step 15,000 on 512 × 288, 18.5 % of the open cells lay on a path (base 18.0 %), with 21
  holes of at least 20 cells (base 20). On every grid and step the median counts differ by at most 1 hole and 0.5 % of
  the open cells. The paths now pass the gaps between the walls, but paths along both sides of one long wall still
  form. On the rows of the three long walls at least 12 cells from their ends and from a wall that joins them, a wall
  counts as one with paths on both sides when in 5 % of its rows or more the trail within 3 cells of each side lies
  above twice the mean of the open cells. Of 36 cases of wall and seed, that held at step 15,000 in 0 on 512 × 288
  (base 7), in 7 on 512 × 320 (base 4), in 2 on 512 × 512 (base 0) and in 1 on 236 × 512 (base 1), and at step 10,000
  in 5 on 236 × 512 (base 9). As no sensor reads the trail behind a wall, the agents on one side no longer follow a
  path on the other side; where both sides hold a path, each belongs to its own corridor. The scene's texts say so.

- Agents do not get stuck along the walls. In open cells within 2 cells of a wall, the share of agents whose move was
  blocked in one step (median of 12 seeds; single seeds lay between 12.5 and 72.6 %) fell by up to 16.5 points: on
  236 × 512 from 54.1 to 37.6 % at step 15,000 and from 60.9 to 44.6 % at step 10,000, on 512 × 288 from 52.5 to
  38.5 % and from 60.0 to 47.4 % at the same steps. It rose by at most 2.8 points (512 × 320, step 2,000). Elsewhere it
  changed by at most 1.7 points (52 to 82 %). Agents per open cell near a wall, against elsewhere, fell from 2.13 to
  1.66 times on 512 × 288 and from 1.75 to 1.37 times on 236 × 512 at step 15,000, and stayed on 512 × 320 (1.72,
  1.67) and 512 × 512 (0.68).
- Repelling strains keep away from walls. With walls painted as an upside-down T on 512 × 288 (two strokes of radius
  0.008 short sides, from (−0.5, 0.1) to (0.5, 0.1) and from (0.1, −0.4) down to (0.1, 0.1), in the frame of ADR 0019
  whose long side spans 1.6 units and short side 1), seeds 31 to 33, step 6,000, agents per open cell against the mean
  of the grid, by Chebyshev distance from the nearest wall cell:

  | Scene, sensor distance | Build  | 0 to 2 cells | 3 to 5 | 6 to 10 | 11 to 15 | 16 to 20 | 21 to 30 | 31 to 40 |
  | ---------------------- | ------ | ------------ | ------ | ------- | -------- | -------- | -------- | -------- |
  | Turing spots, 40       | before | 1.51         | 1.26   | 0.92    | 0.68     | 0.53     | 0.54     | 1.04     |
  | Turing spots, 40       | now    | 0.14         | 0.11   | 0.16    | 0.23     | 0.41     | 1.02     | 1.81     |
  | Wound healing, 27      | before | 1.45         | 0.96   | 0.64    | 0.56     | 0.67     | 1.34     | 0.99     |
  | Wound healing, 27      | now    | 0.18         | 0.20   | 0.31    | 0.53     | 1.08     | 1.40     | 0.84     |
  | Turing stripes, 13     | before | 0.85         | 0.37   | 0.57    | 1.69     | 0.75     | 1.01     | 0.89     |
  | Turing stripes, 13     | now    | 0.03         | 0.12   | 1.23    | 1.80     | 0.31     | 1.23     | 0.71     |

  Before, a sensor beyond the wall read the low trail on the far side, which a repelling strain prefers: agents gathered
  against the walls, and 42 to 66 % of those within 2 cells of a wall were blocked (steps 1,000, 3,000 and 6,000). Now
  no agents pile up against a wall, and 0 to 23 % of those near it were blocked. A wall repels them more strongly than
  any trail: they keep a band of about half the sensor distance free, and the spots and stripes line up along the
  walls. Before, stripes ran on through a wall as if it were not there. Jones' attracting network (Transport network) is
  unchanged near the walls (5.18 and 5.16 times the mean within 2 cells), and the three strains of the start scene stay
  away from walls as before (0.05 to 0.10 times the density elsewhere).

- Cost, paired in one page at the same state, M3 Pro, median of 12 rounds, in ms per step: with the sensor check, the
  code before (moves check, sensors do not), every walk run to its end, and no walls:

  | Scene, grid, agents                             | WebGPU                      | WebGL2                     |
  | ----------------------------------------------- | --------------------------- | -------------------------- |
  | Maze, 512 × 288, 17,695                         | 0.144, 0.138, 0.157, 0.131  | 0.290, 0.265, 0.292, 0.267 |
  | Transport network, 1024 × 576, 88,474, one wall | 0.798, 0.796, 0.849, 0.787  | 1.252, 1.191, 1.357, 1.206 |
  | Three strains, 1536 × 864, 3,981,312, one wall  | 4.173, 3.717, 12.917, 3.533 | 26.70, 24.92, 38.52, 24.71 |
  | Wound healing, 512 × 288, 14,746, one wall      | 0.198, 0.170, 0.236, 0.168  | 0.379, 0.304, 0.403, 0.303 |
  | Wound healing, 1024 × 576, 58,982, one wall     | 0.941, 0.946, 1.021, 0.934  | 1.397, 1.270, 1.578, 1.258 |
  | Turing spots, 512 × 288, 29,491, one wall       | 0.239, 0.185, 0.331, 0.173  | 0.560, 0.376, 0.649, 0.367 |
  | Dot grid, 1024 × 576, 2,359,296, one wall       | 3.380, 2.217, 11.983, 2.180 | 18.47, 14.19, 27.16, 14.28 |

  The wall is a stroke of radius 2 cells across the middle 60 % of the grid. The sensor distance is 27 in Wound healing,
  40 in Turing spots, and 49, 1.7 and 34 in Dot grid. Before the clearance and the step-by-step wrap, the sensor check
  made Three strains 26.1 against 6.5 ms on WebGPU (the step-by-step wrap alone: 14.3 against 5.6 ms). Measuring the
  clearance after a paint with a wall took 0.10, 0.30 and 0.55 ms more than a food stroke on 512 × 288, 1536 × 864 and
  2048 × 1152 (WebGPU), and 0.25, 0.58 and 0.76 ms (WebGL2); the engine paints once per frame.

  Long sensors among many walls cost the most: the longer the sensors and the more walls, the fewer walks the clearance
  skips. Paired the same way with 24 rounds, with the walls of the Maze (its five strokes, no food) or the one wall
  above, and the given sensor distance for every strain. In ms per step as above, then the median of the paired
  differences between the sensor check and the code before. Other work loaded the GPU, so the steps took longer than in
  the table above; the paired differences hold:

  | Scene, grid, agents, walls, sensor distance                 | WebGPU                              | WebGL2                              |
  | ----------------------------------------------------------- | ----------------------------------- | ----------------------------------- |
  | Three strains, 1536 × 864, 3,981,312, Maze walls, 64        | 17.01, 6.98, 36.47, 6.95 (+143 %)   | 48.84, 20.33, 67.03, 20.53 (+140 %) |
  | Three strains, 1536 × 864, 3,981,312, Maze walls, 18        | 8.08, 7.99, 16.67, 7.49 (+10 %)     | 28.55, 23.84, 36.23, 23.42 (+22 %)  |
  | Three strains, 1536 × 864, 3,981,312, one wall, 64          | 12.96, 9.02, 38.51, 9.63 (+46 %)    | 32.14, 21.37, 72.29, 21.72 (+53 %)  |
  | Three strains, 1536 × 864, 3,981,312, one wall, 18          | 9.32, 8.00, 18.08, 8.11 (+8 %)      | 27.39, 23.56, 36.01, 22.82 (+10 %)  |
  | Transport network, 1024 × 576, 88,474, one wall, 64         | 1.433, 1.337, 2.172, 1.305 (+16 %)  | 1.756, 1.164, 2.377, 1.156 (+53 %)  |
  | Transport network, 1024 × 576, 88,474, Maze walls, 64       | 1.031, 0.740, 1.288, 0.735 (+39 %)  | 1.955, 1.262, 2.459, 1.282 (+57 %)  |
  | Dot grid, 1024 × 576, 2,359,296, one wall, 49, 1.7 and 34   | 2.921, 2.249, 11.322, 2.145 (+29 %) | 19.25, 15.85, 28.94, 15.41 (+20 %)  |
  | Dot grid, 1024 × 576, 2,359,296, Maze walls, 49, 1.7 and 34 | 4.044, 2.272, 11.188, 2.218 (+78 %) | 18.94, 14.11, 26.63, 13.73 (+38 %)  |

  The worst case, Three strains among the Maze's walls with a sensor distance of 64, gave +143 to +166 % on WebGPU and
  +92 to +140 % on WebGL2 in three runs (24, 24 and 12 rounds; the sensor check was slower in every round). A frame runs
  at least one step (`src/engine/budget.ts`). So there a step of 49 to 72 ms on WebGL2 allows at most 14 to 20 frames
  per second, against 27 to 49 with the check of the moves only. On WebGPU a step of 15 to 22 ms allows at most 46 to
  69 steps per second, against the 120 that the scene's speed asks for. Whether to keep this cost or make the walk
  cheaper is an open owner decision (TODO.md).

- Start: a scene without walls builds no pass for walls. In the CI image (SwiftShader, 10 builds paired with the base,
  each with code of its own), the five agent passes compiled in a median of 0.90 s against 0.81 s, as their source now
  holds the check; the four passes for walls take 1.26 s more, at the first wall. On an M3 Pro the same builds took
  0.24 s against 0.24 s, and 0.28 s. The Maze has walls from its start: in the CI image its first page load reached
  step 5 after a median of 24.8 s against 21.2 s (6 runs paired with the base, another test container on the host).
- Memory: two `u32` (WebGL2: `R32F`) per tile of 64 cells, under 0.2 % of a simulation.
- A wall drawn into any scene now also shapes what agents sense, so painted walls change repelling patterns more than
  before (above). Shared links carry no walls (ADR 0019), so they give the same agents as before.
- The tests (`sim.gpu.test.ts`, both backends, with and without one agent per cell): a wall one cell thick between an
  agent and its front-right sensor turns the agent away, and without it toward the trail; beside the way and past the
  sensor no wall counts; an erased wall counts no more; a clearance measured before a new wall does not hide it, after a
  paint and after `writeEnv`; both cells beside a corner count, in four directions; a sensor 64 cells away is blocked at
  the last cell before it; a way across the wrap seam is blocked on the far side, in both directions; at a corner on
  the wrap seam both cells beside it and the cell past it count, in both directions; a wall byte outside the dish
  blocks neither a sensor nor a move, and one inside it does; one seed gives the same agents and trail; the agent sort
  changes nothing with walls; the passes against the source without the sensor check (without walls the same bytes,
  with walls not) and against every walk run to its end, in every arena; a simulation with pipelines of its own builds
  no pass for walls while it has no wall, and each of them once, at its first wall.
  Each important test failed with a mutation in a scratch copy (M3 Pro, 185 tests): no sensor check (28 tests failed),
  a walk of 24 cells (4), no corner rule in the sensor walk (4), 0 for a blocked sensor (20), a clearance 1 too high
  (7), a search of 2 tiles (16), no new clearance after a paint (4) or after `writeEnv` (4), the passes with the check
  also without walls (4), a new clearance after an eraser stroke without walls (2), and the passes for walls built at
  the start (2). On SwiftShader in the CI image, the passes with the check also without walls gave the bytes of the
  source without the check in both tests that compare them; there only the test of the first wall failed, on both
  backends. A review found three mutations of the walk that passed every test, in WGSL and in GLSL alike. The tests of
  the seam corner and of the dish were added for them, and each mutation now fails them on its backend (197 tests,
  failed tests in brackets): the cells beside a corner not wrapped across the seam (2), the cell past such a corner
  not wrapped (2), and the dish rule of `wallIn` off (4). Joined onto PR 3, the first eleven mutations each failed
  tests again (M3 Pro, 341 tests of `sim.gpu.test.ts`): 36, 4, 8, 28, 7, 16, 4, 4, 4, 2 and 2 in the order above.
