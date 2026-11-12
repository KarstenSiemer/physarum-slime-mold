# 0028: Performance of drawing and stepping

- Status: accepted
- Date: 2026-11-11

## Context

On 2026-11-11 the owner said that the app felt slower since #28. A measurement compared the production builds of
30b60ef (before #26), 2c355b7 (#26) and 45155a8 (#28) in headed Chromium, WebGPU on Metal, on an Apple M3 Pro with
a 2560 × 1600 canvas, in interleaved rounds:

- On WebGPU neither #26 nor #28 is measurably slower. The ratio of the step time of 45155a8 to 30b60ef was 1.004 to
  1.029, of the draw time 0.98 to 1.02, with a resolution of about ±3 %.
- On WebGL2 #26 made the draw on the periodic grid slower, by 0.7 to 3.5 ms per frame: the integer remainders that
  replaced a float wrap that was wrong on some grid sides (ADR 0023). That is still open.

The owner then said that the app often falls from about 100 to 40 fps and back at 1 M agents. A trace of every frame
over 60 to 90 s found the cause outside the app: another program that uses the GPU at the same time. "1 M agents" was
the default scene after the startup check had lowered its grid to 768 × 480 (1,105,920 agents).

- Alone on the GPU the app held 119 to 121 fps at that grid, with no frame in flight at the start of a frame.
- With a second browser that ran the default scene, switched on and off every 15 s, it fell to 76 to 91 fps, and
  to 41 to 52 fps with the other load on the machine. Three frames were then in flight, and the time from submit to
  GPU done was 32 to 73 ms. The change took 1 to 2 s each way.
- The step budget (`src/engine/budget.ts`) did not cause it: it stayed at its floor of 1 step per frame under the
  load. No periodic work of the app (the sort every 32 steps, the exposure measurement) lined up with it.

Under such load the app gets a share of the GPU, and its frame rate is that share divided by its own GPU time per
frame. At grid 768 the backdrop blur of the panels was about two thirds of that time. The browser's GPU time per
frame, measured with ioreg:

| Variant                       | GPU ms per frame |
| ----------------------------- | ---------------- |
| main (45155a8)                | 2.9–3.1          |
| main, `backdrop-filter: none` | 0.95–1.5         |
| main, all panels hidden       | 1.0              |

Under the same second GPU client, in four interleaved rounds of 12 s: main gave 53, 45, 44 and 95 fps, main without
the blur 76, 93, 116 and 118 fps. Under the load of other sessions, the default scene gave 28.5 fps with the panels
and 46.0 fps without the blur (12 alternating rounds, higher in 11).

A blur behind a panel costs this much because the canvas under it changes in every frame, so the browser blurs it
again in every frame, for each panel.

## Options

1. **Panels without a backdrop blur** (chosen), with a background that is more opaque.
2. Keep the blur. The panels look as before, and the app keeps the cost.
3. A blurred copy of the canvas drawn by the app once per frame for all panels. Less cost than six browser blurs,
   but still a full-screen pass, and the panels would need to sit over that copy.

## Decision

1. **No backdrop blur** (the owner's decision of 2026-11-11: "Unschärfe entfernen", after the measurement above).
   The toolbar groups, the brand bar, the settings panel, the scene name, the stats line and the notices
   (`src/App.svelte`, `src/ui/Toolbar.svelte`, `src/ui/SceneLabel.svelte`) and the backdrop of the Learn dialog
   (`src/ui/Learn.svelte`) draw no `backdrop-filter`. A test reads every style file in `src/` and fails if one uses
   it (`src/ui/glass.test.ts`).
2. **The panels' background goes from 0.88 to 0.94 opacity** (`--glass` in `src/app.css`), the opacity of the Learn
   dialog. My choice: without the blur, the moving trails behind a panel show through sharp, and 0.94 keeps them
   faint. The contrast of the text over a white canvas rises with it (the existing contrast test).
3. **The backdrop of the Learn dialog goes from 0.45 to 0.6 black.** My choice, for the same reason: the dialog
   covers the canvas, and the simulation around it now shows sharp.

## Consequences

- The panels look flatter: dark, nearly opaque, with no frosted picture behind them.
- Under another GPU client the app keeps about 1.5 to 2 times the frame rate it had.
- The items that this ADR left open on 2026-11-11 are closed by the amendment of 2026-11-12 below: the WebGL2 draw
  cost from #26, the frames that queue when the GPU is behind, the wraps in the render and simulation passes, the
  scent reads while there is no scent, the draw of an unchanged paused frame, and the draw cost when zoomed far out.
  That amendment lists what is still open.

## Amendment 2026-11-12: wraps, the scent of zeros, frames that show nothing new, frames in flight, the trail zoomed out

### Context

On 2026-11-12 the owner delegated the open items of this ADR. The coordinator of the work took the decisions 4 to 11
below under that delegation. Where the text says "my choice", the agent that did the work chose, and gives the reason.

All numbers are from the production builds on an Apple M3 Pro, headed Chromium, WebGPU on Metal and WebGL2 on ANGLE
over Metal, a canvas of 2560 × 1600 pixels, the grid 1536 × 960 picked in the panel. Other sessions used the GPU at
the same time (up to 950 ms of GPU time per second), so every comparison is paired: one page per build, the same seed
and steps, and in each round every build measures in turn, in an order that rotates. A value is the median over the
rounds; "×" is the median of the paired ratios, with the 95 % interval of that median from a bootstrap in brackets.
`main` is `140d46f`. The scenes: Three strains (4.4 M agents, the start scene), Transport network (Jones' model, one
agent per cell, moves first) and Maze (a box with walls and food).

"Same bytes" means: the SHA-256 of agents, trail, scent, counts, the view's trail and scent, and of 12 captured frames
(fitted, across the seam, a copy of the grid, zoomed in, the scent view, gel, paper, agents, and two frames zoomed
out) are those of `main`, after 300 steps with a cut and an inoculation, for 8 scenes (Three strains, Transport
network, Maze, Foraging maze, Light, Steiner tree, Wound, Dot grid) on both backends, and for 2 scenes with covered
food. The two frames zoomed out differ only from decision 9 on.

### Decision

4. **The WebGL2 draw cost of #26 is a bug, and it is fixed** (coordinator, 2026-11-12). The wraps stay exact in
   integers.
   - The cause, measured: on ANGLE over Metal an integer remainder costs also where a branch skips it. With the wrap
     of decision 5 in each of the 16 lookups of a pixel at 1.01 cells per pixel, the draw of Three strains took 4.1 to
     4.3 ms with the remainder behind a branch (`main`: 4.7 ms), 4.8 ms with the remainder behind a loop, 1.9 ms
     without any remainder in the shader, and 2.6 to 2.8 ms with the float division of `30b60ef`. A wrap whose far
     branch is a loop of subtractions took 3.0 ms: a real branch per lookup costs too. On WebGPU the remainder behind
     the branch costs less, but it costs: 1.97 against 1.69 ms.
   - The fix: a lookup wraps once. A bilinear lookup wraps its first cell and takes the next column and row by
     comparison (`bilinear()` in `render.wgsl` and `render.frag`). Every lookup reads its texel at the wrapped
     coordinates (`cellXY()`), with no cell index and no division to get the coordinates back from it (`coord()` in
     `view.glsl` is gone).
   - The result on WebGL2 against `30b60ef`, the build before #26 (12 rounds): the draw of Three strains × 0.86 (0.78
     to 0.98) fitted and × 0.90 (0.83 to 0.98) at 1.01 cells per pixel; Transport network × 0.83 (0.76 to 0.89) and
     × 0.84 (0.80 to 0.91); Maze × 0.83 (0.77 to 0.87) and × 0.98 (0.94 to 1.03). Against `main`: 2.0 → 1.5 ms and
     4.6 → 2.5 ms (Three strains), 1.4 → 0.9 ms and 4.1 → 1.9 ms (Transport network).
   - Every frame keeps its bytes.
5. **Wraps with comparisons inside one period, in the simulation and the render shaders, on both backends**
   (coordinator, 2026-11-12). `wrapCell()` (`common.wgsl`, `render.wgsl`) and `wrapAxis()` (`common.glsl`,
   `view.glsl`) add or subtract one period for a coordinate less than one period outside the grid, and take the
   integer remainder beyond. Every move, almost every sensor and every lookup of a fitted view is in that range. The
   agent and diffusion passes take a cell's coordinates from the wrap (`cellXY()`), with no division.
   - Same bytes as `main`, and the reference and GPU tests pass unchanged.
   - The step: no change that the measurement can show from the wraps alone (× 0.95 and × 1.05 of `main` in two scenes
     on WebGPU, × 0.97 and × 0.98 on WebGL2 against `30b60ef`; 10 rounds). The WebGL2 step of `main` is not slower
     than that of `30b60ef` (× 1.00 to × 1.02, 12 rounds): the report of 2026-11-11 had × 1.02 to × 1.05, inside its
     spread. A WebGL2 step without any remainder in its shaders took the same time (× 0.99 to × 1.00 of `30b60ef`).
   - The draw on WebGPU against `main` (12 rounds): Three strains 1.65 → 1.03 ms fitted (× 0.60, 0.57 to 0.64) and
     4.25 → 1.97 ms at 1.01 cells per pixel (× 0.46); Transport network 1.21 → 0.61 ms (× 0.51) and 3.81 → 1.54 ms
     (× 0.41); Maze, a box without wraps, × 0.91 and × 1.00.
6. **The scent is read from one texel while it holds only zeros** (coordinator, 2026-11-12: skip the scent while
   there is none, in the same pipeline; the form is my choice).
   - After a reset without food and without light the scent textures hold zeros, and no step changes that. The
     simulation then binds a texture of one texel as the scent of the agent passes and as the input of the diffusion
     (`scentless` and `noScent` in `sim.ts` and `gl/sim.ts`). A food or a light stroke, written food or light bytes
     and a written scent end it; a clear of the environment does not start it, because the scent stays until the
     next reset.
   - The coordinator asked for a branch on a uniform inside the same pipeline. My choice is no change of any shader.
     Reason: a branch changes the code that the compiler sees, and on Metal that has changed the rounding of code
     beside it twice (`agents.wgsl` on the wall check, `diffuse.wgsl` on `SENSE_FIRST`). With fast-math a compiler may
     also add the six terms of a sensor in another order when two of them are known to be 0, so no argument about
     zeros holds for every compiler. With the same pipeline and the same arithmetic on the same values, zeros, the
     result is the same on every GPU.
   - The read outside the one texel, exactly (coordinator, 2026-11-12). The passes read the texel of a cell, which
     lies outside a texture of one texel for every cell but (0, 0). WGSL (`textureLoad`, an invalid texel address
     on a texture that is no depth texture) returns the data of some texel inside the texture, or (0, 0, 0, 0), or
     (0, 0, 0, 1). WebGL 2.0 ("Differences Between WebGL and OpenGL ES 3.0", "Texel Fetches") makes a fetch out of
     range return zero for a complete texture, and (0, 0, 0, 1) for an incomplete one; the one texel is complete.
     The scent is `rg32float`, and each reader of the bound scent takes only `.xy`: `agents.wgsl:132`,
     `diffuse.wgsl:106`, `agents.frag:113`, `diffuse.frag:84`. The one texel holds 0 there, and so does every
     vector above, so each allowed result is 0. No reader takes `.z` or `.w`; one that took `.w` could get 1. The
     render and the scent view's map read the grid's scent textures, never the one texel. The diffusion still
     writes the scent of every cell: the zeros it wrote before.
   - Measured, both forms give the same gain: the step × 0.873 with one texel and × 0.873 with a uniform branch
     (Three strains, WebGPU, 10 rounds), × 0.84 and × 0.85 (Transport network).
   - The step with decisions 5 and 6 against `main` (12 rounds): WebGPU 4.38 → 3.74 ms (× 0.85, 0.84 to 0.86) for
     Three strains and 2.26 → 2.03 ms (× 0.89) for Transport network; WebGL2 × 0.94 and 4.36 → 3.74 ms (× 0.86).
     Maze has food, so nothing changes there (× 0.97 and × 0.99).
   - Same bytes as `main`. A test holds a simulation that reads one texel against one that reads the grid's
     textures, in both orders of a step, with and without the rule, before a food, with it, and after a reset
     without it.
7. **A frame draws only when it shows something new** (coordinator, 2026-11-12). Paused, the loop drew the same
   picture about 120 times per second, 1 to 2 ms of GPU time each.
   - `Engine.frame()` draws when one of these changed since the last drawn frame: the simulation itself (a rebuild),
     its step count (a step, also of a held tool or of the step key), its revision (a reset, a stroke, a sweep that
     paints, a clear, a scene load, written state, new settings of a step that moves first), the settings (every
     setting: style, colours, exposure, bloom, the scent view, the boundary, the lattice), the view (pan, zoom, fit),
     the canvas size, or the auto levels by more than 1/1024. It also draws after `invalidate()`, which the page
     calls when the tab shows again, and after `fitView()`, which the page calls when it has set the canvas size
     (that clears the canvas); and while a part of the picture is still being built (`Backend.draw()` returns false
     while the scent view's pipelines are not ready).
   - The canvas draws no brush and no tool cursor (the cursor is CSS), and no part of the picture follows a theme.
   - My choice: 30 more frames draw after the last change (`SETTLE_FRAMES`). Reason: the auto levels measure in drawn
     frames, every 6th on WebGPU and every 15th on WebGL2, and a result comes back some frames later. Each move of
     the levels starts the 30 frames again. Measured: 1.0 to 1.3 s after a pause no frame draws any more, and a pan
     while paused draws every frame.
   - My choice: the stats line reads "paused" in place of the frame and step rates while the simulation is paused.
     Reason: a rate of 0 would read as a fault, and the rate of the loop would say nothing about the picture.
   - `Engine.frames` counts the frames whose picture is current, drawn or not, so the frame rate of the stats and
     of the startup check (`ui/tune.ts`) is the rate of the loop as before. The startup check counts no paused
     time (`autoTune()` in `ui/state.svelte.ts`), so it cannot lower the grid for frames that did not draw. A scene
     slower than one step per frame draws only the frames with a step.
   - This changes no pixel. The dither of a kept picture stands still, because no frame draws.
8. **The loop starts no frame while two frames are in flight** (coordinator, 2026-11-12). `Engine.tick()` asks the
   frame budget how many frames the GPU has not finished (`FrameBudget.pending`: WebGPU counts
   `queue.onSubmittedWorkDone()`, WebGL2 a fence that it polls without blocking). At two it starts no frame and calls
   `FrameBudget.held()`, which lowers the budget by a quarter, as a frame that started with two in flight did before.
   The next frame runs the steps of the time since the last one. A frame asked for by hand (the step key) always
   runs.
   - Under a second browser that ran the start scene at 960 steps per second (5 interleaved rounds of 8 s): on
     `main` 5 frames were in flight, and a frame's picture was done 67 to 68 ms after the frame's start at the
     median (90 %: 73 to 75 ms, most: 84 ms), at 72 to 74 frames and steps per second. With the limit: 18.6 to
     19.2 ms (90 %: 24 ms, most: 35 ms), at 83 to 84 frames and 82 to 83 steps per second.
   - On WebGL2 the start scene at 960 steps per second is bound by the GPU alone (21 ms a step): 110 ms at the median
     and 6 frames in flight on `main`, 37 ms with the limit, at 46 against 48 to 49 frames per second.
   - Alone on WebGPU at 960 steps per second: 131 to 144 steps per second on `main`, 182 to 184 with this branch,
     both at 119 to 120 frames per second; the loop held a frame back about once per second.
   - The e2e suite, whose tests wait for steps, took 42 s before and after.
9. **Zoomed out, a pixel draws the mean of the trail under it, from a coarser map** (coordinator, 2026-11-12). Above
   1 cell per pixel a pixel took four bilinear taps, 16 cells far apart from those of the pixels beside it.
   - The map: `trailDown` (`render.wgsl`) and `trail-down.frag` fill a texture with the mean of the trail over the
     cells under each texel, for the level k = floor(log2(cells per pixel)), 1 to 4 (`trailLevel()` in `render.ts`).
     A texel of level k covers the grid side over ceil(side / 2^k) cells: on a side that 2^k divides that is the mean
     of 2^k × 2^k cells, the same as k times a mean of 2 × 2; on other sides a cell counts by the share that the
     texel covers, as in the scent view's map (ADR 0009). The texels tile the grid exactly, so the map wraps with the
     periodic grid. One texture of half the grid's sides holds the level in use. It is filled only for a frame that
     reads it, and only when the trail or the level changed: a paused view zoomed out fills it once.
   - The lookup (`trailArea()`): the mean over the square of the pixel, from the 3 × 3 texels that it can cover,
     each by the share under the pixel. Level 0 is the trail itself, up to 2 cells per pixel: there the result is the
     exact mean of the cells under the pixel. On the periodic grid the first texel wraps once and the others follow
     by comparison; outside a closed arena the trail counts 0, as before. The levels, the exposure and the tone curve
     get a trail value as before, now a mean.
   - My choice: the mean over the pixel's square, not a bilinear lookup of the map. Reason: at 1 cell per pixel it is
     the bilinear filter, so the picture does not jump at the change, and it leaves no cell out at any zoom. The
     four taps left cells out from 4 cells per pixel on, which showed as moiré.
   - This changes the pictures above 1 cell per pixel, in every style. No other frame changes: the same bytes as
     `main` but for the two frames zoomed out.
   - The draw of a paused view, before → after (8 rounds). Three strains on WebGPU: 4.4 → 2.6 ms at 1.5 cells per
     pixel, 4.6 → 1.8 ms at 2, 8.9 → 1.8 ms at 4, 27.7 → 1.9 ms at 8. Transport network on WebGPU: 4.3 → 1.3 ms,
     8.7 → 1.3 ms and 27.2 → 1.4 ms at 2, 4 and 8. Three strains on WebGL2: 5.1 → 2.7 ms, 10.7 → 2.4 ms and
     32.1 → 2.3 ms. A frame of the running start scene at 8 cells per pixel, a step and a draw with the map filled
     anew: 30.5 → 5.6 ms on WebGPU and 45.7 → 16.5 ms on WebGL2.
   - The map takes 4 bytes per cell of GPU memory from the first frame zoomed out to 2 cells per pixel. The memory
     fit of the grid counts it (decision 12).
10. **The sort stays at every 32 steps** (coordinator, 2026-11-12). The coordinator gave two reasons: another interval
    changes results with one agent per cell, and the report of 2026-11-11 found no gain in the average at 64. The
    first does not hold: the sort changes no result at any interval, with and without the rule (ADR 0005; the test
    "gives the same agents and trails as unsorted runs" holds intervals 1, 8 and 32). The second holds. Measured in
    the start scene: a step alone takes 4.3 ms and a step with the sort 7.5 to 7.9 ms; a
    frame, a step and a draw, 5.6 to 5.7 ms and with the sort 8.2 to 8.7 ms (20 sort steps each, two runs). In the
    loop at 120 Hz, 20 s, every frame started in its own refresh interval, and 99 % of the frames started with no
    frame in flight. The picture of a frame with the sort was done 8.0 ms after its start at the median (90 %:
    9.3 ms; other frames 5.2 and 6.3 ms): about 4 in 10 of these frames, 1 to 2 per second, end after the next
    refresh. On `main` nearly all of them did (9.9 to 10.1 ms).
11. **`main` against `45155a8`, the build of the first measurement** (coordinator, 2026-11-12; 12 rounds, three scenes,
    both backends). Nothing new is slower by a fault.
    - Two runs of 12 rounds. The step: × 0.99 to × 1.04 on WebGPU and × 0.98 to × 1.03 on WebGL2, inside the spread
      but for Transport network on WebGPU in one run (× 1.04, 1.01 to 1.07), which moves first now. The draw of `main`
      is faster: × 0.82 to × 0.91 on WebGPU, × 0.87 to × 0.96 on WebGL2. The cause was not examined; the panels
      without a backdrop blur (decision 1) share the GPU with the draw.
    - One cost is new: a scene that moves first draws the map after the step's diffusion (ADR 0027), which takes the
      step's diffusion passes once more per drawn state. A frame of Transport network, a step and a draw, takes
      3.58 → 3.88 ms on WebGPU (× 1.10, 1.05 to 1.12; × 1.06 in the other run) and 6.10 → 6.18 ms on WebGL2 (× 1.02
      and × 1.00). That is the cost of that decision. With this branch the same frame takes 3.02 ms and 5.18 ms.
    - The scent view and growth are off in every scene until the user turns them on; ADR 0009 and ADR 0025 hold
      their costs.

12. **The memory fit counts the two coarse maps of the view: a bug fix** (coordinator, 2026-11-12). `BYTES_PER_CELL`
    goes from 90 to 98 and `BYTES_PER_CELL_HALF_FLOAT` from 110 to 118 (`src/engine/sizing.ts`).
    - The trail's map of decision 9 and the scent view's map (ADR 0009, since #31) are each one `rgba32float`
      texture of half the grid's sides, on WebGPU and on WebGL2 with and without float blending (`render.ts`
      `coarseFor()` and `trailCoarseFor()`, `gl/backend.ts` the same): 16 B per texel, a quarter of a texel per
      cell, 4 B per cell each.
    - The user zooms out or turns the scent view on without a new grid, so the fit must hold both maps from the
      start. Before, a grid that just fitted its budget went over it by 4 B per cell with the scent view zoomed
      out, on `main` too; with decision 9 it would have gone over by 8.
    - Effect: a grid at the edge of its budget is one step smaller. The start scene needs 286 MB of the 512 MiB or
      more that a desktop gives, so it stays. A lattice of Jones needs 10.3 MB (12.1 MB without float blending),
      below the smallest budget of 32 MiB. One case no longer fits 32 MiB: 300 × 300 cells with the largest
      Capacity (8 agents per cell) and covered food on WebGL2 without float blending, 33.8 MB against 33.6 MB; it
      runs on a grid shaped like the screen there (ADR 0025 said 33.0 MB).
    - No test depended on the numbers: the unit and e2e tests of the fit take the constants or their own bytes per
      cell. Their comments and the ADRs that quote 90 and 110 B (0003, 0005, 0013, 0025, 0026) name the new values.
13. **The sort takes the place of one step in its frame** (coordinator, 2026-11-12, after decision 10).
    - `Engine.frame()` asks the simulation whether one of the frame's steps would sort (`Sim.sortDue()`). If so it
      runs the sort first, in a submission of its own (`Sim.sortNow()`), and one step less. A frame of one step is
      then the sort alone. The step that would have sorted runs without the sort. Steps asked for by hand run as
      asked, with the sort inside its step, and so do the steps of a tool held while paused, which keep their 60
      steps per second at any frame rate (ADR 0023). WebGL2 had no sort then; since decision 14 it sorts the order of
      its point passes, in the same turn. `Engine.sortOwnTurn` turns it off for measurements.
    - The sort changes no result (ADR 0005), also up to some steps ahead of its step: with the sort up to 2 steps
      ahead, in its own submission, 8 scenes keep the bytes of `main` on WebGPU at the same step counts, and a test
      holds agents and trail against a run that sorts inside its steps, with and without the rule.
    - Measured in the start scene at 120 Hz, 3 interleaved rounds of 20 s for each case. A frame counts as late
      when its picture was done more than 8.33 ms after the frame's start.

      | Speed (steps/s) | Sort            | Late frames with the sort | Their median    | All late frames | Frames/s | Steps/s             |
      | --------------- | --------------- | ------------------------- | --------------- | --------------- | -------- | ------------------- |
      | 120             | inside its step | 52, 27, 19 %              | 7.5 to 8.5 ms   | 0.7 to 1.8 %    | 120      | 120.0               |
      | 120             | its own turn    | 0, 0, 1 %                 | 4.6 to 5.0 ms   | 0.0 to 0.4 %    | 120      | 116.3 to 116.4      |
      | 960             | inside its step | 97, 99, 97 %              | 12.9 to 13.3 ms | 67 to 69 %      | 119      | 182.8, 188.0, 189.9 |
      | 960             | its own turn    | 63, 72, 64 %              | 8.9 to 9.6 ms   | 72 to 74 %      | 119      | 189.8, 192.3, 187.8 |

      With the sort in its own turn, "frames with the sort" are the turn of the sort and the frame after it.

    - The cost: at one step per frame, 1 turn in 33 runs no step, 3.0 to 3.1 % of the steps per second (120 →
      116.3). That is the largest cost: at two steps per frame it is 1 step in 64. At 960 steps per second the GPU
      sets the steps, and they did not fall (+1 %, inside the spread). The coordinator's limit was "more than about
      3 %": the cost at the scene's own speed lies at that limit by its construction, and the change is in.

### Consequences

- Against `main`, a frame of the start scene, a step and a draw, takes 5.56 → 4.44 ms on WebGPU (× 0.82, 0.77 to
  0.85) and 24.2 → 22.8 ms on WebGL2 (× 0.92); of Transport network 3.88 → 3.02 ms (× 0.77) and 6.18 → 5.18 ms
  (× 0.84); of Maze × 0.96 and × 0.98.
- Pixels: only decision 9 changes pictures, and only above 1 cell per pixel. Decisions 4, 5, 6 and 13 change no byte
  of the simulation and of any frame at a given step; decision 13 changes which step a frame shows, at 3 % fewer
  steps per second where a frame runs one step. Decision 12 changes which grid fits a small budget. Decision 7 changes the text of the stats line while paused. Decision 8 changes
  when frames start under load, not what they show.
- The wrap rule of ADR 0023 reads now: integers for every wrap, comparisons inside one period, the remainder beyond
  (amended there). A test holds `wrapCell()` of all four shader files to the integer remainder at −n − 1, −n, −1, 0,
  n − 1, n, 2n − 1, 2n and far outside, for sides from 1 to 4096 with 33, 47, 246 and 480, on both backends.
- New tests (ADR 0010): the wraps; the scent from one texel; in Node, each input of a picture makes a paused frame
  draw, the frames stop after `SETTLE_FRAMES`, and the loop starts no frame with two in flight; on both backends the
  paused frames stop once the levels rest, and the pictures zoomed out match a CPU model of the mean at 1.01 to 8
  cells per pixel, on sides that no power of two divides and in the copies of a periodic grid; in the app, the stats
  line. Mutations that these tests caught: a wrong end of the comparison range in each of the four shader files; a
  scent that stays "zero" after a food; a lookup of two columns; whole cells in the map on an odd side; a wrap of the
  map by the grid's size.
- SwiftShader divides exactly and runs both sides of a branch, so CI shows neither the cost of a remainder nor a
  wrong wrap on a real GPU: the measurements and the byte comparison of this amendment are local, on Metal.
- Still open:
  - The gel style zoomed out still takes four taps of its height field for each of its five height lookups: about
    1 ms more than glow at 4 cells per pixel and 2 ms at 8 before this change.
  - Food, light and walls zoomed out: a pixel reads the 3 × 3 cells of the outlines around its centre, far apart
    from those of the pixels beside it. A closed arena fills only a part of a view zoomed out (Maze: 1.0 to 1.3 ms
    at 2 to 8 cells per pixel), so this was not measured further.
  - The agents style zoomed out shows the cell under each pixel's centre, not a mean.
  - WebGL2 ran a step of the start scene in 21 to 24 ms, WebGPU in 3.7 ms. The wraps are not the cause (a step
    without any remainder took the same time). The amendment below finds the cause and closes most of the gap
    (decision 14).
  - Other GPUs and browsers, a display of device pixel ratio 1, and an idle machine were not measured.

## Amendment 2026-11-12 (2): the WebGL2 step

### Context

The amendment above left one item open: on the same M3 Pro, WebGL2 ran a step of the start scene in 21 to 24 ms and
WebGPU in 3.7 ms. The coordinator asked for the cost of each pass, and for a fix or a measured reason why the cost
stays. Under the owner's delegation of 2026-11-12 the agent that did the work decides, and records its choices here.

Setup: production builds, headed Chromium 158 (Playwright 1.65), WebGPU on Metal and WebGL2 on ANGLE over Metal, a
canvas of 2560 × 1600, the start scene on 1536 × 960 cells. WebGPU runs 4,423,680 agents, WebGL2 4,194,304 (its limit
of 2^22). Other sessions used the GPU. A round loads each case in turn into one browser window, in an order that
rotates. A case runs 400 steps and then measures in samples of 32 steps between fences, so each sample holds one sort.
A value is the median over 8 rounds, with the smallest and the largest in brackets. "Before" is `12ce1a2`, the tree of
`main` after #39. All builds of this amendment, before and after, used vite 8.3.6, the version in the `node_modules`
of the checkout at that time; the lockfile asks for 8.3.7 since #38. The suites of this change (lint, check, the unit
tests, the GPU tests, the build and the e2e tests) ran with 8.3.7.

The cost of a pass is the wall time of a step that runs only that pass, less that of a step that runs no pass. On
WebGL2 the times of `EXT_disjoint_timer_query_webgl2` overlap: the queries of one step summed to 60 ms against 27 ms of
wall time, also with a flush around each query. On WebGPU the timestamps of each dispatch, in a pass of its own, agree
with the wall time to 0.05 ms.

| Pass, ms per step             | WebGL2 before          | WebGL2 after           | WebGPU                                 |
| ----------------------------- | ---------------------- | ---------------------- | -------------------------------------- |
| agent pass                    | 2.43 (2.26 to 2.85)    | 2.65 (2.32 to 3.06)    | 1.68 (1.53 to 1.88), deposits included |
| clear of the counts           | 0.18 (0.12 to 0.23)    | 0.17 (0.15 to 0.23)    | in the step's clears                   |
| deposit (one point per agent) | 14.86 (12.99 to 16.43) | 6.84 (5.91 to 8.53)    | in the agent pass (`atomicAdd`)        |
| sort, one in 32 steps         | none                   | 0.59 (0.57 to 0.75)    | 0.09 (0.07 to 0.10)                    |
| diffusion, first pass         | 1.16 (1.03 to 1.35)    | 1.13 (1.08 to 1.28)    | 0.89 (0.79 to 0.98)                    |
| diffusion, second pass        | 0.96 (0.84 to 1.15)    | 0.93 (0.85 to 1.02)    | 0.65 (0.60 to 0.72)                    |
| a step that runs no pass      | 0.11                   | 0.12                   | 0.26                                   |
| the whole step                | 18.45 (16.76 to 20.79) | 12.00 (10.60 to 14.48) | 3.58 (3.23 to 3.79)                    |

The details of the measurements below are in
[webgpu-platform](../knowledge-base/webgpu-platform.md#webgl2-point-passes-on-a-tile-based-gpu-measured-2026-11-12).

- The cause is the deposit. `deposit()` (`src/engine/gl/sim.ts:1050` before this change) draws one point per agent
  (`gl.drawArrays(gl.POINTS, 0, this.agents)`, `:1103`), and point k draws agent k (`points.vert:17`). A few steps
  after the start, the agents of that order lie anywhere on the grid. WebGPU adds its deposits with `atomicAdd` in the
  agent pass and sorts its agents by 8 × 8 tiles every 32 steps (ADR 0005).
- The deposit alone after 400 steps took 15.7 to 22.2 ms. Without blending, into other formats and with less vertex
  work it cost the same. With every point culled in the vertex shader it took 1.1 to 1.3 ms. Point k into pixel k
  modulo the cells, so that points that follow each other lie side by side, took 3.1 to 4.2 ms, and each point into a
  random pixel of its own tile of 32 × 32 cells took 21.1 ms. So the cost follows the order of the points on the
  screen. Apple GPUs sort the primitives of a render pass into screen tiles before they shade them. The binning of
  scattered points is the likely cause; no GPU counters were available to show it.
- A second cost: after 400 steps 7 % of the cells hold all agents that moved, up to 9602 in one cell. Points on one
  pixel blend one after the other: every point on one pixel took 357 ms, and the agents sorted by cell, so that the
  agents of a dense cell follow each other, 58.5 ms.
- The agent pass costs 2.4 to 2.7 ms on WebGL2 against 1.7 ms on WebGPU with its deposits: WebGL2 does not move its
  agents, so the sensors read the trail in a scattered order (WebGPU unsorted: 2.6 ms, the amendment above). The
  diffusion costs 0.5 ms more on WebGL2. These were not examined further.

### Options

1. Keep the cost, as a cost of the design of the fallback.
2. Sort the agents themselves, as WebGPU does. The random streams then need an id per agent. WebGL2 keeps the bits of
   an agent as an exact float of 24 bits, of which the strain and the markers take 6, and the id needs 22 more. The
   tools, growth, `writeAgent()` and the readbacks would find agents by id. The agent pass would gain too.
3. Sort only the order in which the point passes draw the agents. Every point pass sums integers or takes a maximum,
   which is exact in 32-bit floats below 2^24, so no order changes a result. The agents stay where they are.
4. Spread the agents of a cell over more texels by index, then sum them. Alone it gave nothing: 16.4 ms for 2 texels,
   21.4 for 4 and 28.8 for 8, against 19.4.

### Decision

14. **WebGL2 draws its point passes in an order sorted by tiles** (option 3; my decision, 2026-11-12, under the
    owner's delegation).
    - The order (`src/engine/gl/glsl/order.frag`): per agent slot a key and an agent index, in two `RG32F` textures
      in the layout of the agents. The key is the tile of 64 × 64 cells that holds a living agent's cell; a dead agent
      and a slot past the last agent get the key after the last tile. An LSD radix sort of 2 bits a pass, in fragment
      passes: per pass a pyramid of digit counts with a fan-in of 4 (`pyramidLevels()`), then a gather in which each
      slot of the new order walks down the pyramid to its element. Each pass is stable, so the order is sorted by tile
      and, inside a tile, by agent index. The start scene has 361 keys: 5 passes.
    - Point k draws the agent of slot k (`points.vert`). Every point pass uses the order: the deposit, the claims and
      the occupancy of collision mode, covered food, the alive tally and the start claims.
    - The sort runs every 32 steps, as on WebGPU, and the engine gives it a turn of its own (decision 13):
      `GlSim.sortDue()` and `GlSim.sortNow()` work as in `sim.ts`. A reset starts with the agents' own order, and its
      step 0 sorts.
    - My choices, with the measurements of the knowledge base.
      - Tiles of 64 cells: the deposit took 9.2 ms against 10.0 for 128 and 10.3 for 32, in one page.
      - A fan-in of 4: the sort took 24 ms against 30 to 36 with 16, for 4.3 B more per agent.
      - A sort every 32 steps. The deposit alone, with its clear, after a sort (3 rounds): 6.4 to 7.5 ms at once, 8.0
        to 9.4 after 16 steps, 8.3 to 9.0 after 32, 10.7 to 11.3 after 64 and 11.6 to 12.7 after 128; 14.4 to 16.2 in
        the agents' own order. With the sort's 18.9 ms spread over its interval, a step costs about 9.0 ms at 16, 8.8
        at 32 and 9.3 at 64. The differences lie inside the spread; 32 is the lowest and keeps the interval of WebGPU.
      - Not option 2: it needs a new layout of the agents and touches the tools, growth and the readbacks, and option 3
        gets the gain of the deposit without them.
      - No second texel per cell. With the order, 2 texels per cell side by side, by the parity of the slot, took the
        deposit from 9.2 to 6.5 ms in the lab. In the step they gave nothing (8 paired rounds): the deposit 0.57 ms
        less, the wider clear 0.23 ms and the sum pass 0.64 ms more, the step × 0.995 (0.93 to 1.05). They would cost
        32 B per cell and half the largest grid side.
    - Paired against the build before (8 rounds): the WebGL2 step × 0.659 (0.620 to 0.727, the 95 % interval of the
      median from a bootstrap), the deposit 7.75 ms less (6.36 to 9.20). The agent pass took 0.18 ms more (0.09 to
      0.28); the cause was not examined. WebGPU × 0.996 (0.977 to 1.054).
    - The sort in its turn (`sortNow()`) takes 22.8 ms (20.3 to 24.5): the keys 1.5 to 1.9 ms, the 55 level passes
      7.5 to 7.9 ms and the 5 gathers 11.8 to 12.2 ms.
    - The app's own loop on WebGL2, on 1536 × 960, 4 paired rounds of 8 s each in a window off the screen. At the
      scene's speed of 120 steps per second: 58.1 to 59.2 frames and steps per second before, 77.5 to 79.1 frames and
      75.2 to 76.7 steps per second after. The turn of the sort runs no step (decision 13), so 1 frame in 33 shows no
      new step. At 960 steps per second: 43.0 to 44.4 steps per second before, 75.1 to 77.9 after. The median time
      between two frames fell from 19.7 to 19.8 ms to 10.1 to 10.3 ms. Frames more than 30 ms after the frame before:
      0.6 to 1.7 % at the scene's speed and 10.5 to 16.3 % at 960 before, 0 to 0.8 % after.
    - Same bytes: the SHA-256 of agents, trail, scent, counts, the view's trail and scent and of 12 captured frames
      are those of the build before, for 8 scenes (Three strains, Transport network, Maze, Foraging maze, Light,
      Steiner tree, Wound, Dot grid) on both backends after 300 steps with a cut and an inoculation, with the sort in
      a turn of its own as the engine runs it, and for 2 scenes with covered food.
    - Memory: 22 B more per agent on WebGL2, the two orders of 8 B and the pyramid of about 5.33 B per slot
      (`BYTES_PER_AGENT_GL` = 54, `Backend.bytesPerAgent`). The start scene needs 371 MB on WebGL2 (279 MB before) of
      a budget of 512 MiB. A grid of 2048 × 1280 with its 4,194,304 agents needs 483 MB, and still fits. Jones'
      lattice of 300 × 300 fits a budget of 32 MiB (0.25 GB of device memory) on WebGL2 up to a Capacity of 5.09
      agents per cell with float blending and 4.70 without it with covered food; before, up to 8.59 and 7.93.

### Consequences

- A step of the start scene on WebGL2 takes 12.0 ms instead of 18.5 ms, and WebGPU is unchanged. No byte of the
  simulation and of a frame changes at a given step.
- New tests (ADR 0010), on WebGL2: the order holds each slot once, sorted by tile and inside a tile by index, with the
  keys of the agents at the sort; three scenes, with and without collisions, sorted every 1, 8 and 32 steps, give the
  agents, trail, scent and counts of a run in the agents' own order (a periodic grid, a box with a wall, shrinkage and
  both agent tools, covered food); the sort ahead of its step gives the state of the sort inside its step; on both
  counting paths the counts of a grid of several tiles, in the order of the sort, match a CPU count at steps 1, 33
  and 64. In Node: the fit counts the backend's bytes per agent. Mutations that the tests caught, on the final shader:
  a gather that stops one child early (`below + m < r` in `DESCEND`), caught by all 11 tests of the order; the axes of
  the tile key swapped, caught only by the test of the order itself, because no order changes a result.
- Still open:
  - The rest of the gap: WebGL2 12.0 ms against WebGPU 3.6 ms. The deposit with the order still takes 5.9 to 8.5 ms:
    the floor for 4.2 million points in an order of neighbours without shared pixels was 3.1 to 4.2 ms, and the dense
    cells add to it. The agent pass reads the trail in the agents' own order; option 2 would order it too.
  - The sort turn of about 23 ms every 32 steps is a long frame. Spread over several steps it would need a third order
    texture, 4 B or 8 B more per agent.
  - A GPU that renders without tiles was not measured: there the scattered order may cost less, and the sort costs its
    0.6 ms per step all the same.
