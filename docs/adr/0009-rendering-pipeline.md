# 0009: Rendering pipeline

- Status: accepted (revised 2026-11-08 after the visual review loop; amended 2026-11-10: food,
  light and walls)
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
   The gel lighting reads the height at five points per pixel. A pass before the main pass
   writes it once per frame at grid resolution, with a one-cell border, into an `r16float`
   texture (filterable everywhere): the summed trail above the black level times the exposure.
   That value is affine in the trail, so hardware bilinear filtering of it gives what filtering
   the trail first gave; only the exponential and the clamp at zero come after the lookup. Before,
   each of the five reads ran the full manual trail filter (4 to 16 `rgba32float` loads). The
   border makes the texture two texels larger than the grid, so both backends report the texture
   size limit minus 2 as their largest grid side.
   Compared with the old shader at the same state (identical trails, levels and dither), in
   over 100 views on WebGPU and WebGL2: wrap, box and dish boundaries; fit, 2×, 6×, the largest
   zoom and zoomed out to 3 cells per pixel; device pixel ratio 1 and 2, up to 2560 × 1440. At
   most 2 of 255 per channel apart (at single pixels), mean below 0.02. A GPU test compares the
   gel with a CPU evaluation of the old shader (`src/engine/sim.gpu.test.ts`). On the M3 Pro the
   gel frame cost 7.4–9.3 ms before and 1.7–2.3 ms after (glow: 1.3–1.8 ms).
5. Strain palette: gold, cyan, coral, violet at similar lightness; OKLCH helper for new colors.

Not done: HDR canvas output (`rgba16float` + extended tone mapping exists only in Chrome 129+;
Firefox has neither). Listed under "later" in TODO.

## Consequences

- One full-screen pass plus five small bloom passes per frame, independent of the step count.
- Every preset is exposed without manual tuning, because levels follow the data.
- Screenshot comparisons must call `settle()` first; the gallery and PNG export do.

## Amendment 2026-11-10: food, light and walls

### Context

The render pass drew food and walls from the cell under each pixel, over the styled trail: food at
90 % opacity, walls at 100 %. A cell is food or wall when its centre lies within the brush (`env`,
ADR 0007), so every outline showed the cells: 5 device pixels each on a 512 grid at device pixel
ratio 2, 30 at 6× zoom. Food hid the trail on it. In collision mode food fills with agents that
cannot move, and a blocked agent deposits nothing (Jones 2010, p. 133): in the Transport network
at step 800, 680 agents sat in 697 food cells, 4.4 % of them had moved, and the trail there stayed
at the black level (visual study, 2026-11-09). So food looked empty even below the trail. The
agents style drew only the agents that moved in the last step. The owner chose the oat flake with
presence for food (decision D2) and the bevelled ridge with light for walls (D3).

### Decision

1. **Outline distances.** The brush also writes a value per cell that only the renderer reads
   (`shape`: a storage buffer on WebGPU, an `RGBA8` target on WebGL2), one byte each: the signed
   distance to the wall outline and to the food outline in cells, positive inside, clamped to
   ±4 cells, 128 and up inside; the light of `env`; and the drop shadow of the walls (item 2).
   Unions take the maximum, a wall over food and the eraser the minimum with the complement. Each
   byte is then held to `env` (item 2), so the sign at every cell centre equals `env`. The
   simulation reads `env` as before. Both backends write it inside `Sim.paint`, for every segment
   of a stroke (`paintSegments`, ADR 0019), over the segment's outline box: its paint box grown by
   4 cells, at most one grid per side (`outlineBox` in `src/engine/brush.ts`). The paint and the
   outline pass measure the distance of a cell with one `strokeDistance` (`paint.wgsl`; WebGL2
   `gl/glsl/brush.glsl`): to the segment and, on the periodic grid, to its copies one period away.
   WebGPU dispatches `outline` right after the segment's paint dispatch, in the same compute pass
   and with the same brush slot (`src/engine/sim.ts`, `paint()`). The dispatch rounds the box up to
   whole workgroups of 16 × 16; the invocations past the box return (the slot holds the box size),
   since on the periodic grid they would wrap onto cells of the box and visit them twice. WebGL2
   draws it with `MAX` blending for unions, `MIN` blending for subtractions and plain writes for
   the light and the shadow, scissored to the same box, split where it crosses the edge of the
   periodic grid and cut to the grid in a closed arena (`gl/glsl/shape.frag`), in runs of segments
   (item 11). Both backends update the same cells, also for a box wider than a closed arena, and
   neither outlines a segment outside one. Before, WebGL2 took the whole axis of a closed arena for
   such a box: it outlined cells beside the box and the outline of a stroke wholly beside the grid,
   where WebGPU did not, and where bytes were not held yet the two drew different pictures (review,
   2026-11-10). Anything that repaints through `Sim.paint` rebuilds them. A dish leaves the cells
   outside it alone, as `paint` leaves their `env` alone: what other boundaries painted there stays
   whole for them.
