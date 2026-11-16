# 0046: The mean window of Jones' later papers, a setting of the Jones model

- Status: accepted (decision of the coordinator, 2026-11-15, under the owner's delegation of 2026-11-12), built
  2026-11-15
- Date: 2026-11-15
- Extends ADR 0022 (the Jones and the extended model) and ADR 0027 (the mean at edges and walls).
- Extended by ADR 0047 (the scene Electrotaxis is the first scene with a window above 3 × 3).
- Extended by ADR 0048 (2026-11-15): the scene Voronoi diagram, the second scene with a window above 3 × 3 (5 × 5).

## Context

The app diffuses the trail map with a mean over 3 × 3 cells, as Jones 2010 does (p. 132, Table 1). The extended model
can run that mean several times per step; several 3 × 3 means are not the mean over a larger square.

Jones' later papers use a larger square. I read these three in the owner's copies on 2026-11-15:

- Jones and Adamatzky, "Slime mould inspired generalised Voronoi diagrams with repulsive fields", arXiv:1503.06973,
  p. 7: a mean filter of size Dw, "typically 5×5", then times (1 − Dd).
- Tsuda, Jones et al., "Routing Physarum with electrical flow/current", arXiv:1204.1752, p. 10: every
  cell becomes (1 − d) · u, with u the mean of a window of 15 × 15 cells around it.
- Whiting et al., "Towards a Physarum learning chip", Sci. Rep. 6, 2016, in the pages 4 to 6 of the PDF (p. 5 by the
  coordinator): a mean filter of 5 × 5, times 0.9.

ADR 0022 lists 5 × 5 and 7 × 7 means as Jones' rules that are not built. I did not check the 7 × 7 again.

The next work needs the window: a tool for electrodes (Tsuda) and a scene with Voronoi cells.

The 3 × 3 mean of the app has these rules (ADR 0027; `docs/model.md`, section 6): a cell outside a closed arena and a
wall of the extended model are sinks, which count 0 and hold 0; a wall of the Jones model is a site of the lattice;
the divisor is 9 at every site; the last pass multiplies by 1 − decay; the sources enter before the mean sensing
first, and after the decay moving first. The papers say nothing about the edge of the lattice in their mean.

## Options

1. Only the electrode tool and the Voronoi scene get the larger mean, as a fixed part of them.
2. A setting for the side of the window, in the Jones model.
3. The same setting in both models.

## Decision

The coordinator's decision of 2026-11-15, under the owner's delegation of 2026-11-12:

1. **Option 2 or 3: a setting for the side of the mean window, odd sides from 3 to 15, default 3.** Reason: the
   window is a number of Jones' model like the sensor distance, and more than one piece of work needs it.
2. **The window of 3 stays byte-equal in every scene and model**, and a link holds the setting only when it is not 3.

My own choices, under the same delegation:

3. **The sides are 3, 5, 7, 9, 11, 13 and 15** (`meanWindow` in `src/model/params.ts`). Reason: the side reaches the
   shaders as one number, so every odd side costs no code and no pipeline of its own kind. The published sides 5, 7
   and 15 are in the set, and a scene can tune between them. 15 is the largest published side, and the growth and
   shrinkage windows have the same range.
4. **Only the Jones model has the setting (option 2).** The extended model runs 3 × 3 whatever the settings hold
   (`meanWindowOf()`), and `constrain()` sets its window back to 3 (`asExtended()`). Reasons:
   - A wall of the extended model is a sink, so that trail and scent do not pass it. A window of side w reads the
     cells behind a wall thinner than (w − 1) / 2 cells: the scent of a food would cross the walls of the Maze in one
     step. A window that stops at walls is no rule of a paper.
   - Scent reach and the source scale of the extended model are formulas for the 3 × 3 mean (ADR 0036), measured to
     four digits. They would need a new formula and a new measurement.
   - The extended model already has a wider spread: Diffusion passes.

   In the Jones model a wall is a site of the lattice, and its mean passes a wall already (ADR 0027). So the wide
   window breaks no rule there. The help of the setting says that it reaches through walls.

5. **The window applies to the trail and to the scent.** In the Jones model the food scent is a part of Jones' one
   trail map (ADR 0022; `docs/model.md`, section 6.4): the same mean, the same decay. The two lanes run in the same
   pass, so they cannot differ.
6. **The rules of the 3 × 3 mean, for every side** (`docs/model.md`, section 6.1): a sink counts 0 and holds 0, the
   divisor is w² at every site, a wall of the Jones model is a site that takes no source, the last dispatch multiplies
   by 1 − decay, and the sources enter where they enter the 3 × 3 mean. With w = 3 this is the rule of before. Jones'
   papers state the damping as "(1 − d) times the mean"; that is the same.
7. **The window of 3 runs the code of before.** `diffusePlan()` gives the same dispatches for it, and they run the
   entry point `diffuse`, which this change does not touch. A side above 3 runs a new entry point, `box`
   (`src/engine/shaders/diffuse.wgsl`; `BOX` in `src/engine/gl/glsl/diffuse.frag`).
8. **A side above 3 runs as two dispatches: the sums along the rows, then the sums of those along the columns.** That
   is 2 w reads per cell and not w². It is the mean over the window, with these points:
   - The first dispatch reads the map as the 3 × 3 mean reads it (0 from a sink; the sources of a step that senses
     first; 0 in the wound of a cut of the extended model). It writes the sum at every cell of the grid's rectangle,
     a sink too: a cell in the window of an open cell may lie outside the dish, and its row may hold open cells.
   - The second dispatch sums the sums of the 2 r + 1 rows; a row outside a closed grid counts 0. It multiplies by
     keep / w² in one factor in both orders of a step, adds the sources of a step that moves first, and writes 0 into
     a sink.
   - In float32 the two sums round apart from a sum over the window cell by cell. The CPU reference
     (`src/engine/diffuse-reference.ts`) holds both; they agree to 1e-11 of a value of 100 in float64, and both
     backends agree with the window of the papers to a relative error of 1e-5.
9. **No new texture for the simulation.** The sums go into the free pair of the trail and the scent, and the mean goes
   back into the pair that held the map. Only the view of a step that moves first needs its third pair with one pass
   now: 24 B per cell, which `viewTrailOn()` counts on both backends (`src/engine/sizing.ts`).
10. **The pipelines and programs of the window are built at their first use**, as those of covered food are. No scene
    has a wide window, so the start of the app compiles nothing more. On WebGPU the side is a constant of the
    pipeline; on WebGL2 it is a uniform of one program.
11. **A switch to the extended model sets the window back to 3 and says so in a notice** (`setModel()`).

## Consequences

**Cost.** The time of a step of the scene Transport network (Jones model, moving first, 15 % of the cells with an
agent), M3 Pro, the median of 21 samples of 50 steps after 3,000 steps, three rounds in turns
(`research/flow/engine/turns.sh`). No other GPU test ran; other programs of the owner did (load about 4.5).

| Grid        | Backend | Window | Rounds | ms per step | least | most  | against 3 |
| ----------- | ------- | ------ | ------ | ----------- | ----- | ----- | --------- |
| 200 × 200   | webgpu  | 3      | 3      | 0.052       | 0.048 | 0.052 | 1.00      |
| 200 × 200   | webgpu  | 5      | 3      | 0.062       | 0.060 | 0.088 | 1.19      |
| 200 × 200   | webgpu  | 15     | 3      | 0.126       | 0.122 | 0.128 | 2.42      |
| 200 × 200   | webgl2  | 3      | 3      | 0.318       | 0.316 | 0.318 | 1.00      |
| 200 × 200   | webgl2  | 5      | 3      | 0.342       | 0.340 | 0.342 | 1.08      |
| 200 × 200   | webgl2  | 15     | 3      | 0.346       | 0.344 | 0.346 | 1.09      |
| 1024 × 1024 | webgpu  | 3      | 3      | 1.542       | 1.500 | 1.542 | 1.00      |
| 1024 × 1024 | webgpu  | 5      | 3      | 2.024       | 2.024 | 2.028 | 1.31      |
| 1024 × 1024 | webgpu  | 15     | 3      | 2.132       | 2.108 | 2.144 | 1.38      |
| 1024 × 1024 | webgl2  | 3      | 3      | 2.140       | 2.098 | 2.144 | 1.00      |
| 1024 × 1024 | webgl2  | 5      | 3      | 2.502       | 2.476 | 2.510 | 1.17      |
| 1024 × 1024 | webgl2  | 15     | 3      | 3.322       | 3.322 | 3.332 | 1.55      |

The window of 3 is the pass of before, so the scenes pay nothing. Memory: nothing for the simulation; 24 B per cell
for the view of a scene that moves first with a window above 3 (98 to 122 B per cell on WebGPU).

**Checked.**

- Both backends against the CPU reference for the windows 3, 5 and 15, in wrap, box and dish with walls and food, in
  both orders of a step; the deposits and covered food; the view moving first; the extended model runs 3 × 3
  (`src/engine/sim.gpu.test.ts`, "the mean window (ADR 0046)", 26 tests per backend).
- 26 wrong rules, `B1` to `B26` in `research/flow/engine/mutate.ts`: each fails at least one test.
- The digests of the default settings and of all 22 scenes after 500 steps on both backends are those of `main`
  (`a9afdf4`): 46 runs equal.
- A link without a wide window has the bytes of a link made before the setting (`src/model/url.test.ts`).
- The story and the commands: `research/mean-window/README.md`.

**Not checked, and open.**

- No scene has a wide window, and no result of a paper was compared: that comes with the electrode tool and the
  Voronoi scene.
- The time was not measured sensing first, and not on SwiftShader.
- The two backends are not compared bit for bit with a wide window (`docs/model.md`, section 12, says so for all
  rules).
- The papers do not say how their mean treats the edge of the lattice. The app's rule (a divisor of w², 0 outside)
  loses trail within (w − 1) / 2 cells of a closed edge: 7 cells for 15 × 15.
- The extended model has no wide window. It would need a rule at walls and a new formula for Scent reach.
