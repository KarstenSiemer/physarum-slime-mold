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
      steps per second at any frame rate (ADR 0023), and WebGL2, which has no sort. `Engine.sortOwnTurn` turns it
      off for measurements.
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
  - WebGL2 runs a step of the start scene in 21 to 24 ms, WebGPU in 3.7 ms. The wraps are not the cause (a step
    without any remainder took the same time); the cause was not examined.
  - Other GPUs and browsers, a display of device pixel ratio 1, and an idle machine were not measured.