2. **Held to `env`.** A subtraction keeps the distance to the old outline: painting a stroke and
   erasing it with the same brush left a crease along the old outline, and a larger eraser one
   between the two outlines. Zoomed out past 3 cells per pixel, where the coverage ramp of a pixel
   is wider than 3 cells, the crease bytes were covered (up to 108 of 255 in gel at 8 cells per
   pixel, the farthest the engine zooms out), and a stroke erased next to remaining food left its
   old outline beside it at any zoom. After a subtraction, at every cell of the segment's outline
   box, a byte of a cell where `env` does not hold its layer is held at most at the distance k − 1.5
   cells, with the nearest cell of the layer k cells away (Chebyshev, up to 5 cells; none: 0). That
   is a bound, not a guess: the spline of item 3 rebuilds an outline only within the 3 × 3 cells
   around a cell of the layer. The box holds every cell within 5 rings of a cell the brush paints,
   so every byte whose hold the brush can change. At first only the bytes within 4 cells of the
   brush were held, but a brush can take the last cells of a layer near a byte up to 5 · √2 = 7.07
   cells from its outline: in 15 of 40 random seeds of food and erasers (64 × 48, periodic grid,
   WebGPU) food bytes kept a hold for cells that were gone. Cells right next to remaining food
   (k = 1) cannot tell an old outline from the food's own: there the food's outline can move by up
   to about half a cell where an erased outline met it. A stroke's own byte, of a union and of a
   subtraction, is held in the same way to the cells the stroke paints itself: at a cell it does not
   paint, at most the byte of k − 1.5 cells outside, with the nearest cell it paints k cells away.
   Beside the edge of a box or the rim of the dish a stroke can pass near cells of the arena and
   paint none of them. Before, a union there gave the cells next to the edge the bytes of just
   outside its outline, and nothing held them: a fast drag that leaves a box at a shallow angle drew
   a line along the edge for as long as it ran on outside (review, 2026-11-10: in a box of
   256 × 144, food bytes from 126 down to 72 in row 0 over 170 cells past the last food cell, 47 to
   61 levels in glow and gel at 1 cell per pixel and 83 to 113 at 3 cells per pixel, on both
   backends). An eraser beside the edge carved the outline of food that it did not erase. The
   search is skipped where it cannot lower the byte. A stroke of radius 0.75 cells or more (r)
   paints a cell at most d − r + 1.43 cells from a cell at distance d wherever a cell centre of the
   arena lies within √0.5 cells of the point r − 0.72 cells from the stroke toward that cell. That
   point has such a cell centre on the periodic grid, in a box where the point of the stroke nearest
   to the cell lies in the grid, and in the dish where the brush around it lies in the dish
   (`ownHeld` in `paint.wgsl`). In the dish the nearest point alone is not enough: a thin stroke
   0.04 cells inside the rim painted one cell and came nearer to the cells 2 to 5 rows away than
   that cell allows (a GPU test). The hold depends on the stroke alone, so a run of outlines gives
   the same bytes in any order (item 11), and a stroke that paints no cell changes no byte. The drop
   shadow comes from `env` itself: the share of wall cells under a cone of radius 1.5 cells around
   the point 1.8 cells toward the light, so an erased wall casts none. Before, the shadow of an
   erased wall stayed on screen (up to 29 of 255 in paper).
3. **Reconstruction.** The render pass rebuilds the values at each pixel with a quadratic B-spline
   over the 3 × 3 cells around it. It reproduces a linear distance exactly, so straight outlines
   are exact at any zoom. Its gradient is continuous, so curves stay round and lit rims have no
   seams. Bilinear interpolation of 4 cells, as in the prototype, drew a food disc of radius
   3.2 cells as a polygon at 30 device pixels per cell, with the cell edges visible in the light
   of its rim. Coverage is a ramp one pixel wide. The 3 × 3 cells decide whether anything is
   painted near the pixel; only then does the pass rebuild. When the cell under the pixel alone
   decided, the light of a cell, which reaches into its neighbours, was dropped at the cell next to
   it: a small light ended in steps along the cell edges (57 of 255 in glow at 10 pixels per cell,
   8 with the 3 × 3 cells).
   - The spline weighs the cell under a point 0.5625 at its centre, so food or a hole thinner
     than about half a cell, or a ring of single cells that an eraser left along the edge of
     food, came out on the other side of its outline there, unlike `env` (a ring of 24 food
     cells drew none). Where the spline puts a cell centre on the wrong side, a bump that is the
     cell's own value at its centre and fades to nothing at the cell's edges sets it right, for
     the coverage only.
   - A stroke's distance has a crease along its middle line, and the spline smooths a crease
     differently at every position against the grid: the lit bevel of a thin wall showed beads with
     the period of the cells (9 to 14 levels along its ridge, radius 0.75 to 1.5 cells). The outline
     pass rounds the distance of a union off near the middle line, where the crest lies within the
     lit slope (1.5 cells for walls, 2 for food): within ρ = min(r, 2 · slope − r) of the line a
     parabola that meets the distance with the same value and slope. The spline rebuilds a
     parabola alike at every position, and the outline (distance r) stays where it is. Along the
     ridge: 1.3 to 2.9 levels, the dither.
4. **Food** (design B): an oat flake below the trail; glow, gel and paper draw the trail over it.
   It has a grain fixed to the dish, a rim that rises over 2 cells lit with the gel's light, and
   an outline per style, light in glow and gel, dark in paper. The grain is value noise with a
   whole number of lattice steps across the grid (about 320 on the long side, 4 pixels each when
   fitted to a 1280 pixel canvas), so it repeats with the periodic grid and has no seam. The gel
   style draws its trail as an opaque gel, which hid food under thick trail completely (Shortest
   path at every zoom): the gel is clear enough to show the flake, its albedo over food mixed with
   the flake's colour by 0.6 (`GEL_CLEAR`). The trail on food then changes the colour by 23 % of
   what it changes on the bare dish (Metal), against 10 % with food drawn over the trail. Decided:
   `GEL_CLEAR` stays 0.6 (owner decision 2026-11-10).
5. **Walls** (design B): a ridge whose outer 1.5 cells slope up, lit with the gel's light, with an
   albedo per style and the drop shadow of item 2. Walls hold no trail, so the trail fell to
   nothing towards their cells, in steps along a slanted wall that its smooth outline no longer
   covered: dark teeth in the gel's light (up to 78 levels), up to 82 levels in paper within half a
   cell of the wall. In the gel height pre-pass a wall cell takes the mean height of its neighbours
   outside walls; in the main pass, zoomed in, the bilinear trail filter leaves the cells of walls
   out and scales the other weights up to 1. Both run only in the pass with the environment.
6. **Presence** (display only, collision mode): occupied food cells are drawn as trail at a fixed
   level, tone value 1 − e^−0.9, in the strain ratios of the trail around them, strain A where
   there is none. The weight of a cell rises from 0 at the food outline to 1 at 1.5 cells inside,
   so the rim of the flake stays visible, and the spline of item 3 smooths it. It feeds the glow,
   the paper and the gel height pre-pass, where each texel is weighted as the spline weighs it at
   the cell centre, so packed food has no sharp dents. This departs from drawing only the trail:
   in Jones' model a blocked agent deposits nothing (p. 133), and presence shows it anyway.
   Without collisions it is off. The height pre-pass runs its 3 × 3 presence weights only for a
   texel whose own food byte is above 0: a byte of 0 lies 4 cells outside the food, so none of
   the 9 cells holds food. Before, it ran them for every texel of the grid once anything was
   painted, 1.6 ms more per frame at 2048 × 1280 in gel (Metal).
7. **Agents style** in collision mode: the occupancy adds the agents that stayed put, in the strain
   ratios of their cell's trail. The occupancy has no strains; the agents that moved keep their
   colours from `counts`.
8. The box edge and the dish rim fade over one pixel into the outside colour. An outline that
   touches the edge of a closed arena stays whole up to it: the renderer reads the cells inside,
   clamped to the box, and outside the dish the cell inside the rim on the way to its centre.
9. Without any painted environment (`hasEnvironment` is false until something other than the
   eraser is painted after the last clear), both backends draw with variants of the render pass
   and the gel height pass without this code (`override ENV` in WGSL, `#define ENV` in GLSL).
10. **A change of boundary.** `env` stays when the boundary changes (`Engine.apply`, ADR 0007). A
    dish counts only the cells inside it, the periodic grid has neighbours across its edges, and
    both decide the holds of item 2 and the shadow. After a change, before the next stroke,
    readback or frame, `refresh` (`paint.wgsl`; WebGL2: shape.frag op 3, which reads a copy of
    one 512 × 512 tile at a time) holds every byte of the new arena to `env` again and computes
    its light and shadow anew. A replay (ADR 0019) paints every edit under the boundary it was
    painted under, so its outlines follow the boundaries of the edits. After strokes under another
    boundary than the one on screen, `refresh` runs before the next readback or frame, not before
    the next stroke, so one call of `Sim.paint` gives the bytes of one call per stroke.
    `Sim.writeEnv` (tests only) clears the outlines and holds them in the same way. Before, after a
    switch from the dish to the box, outlines that a dish stroke had continued past the rim stood
    where `env` held nothing (60 cells of food and 34 of walls in a test), food that a dish eraser
    had left outside the rim vanished from the picture, and light painted before went missing.
    `refresh` also holds each byte from below: a cell that `env` does not hold keeps at least the
    byte of d cells outside, with the nearest cell of its layer in the arena d cells away
    (`floorByte` in `paint.wgsl`; the dish counts). The outline runs between the two cells, so it
    lies at most d cells away. Strokes keep every byte at least this high, because the distance to
    a segment changes by at most d between two cells d apart. Only cells that the old boundary did
    not count can lie below it. Before, after a switch to an arena that counts more cells (from a
    box to the periodic grid, or from the dish to a box or to the periodic grid), the cells across
    the edge of the periodic grid and outside the old rim of the dish kept the byte of 4 cells or
    more outside next to walls and food (856 wall cells of the Maze at x = 0 after a switch from
    the box to the periodic grid). The renderer then drew the outline there from a step: at 8
    cells per pixel, walls up to 77 levels and food up to 193 levels from a reference painted
    under the new arena (review, 2026-11-10, both backends). The search of 3 rings doubles the
    cost of `refresh`, once per change of boundary: at 3072 × 1920 with food and walls, 14.5 to
    15.4 ms instead of 7.6 to 7.9 ms on WebGPU and 20.9 to 22.9 ms instead of 11.5 to 11.8 ms on
    WebGL2 (M3 Pro, paired in one page, load average 6).

11. **Many strokes in one call.** A replay of the edit list (ADR 0019) paints up to 100,000 strokes
    in one call of `Sim.paint`, and one call gives the bytes of one call per stroke and of one call
    per segment. WebGPU dispatches each outline right after its paint, and each dispatch sees the
    writes of the one before it. For the eraser and walls, whose holds and shadow read `env` around a
    cell, its outline pass loads `env` of its 16 × 16 cells and of 5 cells around them into
    workgroup memory once; the holds, the light and the shadow read it there, and the nearest cell
    of each layer comes from a Chebyshev distance taken along the rows and then the columns of that
    tile. Before, each cell read up to 268 cells of `env` one after another, and an outline dispatch
    took about 12.5 µs against 2.9 µs for its paint dispatch (20,000 segments, M3 Pro). Food and
    light read `env` only at their own cell and load no tile. A workgroup whose cells all lie more
    than 4.05 cells inside an eraser writes 0 and reads nothing (`eraserCore`): the eraser's byte is
    255 there, and every cell that a shadow weighs (within 3.3 cells) is erased too. Each segment
    takes one of six pipelines of the outline pass, made from `paint.wgsl` with override constants:
    with or without the tile (`TILED`), the core test only for erasers of 14.66 cells or more
    (`CORE`), and the search of item 2 only where some cell of the box may need it (`OWN_SEARCH`,
    `ownHeldEverywhere` in `src/engine/brush.ts`). A condition fixed for a pipeline costs nothing;
    with them as tests at run time, replays of walls and of erasers took 10 to 14 % longer than
    before the review fixes, now 3 % less to 1 % more. The pipelines cost time to build: on
    SwiftShader (the CI image) a new device with its first simulation took 16.2 to 16.8 s against
    9.4 to 10.4 s with one outline pipeline (ADR 0010); on Metal 6 to 18 ms either way. One pipeline
    with the conditions as tests builds as fast as before, and its replays of walls and erasers take
    10 to 14 % longer (TODO.md, owner). WebGL2 changes its render target from `env`
    to `shape` and back for every run of outlines, about 55 µs each time on the M3 Pro, so it draws
    the outlines of a run of segments after the paint draws of the run. A run ends where the
    boundary changes, or where a segment of another kind meets it: its outline box meets the outline
    box of a segment of the run (`PendingOutlines` in `src/engine/brush.ts`, in buckets of 16 × 16
    cells). An outline box holds every cell within 5 rings of a cell its segment paints, and the
    outline of a cell reads `env` only within 5 rings of it (the holds; the shadow within 3.3
    cells). So segments of another kind whose boxes do not meet change no cell that the other reads
    or writes. The first merge grew the boxes by 5 more cells: that ended 12 % more runs (5,545
    against 4,934 for 100,000 strokes at random places on the periodic grid, 5,416 against 4,827 in
    a box; review, 2026-11-10) and changed no byte. Segments of one kind may overlap: unions take
    the maximum and subtractions the minimum, the side of the outline follows `env`, which a run of
    one kind only grows or only shrinks, the holds of item 2 depend on the stroke alone or on `env`
    after the run, and a subtraction holds its whole box. So the outlines give the same bytes after
    the run's paint as after each segment's paint. In a run each segment draws its union (op 0) or
    its subtraction
    (op 1) over its box. Then, once per cell of the union of the run's boxes of a kind
    (`unionRects`), op 4 draws the hold of the subtracted layers with `MIN` blending and op 2 the
    light and the shadow. Where the hold searches fewer cells per segment, without the cells where
    the segment's subtraction wrote 0, as for a single large eraser, op 1 takes it in the same draw
    (`MIN` blending of both), and an eraser's light and shadow follow per segment, with no fetch deep
    inside it. `unionRects` marks the boxes as bits over their bounding box: for the 100,000 boxes
    of a drag it took 46 ms instead of 479 ms (Node, M3 Pro) and gave the same rectangles. Food
    draws nothing over the union and skips it.

### Consequences

- 4 B more per cell: `BYTES_PER_CELL` 90, `BYTES_PER_CELL_HALF_FLOAT` 110.
- Without environment the pass draws the pixels of before: compared with the render pass of
  ef7f2af in one page, at the same state and uniforms, 0 of 255 apart in glow, gel and paper on
  wrap, box and dish, on WebGPU and WebGL2 at 2560 × 1600. Only the box edge and the dish rim
  (item 8) and the agents style in collision mode (item 7) differ, as intended. A GPU test holds
  every style there against CPU references of the formulas of ef7f2af, and another checks that
  the pass without environment ignores `shape` until something is painted.
- Render cost, paired in one page against the render pass of ef7f2af at 2560 × 1600 on the M3 Pro
  (Metal), median of the paired differences of 21 rounds of 20 passes, two runs, the GPU shared
  with other work:

  | Case                                                                  | WebGPU                   | WebGL2                   |
  | --------------------------------------------------------------------- | ------------------------ | ------------------------ |
  | Nothing painted (start scene, Transport network, bare Maze, dish)     | −0.19 to −0.015 ms       | −0.115 to −0.025 ms      |
  | Maze, Shortest path and Shrinking plasmodium, fitted                  | +0.115 to +0.275 ms      | +0.11 to +0.40 ms        |
  | Zoomed 6× onto their food                                             | +0.24 to +0.35 ms        | +0.22 to +0.36 ms        |
  | Fleeing light, fitted                                                 | +0.09 to +0.135 ms       | +0.16 to +0.22 ms        |
  | Food painted into the Transport network, gel, grid 1024 / 2048 / 3072 | +0.15 / +0.24 / +0.76 ms | +0.34 / +0.54 / +1.06 ms |
  | Presence on against off (collision scenes)                            | −0.005 to +0.045 ms      | −0.02 to +0.05 ms        |

  Without environment the pass is cheaper than before, because it no longer reads `env` per pixel.
  With it, every pixel reads the 3 × 3 cells of item 3. On the periodic grid, wrapping each of
  them with integer remainders cost 1.3 ms in the Transport network (WebGPU); the cells are
  wrapped once, with comparisons. Before the presence gate of item 6, the food painted into the
  Transport network cost +0.48 / +1.65 / +3.7 ms per frame in gel (WebGPU).

- Brush cost when painting, per stroke as a frame paints it (one call each), measured as 32 calls at
  different places along a drag and one wait until the GPU finished, median of 6 rounds, PR 2 alone
  (a5631bc, no outlines), PR 3 alone (c500a36, one outline per stroke), the joined branch before the
  review fixes (3a961ce) and now, paired in one page over food and walls on grids of 2048 × 1280 and
  3072 × 1920 (periodic), M3 Pro, 2026-11-10. A wait alone costs about 0.12 ms on WebGL2 and 0.04 to
  0.09 ms on WebGPU; the numbers given here before (blocks of 16 strokes with a wait each) lay below
  that floor. The largest brush is 120 pixels; at device pixel ratio 2, zoomed out to 8 cells per
  pixel (`Engine.zoomAt`), that is 1,920 cells. In ms per stroke, both grids, now (PR 3 alone):

  | Radius (cells) | WebGPU erase          | WebGPU food, light    | WebGPU walls          | WebGL2 erase          | WebGL2 walls          |
  | -------------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- |
  | 60             | 0.04–0.05 (0.06)      | 0.04–0.07 (0.07–0.09) | 0.04–0.06 (0.07)      | 0.16–0.22 (0.34–0.55) | 0.12 (0.30–0.54)      |
  | 150            | 0.05–0.07 (0.07–0.09) | 0.04–0.06 (0.06–0.08) | 0.09 (0.10–0.11)      | 0.31 (0.44–0.66)      | 0.22–0.23 (0.37–0.57) |
  | 400            | 0.21–0.23 (0.20–0.21) | 0.14–0.19 (0.15–0.20) | 0.45–0.57 (0.42–0.53) | 0.81–0.92 (0.83–0.98) | 0.66–0.80 (0.72–0.90) |
  | 1000           | 0.61–0.98 (0.88–0.95) | 0.78–0.97 (0.81–0.96) | 1.97–2.56 (1.92–2.34) | 0.73–3.80 (1.51–2.91) | 1.73–3.90 (1.67–2.99) |
  | 1920           | 0.70–1.21 (1.95–1.98) | 0.66–1.22 (1.45–1.83) | 1.55–3.17 (2.31–3.57) | 0.74–1.45 (1.48–3.13) | 1.70–3.52 (1.68–3.44) |

  Food and light on WebGL2 cost what they cost before the review fixes: 0.12 to 0.21 ms up to a
  radius of 400 cells (PR 3 0.23 to 0.58), 0.57 to 1.28 ms at 1,000 and 1,920 (PR 3 0.55 to 1.14).
  PR 2 alone: 0.03 to 0.56 ms on WebGPU, 0.11 to 0.36 ms on WebGL2. Before the review fixes, food,
  light and erasers of 1,000 cells cost 1.2 to 1.9 ms on WebGPU, more than PR 3 alone (0.8 to
  1.0 ms): every workgroup loaded its tile (item 11). Now the outlines cost at most 0.22 ms per
  stroke more than PR 3 alone (walls on WebGPU), mostly less. The exception is WebGL2 at 1,000 cells
  on 3072 × 1920, where the outline box reaches far past the brush: erasers 3.80 against 2.91 ms and
  walls 3.90 against 2.99 ms for PR 3 alone. A subtraction holds every byte of its box (item 2), and
  WebGL2 searches 5 rings of `env` at each cell beyond the brush that holds no layer, such as cells
  that the drag erased before; without the walls painted first, an eraser there took 1.85 ms (PR 3
  alone 0.99). PR 3 held only within 4 cells of the brush, which left wrong bytes, and the bytes
  that a subtraction can change lie within 7.07 cells; holding only those would need the same
  region for WebGL2's hold over the union of a run, which a draw cannot test per cell (TODO.md,
  owner). Again after the rebase onto the final PR 2 (2026-11-10), paired in one page on WebGL2
  against PR 2 alone (01059ae), radius 1,000 cells on 3072 × 1920 (periodic), median of 8 rounds,
  two runs, with other work on the host (load average 5 to 7): erasers 5.87 and 6.01 ms per stroke
  against 0.37 and 0.36 ms, walls 5.49 and 6.02 ms against 0.36 and 0.41 ms, 15 to 17 times PR 2
  alone. The join before the rebase (30b2007) took 5.96 and 6.07 ms in the same page: the load,
  not the rebase, made both slower than the 3.80 and 3.90 ms above.

- Repainting many strokes (ADR 0019, item 11), paired in one page against PR 2 alone (a5631bc)
  and the joined branch before the review fixes (3a961ce), whole engines, grid 1536 × 864, until the
  GPU finished, M3 Pro: 100,000 strokes in one call took 0.44 to 0.85 s on WebGPU (before 0.59 to
  0.84 s) and 0.15 to 0.52 s on WebGL2 (before 0.23 to 0.64 s), against 0.19 to 0.24 s and 0.05 to
  0.09 s for PR 2 alone. With an outline right after every segment's paint and no workgroup memory
  (the first merge) they took 1.49 to 1.81 s and 5.81 to 6.32 s. The worst case is a kind that
  changes with every stroke of a drag: every stroke is then a run of its own on WebGL2, and 100,000
  of them took 4.8 to 4.9 s there (0.10 s for PR 2 alone, 0.69 to 0.73 s on WebGPU). After the
  rebase onto the final PR 2, paired against PR 2 alone (01059ae) with other work on the host,
  100,000 mixed strokes took 0.89 to 1.10 s on WebGPU against 0.28 to 0.36 s, and 0.20 to 0.73 s
  on WebGL2 against 0.06 to 0.10 s; the join before the rebase took the same within 3 %. The
  tables are in ADR 0019.
- The drawn outline can lie up to about half a cell from the blocked cells: the model is
  cell-based, the picture is smooth. Where an erased outline met remaining food, the food's
  outline can move by up to about half a cell (item 2).
- The drop shadow is a share of wall cells, so along a slanted wall it rises and falls slowly by
  about ±10 levels in glow a cell from the wall (Metal); no saw tooth.
- In multi-strain collision scenes, presence and the agents that stayed put take the colours of
  the trail around them, not of their own strain.
- Fitted, the small foods of Shortest path are less prominent in glow than the bright squares
  before: the network covers them, and the flake shows mainly by its rim. In gel the flake shows
  through the trail by `GEL_CLEAR` = 0.6, which the owner kept (item 4, 2026-11-10).
- GPU tests on both backends (`src/engine/sim.gpu.test.ts`): the signs and the light of the
  outline bytes agree with `env` at every arena cell after overlapping strokes, walls over food,
  erasers and strokes across the edges (wrap, box, dish), also under brushes wider than a small
  periodic grid, and cells outside the dish keep their bytes; the bytes match a CPU model of all
  strokes within 1, and the shadow byte matches `env`; after every change of boundary the bytes
  follow `env` again, no nearer to an outline and no farther from it than the cells of `env`
  allow; food lies below the trail and shows through the gel's thick trail; presence
  shows an agent on food and only there; the agents style shows blocked agents in collision mode;
  the outline of a food disc lies on the brush circle; the lit bevel of a round wall has no seams,
  and the ridge of a thin wall no beads; the trail runs along a slanted wall without a saw tooth
  in gel, glow and paper; a small light has no steps at the cell edges; food and holes thinner
  than a cell are drawn where `env` holds them; outlines stay whole up to the edge of the box and
  the rim of the dish; the grain repeats one grid away; the box edge and the dish rim are
  anti-aliased; erased strokes draw like none up to 8 cells per pixel, and an erased environment
  like none at all; without environment every style matches the CPU references, and `shape` is not
  read. With the batched paint: one call gives the bytes of `env` and of the outlines of one call
  per stroke and of one call per segment, for 400 random strokes under every boundary (drags of
  one kind, kinds that change at one place, strokes across the edges and longer than half the
  grid) and for 300 strokes under mixed boundaries; erasers leave no byte nearer than `env`
  allows; the outlines follow an environment written as bytes. The engine tests replay the Maze
  on another grid; switch Shrinking plasmodium from the dish to a box, the periodic grid and back,
  with a wall whose shadow falls across the edge of the periodic grid; sweep strokes that later
  strokes cleared (ADR 0019), also over frames, and replay what is left on another grid; and load
  presets on the same grid and on new ones. After each, the outlines stay on the side of `env` with
  its light and shadow, no byte lies farther from an outline than the nearest cell of its layer
  allows, and each replay gives the bytes of one call per edit. The rebuilt Maze
  draws its walls and food from the outlines. A new simulation that replays food, light or walls
  counts as painted and draws with the variant of item 9 that has the environment code; after a
  Clear, or with an eraser alone, it draws without. Each was checked with a deliberate mutation of
  the code it guards.
