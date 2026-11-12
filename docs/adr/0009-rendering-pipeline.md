# 0009: Rendering pipeline

- Status: accepted (revised 2026-11-08 after the visual review loop; amended 2026-11-10: food,
  light and walls; amended 2026-11-11: scent view, revised the same day: a glow and the mark of a strand, and
  amended for the lattices of ADR 0026 and for the panels without a backdrop blur of ADR 0028; amended 2026-11-12
  after the second review of the glow and the mark, and for the line where food steers as hard as a strand holds)
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
    10 to 14 % longer. The owner keeps the six pipelines (2026-11-10). WebGL2 changes its render
    target from `env` to `shape` and back for every run of outlines, about 55 µs each time on the M3
    Pro, so it draws the outlines of a run of segments after the paint draws of the run. A run ends
    where the boundary changes, or where a segment of another kind meets it: its outline box meets
    the outline box of a segment of the run (`PendingOutlines` in `src/engine/brush.ts`, in buckets
    of 16 × 16 cells). An outline box holds every cell within 5 rings of a cell its segment paints,
    and the outline of a cell reads `env` only within 5 rings of it (the holds; the shadow within
    3.3 cells). So segments of another kind whose boxes do not meet change no cell that the other
    reads or writes. The first merge grew the boxes by 5 more cells: that ended 12 % more runs
    (5,545 against 4,934 for 100,000 strokes at random places on the periodic grid, 5,416 against
    4,827 in a box; review, 2026-11-10) and changed no byte. Segments of one kind may overlap:
    unions take the maximum and subtractions the minimum, the side of the outline follows `env`,
    which a run of one kind only grows or only shrinks, the holds of item 2 depend on the stroke
    alone or on `env` after the run, and a subtraction holds its whole box. So the outlines give the
    same bytes after the run's paint as after each segment's paint. In a run each segment draws its
    union (op 0) or its subtraction (op 1) over its box. Then, once per cell of the union of the
    run's boxes of a kind (`unionRects`), op 4 draws the hold of the subtracted layers with `MIN`
    blending and op 2 the light and the shadow. Where the hold searches fewer cells per segment,
    without the cells where the segment's subtraction wrote 0, as for a single large eraser, op 1
    takes it in the same draw (`MIN` blending of both), and an eraser's light and shadow follow per
    segment, with no fetch deep inside it. `unionRects` marks the boxes as bits over their bounding
    box: for the 100,000 boxes of a drag it took 46 ms instead of 479 ms (Node, M3 Pro) and gave the
    same rectangles. Food draws nothing over the union and skips it.

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
  region for WebGL2's hold over the union of a run, which a draw cannot test per cell. The owner
  keeps the exact hold (2026-11-10). Again after the rebase onto the final PR 2 (2026-11-10), paired in one page on WebGL2
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

## Amendment 2026-11-11: scent view

### Context

The owner decided on 2026-11-11 that a switch in the view draws the food scent and the light's repellent, and that it
changes nothing in the simulation (ADR 0024, decision 10). The owner wants to see how far food really smells, and to
compare the two models: in the Jones model the scent decays with the trail, in the extended model a lower scent decay
reaches farther with a normalised strength (ADR 0022). The scent spans many powers of ten. On a UI dab at decay 0.1 it
is 115 on the dab and 0.36 nine cells out; a large food in the Jones model reaches 1,262 at decay 0.01 and 12,736 at
0.001 (ADR 0022, "Plateau"), and at decay 0.0001 and Food strength 0.5 the plateau is 255 · 0.5 · 0.9999 / 0.0001, about
1.27 million. Auto levels would scale each scene to itself, so two scenes would not compare.

### Decision

Each decision is this branch's (2026-11-11) and is open to the owner (TODO.md). The revision below (the same day,
after two reviews and an owner decision) replaces items 4, 6, 7 and 11 and the consequences of this first version.

1. **A setting of the look, `Settings.showScent`.** `packParams()` does not read it, `Engine.apply()` neither restarts
   nor rebuilds for it, and `modelChanged()` does not count it (`NOT_MODEL` in `src/model/scene.ts`), so the scene card
   does not say "changed". Reason: the owner's rule that the view changes nothing in the simulation. Tests: the same
   bytes of `packParams()` with the view on and off (`pack.test.ts`), no restart and no new simulation in the engine
   (`engine.test.ts`), and on both backends two simulations from one seed, one of them drawn with the view after every 5
   steps in every style, give the same agents, trail, scent, `env` and `shape` (`sim.gpu.test.ts`).
2. **The link carries it, as it carries the style.** `sanitize()` takes it only as `true`; a link without it opens with
   the view off. Reason: the repo keeps the look in the link (style, exposure, glow) and keeps the view (pan and zoom)
   out of it. Pan and zoom depend on the receiver's screen and grid; the scent view, like the style, draws the same on
   every screen. A link then shows the receiver what the sender saw, such as how far a food smells.
3. **The switch stays on when a scene loads** (`setScene()` in `src/ui/state.svelte.ts`). A scene sets its style to
   its own; it never sets the scent view. Reason: the view serves to compare scenes and models, and a switch that turned
   itself off with every new scene would get in the way. The owner can choose the behaviour of the style instead.
4. **A fixed logarithmic scale.** One band per power of ten from 0.01 up, 7 bands, and the last holds everything from
   10,000 up; a line marks each power of ten from 0.01 to 10,000. Below 0.01 the view draws nothing. The numbers are in
   `src/engine/scent.ts` (`SCENT_LOW`, `SCENT_BANDS`, `SCENT_FILL`, `SCENT_LINE`), and both passes hold the same
   (`scentView` in `render.wgsl` and `gl/glsl/render.frag`). Reason: fixed levels let two scenes or the two models
   compare directly. 0.01 lies four powers of ten below the plateau of a food at decay 0.1 (115), and 10,000 holds the
   Jones model's large foods at low decays. The bands give the value at a place, the lines show the reach.
5. **Colours.** Food scent green (OKLCH hue 145), light repellent pink (hue 340); light colours over glow, gel and
   agents, dark ones over paper, and each line a lighter (over paper: darker) shade of its fill (`SCENT_COLOURS`).
   Reason: the strain palette has hues 24, 85, 201 and 294, so green lies 60° and pink 45° from the nearest strain; the
   oat flake is brown, walls grey and the light a warm yellow. A strain colour that the user picks near green or pink
   can still look alike.
6. **Opacity.** The fill of the first band is 0.1, and each band adds 0.05 (0.1 to 0.4); a line has 0.75. Over paper the
   fill has 1.5 times that (`SCENT_PAPER_FILL`). Reason: the trail stays visible through the bands. Over a light colour
   the same opacity shows less: the first band took the paper from 243 to 232 of 255 (red) and the glow's black from 6
   to 76 (green); with 1.5 times the paper goes to 227. The legend draws each band as it looks over the bare dish of
   the style on screen.
7. **One bilinear lookup per pixel, filtered over the pixel.** The pass reads the 4 cells around the pixel centre once,
   at every zoom, and takes the gradient from the same weights. The band count is filtered over the pixel by its exact
   integral (`scentStairs`) over the width of one pixel in powers of ten, so bands closer than a pixel give their mean.
   Lines are about one pixel wide and fade out where they lie closer than 4 pixels. At fit the Jones model at decay 0.1
   has a power of ten every 4.6 cells. Reason: the cost. With four taps when zoomed out, as the trail has, and a
   remainder per cell on the periodic grid, the view cost 1.2 to 1.4 ms at 2560 × 1600 fitted and 4.4 to 4.8 ms zoomed
   out 3 times; with one lookup and one remainder per axis 0.5 to 0.6 ms and 0.6 to 0.85 ms (both backends). The scent
   is smooth over cells, and the filter of the bands covers the pixel already.
8. **After the light, below the walls.** Walls hold no scent and draw over the view. Zoomed in, the lookup leaves out
   the cells of walls and scales the other weights up to 1, as the trail's filter does (item 5 of the amendment of
   2026-11-10). Reason: without that, the value fell to half at a wall's outline, and a band edge or line ran along the
   wall.
9. **The edges of the arena.** On the periodic grid the cells wrap; in a box they are clamped to it; outside the dish
   a cell reads the cell inside the rim on the way to the centre, as `shapeIndex` does. Reason: the arena has no flux
   across its edge, so the scent of its outer cells goes on up to the edge with no drop, there is no seam, and outside
   the arena the pass draws what it drew before: no halo.
10. **No cost without the view.** The override constant `SCENT` (WGSL) and `#define SCENT` (GLSL) compile the view
    in; its pipelines and programs are built at the first frame with the view. Without the view the pipelines get only
    `ENV`, as before. Reason: without the view the frame must not change, in pixels or in cost.
11. **The legend is HTML** (`src/ui/ScentLegend.svelte`): over the canvas at the bottom left, "Scent per cell", a bar
    of the 7 bands per layer with the value where each band starts, and one sentence. The bar of the repellent shows
    only in the extended model, which alone has light. It hides with the panels (H). Reason: text in HTML reads at any
    size and reaches screen readers; the render pass has no text. The PNG export therefore has no legend (TODO.md).
12. **The switch** is the button Scent in the toolbar group of the view, beside Fit, with the key S (the view keys are F
    and H); its help shows in its title and in Learn → Controls, and Learn → The model says how to compare the models
    with it. Reason: one press, beside the other control of the view, to compare a scene before and after a change.
13. **For tests only**, `WebGpuBackend.renderFrom(code)` and `WebGl2Backend.renderFrom(frag)` draw every frame with
    another version of the render shader, as the code before the view did. Reason: a GPU test compares the pass
    without the view with the shaders of main at the same state, uniforms and dither. The test makes those shaders from
    the shipped ones by cutting out the scent code (`WITHOUT_SCENT` in `sim.gpu.test.ts`); when the view was added, that
    gave the files of 45155a8 byte for byte on both backends. The same pattern as ADR 0022, decision 23.

### Consequences

- Cost of one frame of the glow style, paired in one page against the render pass without the scent code (A, the
  shaders of main) and the shipped pass with the view off (B) and on (C), Transport network on 1024 × 640 with three
  UI dabs of food after 1,500 steps, median of 21 rounds of 20 frames, M3 Pro (Metal), other work on the host (load
  average 7 to 11). "Fit" and "zoomed out 3 times" show the whole grid, "zoomed in 6 times" a dab:

  | Canvas, scene, view                             | WebGPU: off; on − off (ms), two runs | WebGL2: off; on − off (ms), two runs |
  | ----------------------------------------------- | ------------------------------------ | ------------------------------------ |
  | 1280 × 800, Jones, fit                          | 0.42; +0.07 / 0.61; +0.10            | 0.58; +0.14 / 0.76; +0.06            |
  | 1280 × 800, Jones, zoomed out 3 times           | 1.37; +0.45 / 1.70; +0.53            | 1.64; +0.45 / 2.19; +0.60            |
  | 1280 × 800, Jones, zoomed in 6 times            | 0.53; +0.07 / 0.61; +0.11            | 0.61; +0.14 / 0.84; +0.14            |
  | 1280 × 800, Extended 0.003, fit                 | 0.47; +0.07 / 0.57; +0.10            | 0.58; +0.12 / 0.79; +0.12            |
  | 1280 × 800, Extended 0.003, zoomed out 3 times  | 1.40; +0.35 / 1.67; +0.41            | 1.68; +0.42 / 2.12; +0.53            |
  | 1280 × 800, Extended 0.003, zoomed in 6 times   | 0.43; +0.08 / 0.54; +0.16            | 0.60; +0.14 / 0.77; +0.18            |
  | 2560 × 1600, Jones, fit                         | 1.55; +0.33 / 2.17; +0.29            | 2.48; +0.50 / 2.71; +0.51            |
  | 2560 × 1600, Jones, zoomed out 3 times          | 4.76; +0.49 / 5.54; +0.60            | 6.19; +0.81 / 6.22; +0.84            |
  | 2560 × 1600, Jones, zoomed in 6 times           | 1.62; +0.35 / 2.10; +0.41            | 2.63; +0.58 / 2.75; +0.60            |
  | 2560 × 1600, Extended 0.003, fit                | 1.54; +0.34 / 2.08; +0.39            | 2.40; +0.64 / 2.67; +0.54            |
  | 2560 × 1600, Extended 0.003, zoomed out 3 times | 4.66; +0.55 / 5.49; +0.55            | 6.16; +0.95 / 6.26; +0.87            |
  | 2560 × 1600, Extended 0.003, zoomed in 6 times  | 1.60; +0.36 / 2.29; +0.41            | 2.65; +0.60 / 2.81; +0.61            |

  B − A lies within the spread of the rounds (−0.07 to +0.09 ms over all cases): without the view the frame costs
  what it cost before. With it, a frame costs 0.06 to 0.18 ms more at 1280 × 800 and 0.3 to 0.65 ms more at
  2560 × 1600, fitted or zoomed in; zoomed out 3 times, where each pixel reads 4 cells of its own, 0.35 to 0.6 ms and
  0.5 to 0.95 ms.

- Pixels without the view: 0 of 255 apart from the shaders of main in every style, on the periodic grid, in a box and in
  a dish, with and without food, light and walls, zoomed in 8 times, at 0.6 cells per pixel and zoomed out 2.5 times
  (`sim.gpu.test.ts`, both backends).
- GPU tests on both backends (`sim.gpu.test.ts`, "scent view"): the pixels without the view, as above; no byte of the
  simulation changes with the view; every pixel inside the arena follows a CPU reference of the view over the picture
  without it (`scentAt()` with `scentBands()` and `scentOver()` of `scent.ts`), in every style, across the seam of the
  periodic grid, at the edge of the box and at the rim of the dish, at three zooms, within 3 of 255, and outside the
  arena the view changes no pixel by more than the dither; zoomed in beside a wall the view follows the reference that
  leaves the wall's cells out. The reference leaves out pixels within 0.001 cells of a cell centre, where the bilinear
  gradient jumps and float32 may take the other side, and pixels the pass clamps (the gel's highlights, light on
  paper); at least 90 % of the pixels of each view stay in. Unit tests: `scent.test.ts` (the levels, the bands, the
  lines, the filter, the colours), `params.test.ts`, `url.test.ts` (the link), `scene.test.ts` and `state.test.ts` (no
  change of the scene; the switch stays on a new scene), `pack.test.ts`, `engine.test.ts`. e2e (`ui.spec.ts`): the
  button and the key S switch the view and its legend, the link holds it, the scene shows no change, the simulation
  does not restart, and axe finds nothing serious in the legend. Each test was checked with a deliberate mutation of
  the code it guards: the pass without the view built with `SCENT` (WebGPU: a validation error of the pipeline of
  main's shader; WebGL2: other pixels), the frame without the view on the pipelines of the view, the view clearing the
  scent, a restart on the switch, `packParams()` reading it, the opacity of a band or a line, the lowest level, the wrap
  at the seam, the clamp at the box edge, the rim of the dish, the wall cells in the lookup, the switch dropped on a
  new scene, in the link or counted as a change, and the key S (e2e).
- On SwiftShader on an M3 Pro (`--use-webgpu-adapter=swiftshader`, `--use-angle=swiftshader`) the new GPU tests took
  at most 11.1 s (the pixels without the view, WebGL2) of their 240 s limit, the test of the simulation's bytes 5.0 s
  of 120 s, the others under 0.7 s of 60 s (ADR 0010).
- The width of a line steps a little where the pixel crosses a cell centre: the gradient of a bilinear lookup jumps
  there. The line's place does not. At 10 pixels per cell the lines look round in the screenshots of the pull request.
- The PNG export has the bands and lines, but no legend.

## Revision 2026-11-11: a glow, the mark of a strand, and the review

### Context

Two reviews of the first version of the view (a logic review and an app review, 2026-11-11) found:

- The e2e test of the switch read its count of restarts while the new scene's simulation was still being built, and
  failed 4 of 4 runs there. The render tests of the view ran on auto levels that the test before them had started.
- No GPU test reached a scent above 66, so nothing held the upper half of the scale or its top to the CPU reference:
  the top could change from 10,000 to 1,000 unseen.
- In the Jones model the view drew the repellent that light leaves for about 60 steps after a switch from the extended
  model, which the legend did not name. The legend named the repellent in every scene of the extended model, also
  without light, and said nothing when a scene had neither food nor light.
- On a tablet in portrait with the panel open the toolbar wraps into two rows, and the legend, fixed at 80 px, covered
  the first row; on a phone it covered a seventh of the screen and the open panel.
- Zoomed out to 4 and 8 cells per pixel at 2560 × 1600, the view cost 8.5 and 11.7 ms per frame (WebGPU; running at 38
  frames per second, 25 with the view).
- The first press on WebGL2 froze a frame for 150 ms (33 ms with the shader cache warm): the programs of the view
  compiled at once. Nothing tested that the view's pipelines and programs are built once.
- The view tinted the oat flake green. Lines swelled to 4 to 5 px in the last half cell before the box edge at 10 px per
  cell. The key S did nothing after a click on a toolbar button until the canvas was clicked, as every key (older than
  the view). The legend drew its lines at full opacity, the view at 0.75.
- The test against the shaders of main compares the shipped shader with itself without the scent code, so a change to
  code that both share passes it: a paper wall shadow of 0.2 instead of 0.3 passed all 166 tests of shadows, walls and
  styles, a gap that main already had.
- The view showed how far the scent goes, not where it matters to an agent: the green ended at 0.01, about 500 times
  below the trail on a strand (p90 5.4, p99 7.6 in the Transport network).

The owner decided on the look the same day (2026-11-11): "Gerne deine Empfehlung. Ich hab mir die Visualisierung des
Dufts einfach als glow vorgestellt, welcher ausfaded wenn er schwächer wird." ("Your recommendation, please. I imagined
the view of the scent simply as a glow that fades out when it gets weaker.") He accepted the coordinator's
recommendation of a mark on the legend for the trail of a strand, so the user sees where food is stronger than a
strand, with the scale kept fixed so scenes and models compare.

### Decision

Each with its date (2026-11-11), who made it, and its reason. These replace items 4, 6, 7 and 11 of the amendment above
and its consequences; the rest stays.

1. **A glow replaces the bands and the lines at the powers of ten** (owner). Reason: the owner pictured the scent as a
   glow that fades out as it gets weaker. Each layer is one smooth glow, food green and the repellent pink as before.
2. **The glow's curve** (this branch). Its opacity rises in a straight line with log10 of the scent, from 0 at 0.01 to
   0.45 at 10,000, and stays at 0.45 above (`scentGlow()` in `src/engine/scent.ts`, `SCENT_TOP`, `SCENT_GLOW`); over
   paper 1.5 times that, up to 0.675. Reason: a straight line in log10 gives each power of ten the same step, so two
   scenes and the two models still compare on one fixed scale, and the glow fades out evenly with no edge at 0.01. At
   0.45 the trail and the agents stay readable under the strongest glow (the screenshots of the pull request); a food of
   the default strength reaches about 0.3 on its flake.
3. **The mark of a strand** (owner, on the coordinator's recommendation; the definition is this branch's). The mark is
   the food scent that weighs as much in a sensor as the trail of a strand. A sensor of strain s reads
   `attraction[s] · trail + food[s] · scent.r − light[s] · scent.g` (`sense()` in `agents.wgsl` and `agents.frag`), and
   with trail saturation K each trail lane as t / (1 + t / K). On a strand of its own trail T the two terms are equal
   at scent = attraction[s][s] · T / food[s], with T / (1 + T / K) in place of T under saturation (`scentMark()`). The
   Jones model weighs food as the strain's own trail, so there the mark is T itself. T is the 99th percentile of the
   summed trail: the level that the auto levels draw at full strength, so the trail that the picture shows as a bright
   strand (in the Transport network 7.6, where p90 is 5.4). Reason: it reuses the histogram of the auto levels, so it
   needs no readback of its own, and it holds for sparse networks, where strands cover more than 1 % of the cells but
   a lower percentile falls into empty cells. (The mark was replaced on 2026-11-12 by the line where food steers
   across the sensors as hard as a strand holds, see the amendment of that day; `scentMark()` is gone, the hold of a
   strand lives on in `scentSensors()`. The strand T stays as defined here.)
4. **The strand level is read within its bin and smoothed slowly** (this branch). The auto levels take the centre of a
   bin of half a power of two (steps of 41 %); the mark reads the same percentile within the bin by the share of its
   cells it needs (`levelWithin()` in `exposure.ts`), and each measurement moves it by 0.1 of the way (the levels by
   0.25; `STRAND_BLEND`). Reason: the line on the map follows the mark, and bin steps made it jump; at 0.1 it follows a
   changing network in about a second (WebGPU measures every 6 frames, WebGL2 every 15) without visible jitter.
5. **Several strains** (this branch). The mark is the lowest mark of the strains that follow their own trail and food
   (weights above 0): where food outweighs a strand for at least one strain. The histogram holds the summed trail, so
   every strain takes it as its strand. Reason: one line on the map has to stand for all strains, and the lowest mark
   shows where food acts first. A strain that flees food or its own trail has no mark; with none left, there is no mark
   and no line. Where strains share cells, the summed trail is above each strain's own, so the mark lies too high there.
6. **One line on the map at the mark** (the coordinator's choice, not the owner's). A thin line (about one pixel,
   opacity 0.8, the light green of the food scent) where the food scent equals the mark (`scentLine()`): inside it,
   food pulls an agent on a strand more than the strand does. Reason: the mark on the legend says what level matters,
   the line shows where that level is on the map. Assessed on the screenshots: one closed line per food, close to the
   flake in Jones at decay 0.1 and farther out in the extended model at 0.003; it does not crowd the picture.
7. **The repellent only where the model reads it** (coordinator). The pass draws the repellent only in the extended
   model (`View.scentFx.y`, see the merge below); the Jones model's agents do not read it. Reason: after a switch
   from the extended model the repellent decays for about 60 steps, and the view drew pink that no agent felt.
8. **The legend names what the scene holds** (coordinator, app review). A row for food when the drawing holds food, and
   for the repellent when the model is extended and the drawing holds light; with neither, one sentence says that the
   scene has no scent to show, so the switch does not look broken. Each row is a gradient of the glow over the bare dish
   of the style, with the values at the powers of ten (the last "10k+", and the text says that the glow stays the same
   from 10,000 up) and the mark of a strand, which the legend draws as the map draws its line. Screen readers hear
   "green glow" and "pink glow" and the text as the figure's description. Reason: the colours alone give no values, and
   a row for a layer that cannot be there misleads. The food row follows the drawing, so for a while after all food is
   erased its fading scent shows with no row.
9. **The view lies below the oat flake** (coordinator), as it lies below the walls; within the view the food's glow,
   then its line, then the repellent's glow over them. Reason: the flake is the marker of the food, and its colour must
   not change; the repellent is the warning, so it lies on top.
10. **Zoomed out, the view reads a coarser map** (this branch, after measuring the cause). From 2 cells per pixel on
    the pass reads the scent from a map of 2, 4 or 8 cells per texel (`scentLevel()`: the power of two at or below
    the scale, at most 8), filled each frame by a pass at that map (`scentDown`: rgba32float, each texel the mean of
    the cells it covers by the share it covers, with walls and cells outside the dish weighing 0, and that share). Its
    texels tile the grid exactly (n = ⌈side / 2^k⌉, each side / n cells wide), so on the periodic grid it wraps with the
    grid. Reason: at 8 cells per pixel each pixel read 4 cells far from those of its neighbours, which missed the
    cache: 17.2 ms more per frame at 2560 × 1600 against 0.55 ms with the same arithmetic on 4 reads of one texel
    (paired probe, WebGPU). The lookup weighs each texel by the share that holds scent, so walls and the rim of the
    dish do not pull it down.
11. **At the box edge the log of the scent goes on with its slope** (coordinator: a one-sided gradient). Within half a
    cell of the edge the pass takes the scent and its gradient at the centres of the outer cells and goes on with the
    gradient of its logarithm (`scentFrom()`). Reason: the clamped lookup held the scent flat there, so a line that
    met the edge at a slant turned along it for the last half cell; in log space the scent stays positive. Where the
    scent is flat at the edge, as the arena's lack of flux makes it there most of the time, both lookups draw the same.
    The swelling to 4 to 5 px that the review saw came from the floor of item 12: the reviewed code with a floor of
    0.0001 drew those lines one pixel wide (checked at 10 px per cell in the Maze at decay 0.003). The rim of the dish
    and the side of a wall keep the lookup that holds the outer value; their last half cell lies under the rim's ramp
    or the wall's bevel.
12. **A flat scent** (this branch): below 0.0001 powers of ten per pixel the line counts the scent as flat. Reason: the
    floor of 0.001 of the first version made a line on a nearly flat scent several pixels wide, at the box edge too.
13. **The view's pipelines and programs are built without blocking** (coordinator). WebGPU builds them with
    `createRenderPipelineAsync`, WebGL2 starts the compile and asks for `COMPLETION_STATUS_KHR`
    (`KHR_parallel_shader_compile`) each frame; frames draw without the view until both are built, and a PNG export
    waits for them. Each is built once per renderer or GL context. Reason: the first press froze a frame for 150 ms on
    WebGL2. Without the extension the first query still waits, as before. On a cold browser the view then shows after
    a few hundred milliseconds.
14. **Legend and stats sit above the toolbar at its real height** (coordinator, app review). App.svelte measures the
    toolbar and the stats; the stats sit above the toolbar, and the legend above both. On a phone and on a short screen
    (up to 720 px wide or 500 px high) the legend drops its text, and while the phone's panel covers the picture the
    legend hides. The Scent button stays in the toolbar, which a phone scrolls sideways (older than the view). Reason:
    the fixed bottom of 80 px covered the wrapped toolbar; with the stats at 56 px the stats covered it too.
15. **Shortcuts work whenever the focused element does not use the key** (coordinator; the bug is older than the view).
    A text field, a number field and a list take every key, a button, link or switch Space and Enter, a slider and the
    tabs of Learn the arrows, a modal dialog every key (`keyUsed()` in App.svelte). Reason: after a click on a toolbar
    button every shortcut did nothing until the canvas was clicked.
16. **Texts** (coordinator). The button's title is "Show the scent of food and light (S)", as short as the other titles.
    The help (Learn → Controls), the legend and Learn → The model say what the glow and the line mean in short plain
    sentences, and Learn says that a small food gets weaker at a lower decay, so its line can come closer.
17. **The uniform**: `View.fx.z` holds the map level (0 to 3) plus 4 when the repellent is drawn, `View.fx.w` the
    mark (0: none). Reason: the struct had these two floats free, and both backends share it. Replaced by a field of
    its own at the merge with ADR 0026 (below).
18. **The shared path is pinned** (coordinator). A GPU test draws walls and light over the bare dish in glow, gel and
    paper and holds pixels on cell centres to the formulas: the drop shadow (0.75, 0.6, 0.3 per style), the light's
    tint, and the flat top of a wall (albedo, diffuse and specular light). Reason: the test against main cannot see a
    change to code both share, and these numbers had no test of their own. The flake's grain, the bevels and the gel's
    relief stay held only by tests of their shape (`sim.gpu.test.ts`).
19. **Colours, as OKLCH lightness / chroma / hue** (this branch, recorded now): food glow 0.80 / 0.18 / 145 and its line
    0.90 / 0.14 / 145 over the dark styles, 0.55 / 0.15 / 145 and 0.42 / 0.12 / 145 over paper; the repellent's glow
    0.74 / 0.19 / 340 over the dark styles, 0.52 / 0.19 / 340 over paper.

### Consequences

- Cost of the view zoomed out, measured as the review did (draw-only frames of the paused app, the order off, on, off,
  median of 11 rounds of 20 frames; Transport network on 1024 × 640 in the extended model at decay 0.003 with three UI
  dabs, 1,500 steps; 2560 × 1600; M3 Pro, other work on the host, load average 4 to 15). On − off in ms, two runs each,
  before (28a81d4) and after, paired run by run:

  | Cells per pixel | WebGPU before | WebGPU after  | WebGL2 before  | WebGL2 after  |
  | --------------- | ------------- | ------------- | -------------- | ------------- |
  | fit (0.4)       | +0.58 / +0.65 | +0.44 / +0.86 | +0.74 / +0.29  | +0.85 / +0.86 |
  | 2               | +1.07 / +1.34 | +0.56 / +0.68 | +1.36 / +0.07  | +1.86 / +1.30 |
  | 4               | +6.93 / +7.77 | +0.04 / +0.38 | +6.97 / +7.28  | +2.19 / +2.65 |
  | 8               | +13.0 / +11.6 | +0.30 / −0.34 | +11.84 / +14.7 | +0.93 / −1.89 |

  Two more runs before on WebGPU gave +6.1 / +8.0 ms at 4 and +14.8 / +14.6 ms at 8 cells per pixel (the review: +8.5
  and +11.7). On this grid of 1024 × 640 the view then cost about what it costs at fit at every zoom; on WebGL2 at 2 to
  4 cells per pixel up to about twice that. Larger grids cost more, since the coarse map was filled from every cell in
  every frame (corrected 2026-11-12, see the amendment of that day). At 8 cells per pixel the frame itself takes 20
  to 40 ms (the trail's four taps of 4 cells), so the difference lies within the spread there.

- Paired in one page (the method of the amendment above: the pass without the scent code (A), the shipped pass with
  the view off (B) and on (C), 21 rounds of 20 frames, Transport network on 1024 × 640 with three dabs, glow style;
  load average 5 to 7): B − A lies within −0.16 and +0.54 ms at every zoom, and within ±2.5 ms at 8 cells per pixel on
  2560 × 1600, where a frame takes 30 to 38 ms. C − B in ms:

  | Canvas      | Fit and zoomed in 6 times | 2 cells per pixel | 4 cells per pixel | 8 cells per pixel         |
  | ----------- | ------------------------- | ----------------- | ----------------- | ------------------------- |
  | 1280 × 800  | 0.12 to 0.22              | 0.47 to 0.51      | 0.43 to 0.64      | 0.33 to 0.96              |
  | 2560 × 1600 | 0.47 to 0.89              | 1.15 to 1.59      | 1.24 to 1.65      | −2.4 to +2.0 (the spread) |

- Tests on both backends (`sim.gpu.test.ts`, "scent view"):
  - Without the view, 0 of 255 apart from the shaders of main in every style, on the periodic grid, in a box and in a
    dish, with and without food, light and walls, at four zooms down to 6 cells per pixel. The cut of the scent code
    still gives main's `render.wgsl` and `render.frag` byte for byte; `view.glsl` differs from main only by the field
    `scentFx` (since the merge below).
  - With the view, no byte of the simulation changes.
  - Every pixel inside the arena follows the CPU reference of the glow and the line (`scentAt()` with `scentGlow()`,
    `scentLine()`, `scentMark()` and `scentOver()`), in every style, across the seam, at the box edge with the slope of
    item 11, at the rim of the dish, zoomed in, near fit, and on the maps of 2 and 4 cells (2.5 and 6 cells per
    pixel), with the line at the mark of the settled levels; outside the arena and on the flake no pixel changes by more
    than the dither; in the Jones model no repellent shows.
  - The Jones model at a decay of 0.0001 with food strength 0.5 reaches more than 10,000 (every power of ten from 1,000
    to the top is compared), and in a small box more than 100,000, where the glow stays at its top.
  - Zoomed in beside a wall the glow and the line follow the reference that leaves the wall's cells out.
  - The view's pipelines and programs are built once.
  - The shadow, the light and the flat top of walls follow their formulas in glow, gel and paper (item 18).
  - Unit tests: `scent.test.ts` (the glow, the line, the mark for one and several strains, Jones, saturation, the
    strand level within its bin, the map level), `engine.test.ts`, `pack.test.ts`, `params.test.ts`,
    `url.test.ts`, `scene.test.ts`, `state.test.ts`. e2e (`ui.spec.ts`): the button and the key, the legend's rows and
    its sentence for a scene without scent, its description, the link, no change of the scene, no restart, the key
    after a click on a toolbar button and not in a number field, Space on a focused button, and the legend clear of the
    toolbar and the stats at 375 × 812, 812 × 375, 721 × 900, 768 × 1024 and 1280 × 800.
  - Each test was checked with deliberate mutations of the code it guards, each reverted after its run. Caught: the
    pass without the view built with `SCENT` (WebGPU: a validation error) or drawing the view (both backends), the view
    clearing the scent (both), a restart on the switch, `packParams()` reading it, the top of the glow at 1,000 instead
    of 10,000 (WGSL and GLSL), the glow's top opacity, the line's opacity, the lowest level, the wrap at the seam, the
    clamp at the box edge, the slope at the box edge, the rim of the dish, the wall cells in the lookup (both), the
    repellent drawn in the Jones model, the view over the flake, the coarse map's gradient in cells, a build of the
    pipelines or programs in every frame (both), the paper shadow of 0.2, the light's tint, the walls' albedo, the
    switch dropped on a new scene, in the link or counted as a change, the mark without the food weight, the strand
    level at the bin's centre, the key S, and the shortcuts ignored after a click on a button (both e2e). Not caught:
    the coarse map counting walls as cells with scent; its effect stays within one texel of a wall, which is one
    pixel at that zoom and lies under the wall's ramp.
- On SwiftShader on an M3 Pro (`--use-webgpu-adapter=swiftshader`, `--use-angle=swiftshader`; load average 6 to 12),
  the longest new GPU test, the pixels without the view on WebGL2, took 11.4 s of its 240 s limit (the review measured
  14.0 s under load 13; ADR 0010), the test of the simulation's bytes 3.7 s of 120 s (5.0 s before), the test of the
  glow above 10,000 5.6 s, the formulas of the walls 5.1 s, and every other new test under 3 s of 60 s. Every limit is
  more than 4 times the longest time measured.
- The line's width steps a little where a pixel crosses a cell centre, where the bilinear gradient jumps; its place
  does not.
- The PNG export has the glow and the line, but no legend (owner item).

## Amendment 2026-11-11: merged with the lattices of ADR 0026

### Context

ADR 0026 (PR #29, `f81c4a3`) runs the scenes of Jones on the lattices of their figures. Around a periodic lattice
the pass shows the copies of the grid at 0.15 of their light (`LATTICE_COPIES`), and it took the third value of
`View.fx` for that, the value that the scent view used for its map level and the repellent. Beside a closed lattice
the free space shows only the background. The word "lattice" now names the grid of a figure.

### Decision

Each by this branch on 2026-11-11, at the merge of `main` into it.

1. **A field of its own for the scent view**: `View.scentFx` (x the map level, 0 to 3; y 1 when the repellent is
   drawn, else 0; z the mark, 0 for none; w unused), after `fx`, on both backends (`render.wgsl`, `view.glsl`,
   `packView()`; the view uniform grows from 144 to 160 bytes). `fx` stays as main has it. Reason: `fx` has no float
   left, and two meanings in one float would change main's code of the copies, so the pass without the view could
   no longer give main's shaders byte for byte. A field that only the scent code reads keeps that cut exact.
2. **The view on the copies is dimmed with them** (no change of code). The view is drawn inside `scene()`, below the
   flake and the walls, and the pass dims the copies after `scene()`. So a copy shows the view at 0.15 too, as it
   shows the trail and the food. The scent lookup wraps on the periodic grid, so each copy shows the scent of the
   cells it shows. Reason: the copies show where a tool acts (ADR 0026, decision 3), and the scent at full strength
   on a dimmed copy would hide which picture is the lattice. Beside a closed lattice the pass draws no scene, so no
   view either.
3. **The mark on a lattice** (no change of code): the histogram of the auto levels counts the cells of the grid, not
   the pixels on screen, so the copies and the free space do not change the strand. In the Transport network on its
   200 × 200 lattice with three dabs the mark is 7.7 (Jones) and 7.7 (extended model at decay 0.003), as on
   1024 × 640 before (7.6).
4. **"Map", not "lattice", for the coarser scent that the view reads zoomed out**, in the code, the tests and this
   ADR. Reason: ADR 0026 gives "lattice" to the grid of a figure.

### Consequences

- A GPU test on both backends draws the view on a periodic lattice with its copies in every style and at four
  zooms, and holds each pixel of a copy to the CPU reference: the view over the copy's picture before the dimming,
  dimmed as the pass dims it ("dims the view with the copies around a periodic lattice"). The test without the view
  now also holds a periodic lattice with its copies against main's shaders (112 captures).
- Mutations, each reverted after its run: the view drawn after the dimming only on the copies (WGSL), and no view on
  the copies (WGSL and GLSL): the new test caught each, and no other test did. The repellent always drawn, no mark,
  and the map level always 0 in `packView()`: caught by the tests of the view.
- On SwiftShader on an M3 Pro (load average 5 to 10) the test without the view took 10.6 s on WebGL2 for its 112
  captures (ADR 0010), the test of the copies 0.5 s.

## Amendment 2026-11-11: the legend without a backdrop blur (ADR 0028)

The owner decided that the panels draw no backdrop blur (ADR 0028, PR #30, `83d0567`): a blur behind a panel is drawn
again in every frame, because the canvas changes in every frame. `--glass` went from 0.88 to 0.94, and
`src/ui/glass.test.ts` fails for any `backdrop-filter` in a style file of `src/`.

Decision (this branch, 2026-11-11, at the merge of `main` into it): the scent legend drops its `blur(14px)` and keeps
the background of the other panels, `var(--glass)`, with `--fg` and `--muted` for its text. Reason: the owner's
decision holds for every panel, and the legend lies over the moving picture as they do. Over a white canvas, the
worst case of the paper style, the glass gives `--fg` 14.2:1 and `--muted` 6.0:1 (11.9:1 and 5.0:1 at 0.88); WCAG 2.2
asks 4.5:1 for small text (1.4.3).

Consequences: an e2e test ("the scent legend keeps its text readable on the glass over a white canvas", `ui.spec.ts`)
reads the legend's computed background and the colour of each of its visible texts in the paper style, and holds each
to 4.5:1 over white; it also checks that the legend has no backdrop filter. Mutations, each reverted after its run: a
thinner glass (0.6: `--muted` at 4.2:1) and the blur back: the test caught both.

## Amendment 2026-11-12: the second review of the glow and the mark

### Context

A review of the glow, the mark and the coarse map on `18858e4` (2026-11-11) confirmed these faults, each with a
probe:

- On WebGPU the agents style measured no auto levels: `frame()` in `webgpu.ts` ran the histogram only in the styles
  that use the levels, and `Engine.snapshot()` settled them only there. After a reset in the agents style the strand
  stayed 0, so the view drew no line and the legend no mark; a switch to the agents style froze the strand. WebGL2
  measured in every style.
- Between 1 and 2 cells per pixel the lookup read the cells of walls (it left them out only up to 1 cell per pixel, but
  the view reads cells up to 2), so the line hugged the walls' faces and the glow dimmed beside them.
- The coarse map was filled from every cell in every frame while zoomed out, also while paused: +4 ms per frame at
  4096 × 2560 and +2.4 to 2.7 ms at 3072 × 1920 zoomed out (WebGPU). The revision above said that the view costs about
  what it costs at fit at every zoom; that held for the grid of 1024 × 640 that it measured, not for large grids.
- After a WebGL2 context loss, the key S replaced the message "The graphics device was lost" with "GLSL compile error:
  .": the view's programs compiled on the lost context and reported its empty log as an error. On WebGPU a device that
  something else destroyed showed no message at all.
- On a phone the numbers under the legend's bar ran together ("0.010.1", "1k10k+").
- The strand read within its bin ran up to 18 % high: the bin was taken as holding its cells evenly, but in the tail of
  the trail most of a bin's cells lie at its low end.
- The coarse map leaves the cells of walls out, but no test held that (the surviving mutation of the revision above):
  counting them moved the glow by up to 4.5/255 and the line by 0.1 of its opacity or more at 16 pixels in the Maze.
- Save PNG settled the levels with a blend of 1, so after an export the live line jumped to the strand of that moment
  instead of moving to it slowly.

The review also asked what the line and the mark mean (items 3, 8 and 9 of the review): the next amendment, of the
same day, decides it.

### Decision

Each by this branch on 2026-11-12, on the review's findings.

1. **The strand is measured in every style while the view is on.** On WebGPU the agents style runs the histogram only
   while the scent view is on: without the view nothing changes, so the agents style keeps its cost (WebGL2 measured
   in every style before and still does). An export in the agents style measures only with the view on.
2. **Up to 2 cells per pixel the lookup leaves out the cells of walls** (`render.wgsl` and `render.frag` `scentView`),
   at every scale that reads the cells, not only up to 1. Reason: the cells around p that a lookup reads include a
   wall's cell whenever p lies within one cell of it, at any scale; a wall marks the cells its stroke touches, so its
   cells reach up to half a cell beyond its drawing.
3. **The coarse map is filled only when what it holds changed**: the scent (a step), the scent or the shape outside a
   step (a reset, a stroke, clearing, a write or a new hold of the shape, counted by `revision` in `sim.ts` and
   `gl/sim.ts`), the map level or the arena. A paused simulation keeps it. Reason: the review measured it in every
   frame, and nothing but those changes what it holds.
4. **After steps alone the map refreshes only the scent of its texels** (`SUM_ONLY` in `render.wgsl` and
   `scent-down.frag`, a second pass that writes red and green and keeps blue): a step leaves no scent in walls or
   outside the dish (`diffuse.wgsl`, `diffuse.frag`), so a texel's sum over all its cells is its sum over the open
   ones, and the share that holds scent, which only the shape, the level or the arena change, stays from the last full
   fill. The refresh reads no shape. Reason: a running simulation changes the scent in every frame, so the map is
   filled in every frame zoomed out, and reading the shape of every cell was half of that pass and more on WebGL2.
   An experiment on the pass alone (Maze, 2560 × 1600, paused, the map filled in every frame, median of 9 rounds of
   20 frames, two rounds, load average 4 to 8) found, in ms per frame at 4.4 / 8.8 cells per pixel:

   | Grid, backend      | The pass of the revision above | Without reading the shape | Whole cells per texel    |
   | ------------------ | ------------------------------ | ------------------------- | ------------------------ |
   | 4096 × 2560 WebGPU | 1.28 / 1.48; 2.99 / 2.61       | 0.95 / 1.26; 2.26 / 2.41  | 1.38 / 1.83; 2.98 / 2.84 |
   | 4096 × 2560 WebGL2 | 3.18 / 6.00; 4.01 / 6.03       | 1.78 / 2.29; 1.69 / 1.53  | 3.13 / 6.61; 4.34 / 6.09 |
   | 3072 × 1920 WebGPU | 1.75 / 1.84; 1.77 / 2.64       | 0.94 / 1.13; 1.68 / 1.77  | 1.63 / 1.72; 2.02 / 2.50 |
   | 3072 × 1920 WebGL2 | 2.32 / 3.68; 3.59 / 3.88       | 1.17 / 0.74; 1.47 / 1.13  | 2.71 / 3.51; 2.63 / 3.71 |

   A loop over whole cells per texel, which saves the shares of cells at a texel's edge, bought nothing and is not
   used.

5. **A lost device stays the message.** WebGL2 starts no compile on a lost context, and a compile that a lost context
   failed throws nothing (`startProgram()` in `gl/gl.ts`); an export does not wait for programs a lost context never
   builds. On WebGPU only the app's own `destroy()` ends the device without a message (`ending` in `webgpu.ts`); any
   other end, also a `destroy()` from elsewhere, reports the loss. Reason: the loss is what the user must see; an error
   of the view after it hides it.
6. **The legend's numbers keep apart**: the bar is 240 px wide (216 before) and the numbers 6 px and more apart; on a
   phone and a short screen, where the bar is 180 px wide, the legend shows every other number (0.01, 1, 100, 10k+).
   Reason: at 216 px the numbers kept 3 px apart on a desktop with the fonts of macOS, less with wider fonts; at 180 px
   they ran together.
7. **The strand within its bin** (`levelWithin()` in `exposure.ts`): the cells of the bin are taken to thin out
   exponentially, at the rate of the bins below and above it. Reason: in 60 states of 15 scenes (each at 200, 600,
   1,500 and 4,000 steps) this read the 99th percentile of the summed trail within −3.2 to +2.8 % (median 0.6 %), where
   an even share read it −0.6 to +19.7 % (median 5.1 %); a linear share between the neighbours reached +12.7 %. It costs
   a logarithm and an exponential per measurement.
8. **An export measures its own levels** (`Backend.measured()`, `Engine.snapshot()`): it draws with them, and the levels
   of the frames stay as their smoothing left them. Reason: the line follows the smoothed strand, and an export must not
   move it.

### Consequences

- GPU tests on both backends (`sim.gpu.test.ts`, "scent view"):
  - "leaves the cells of walls out of the scent between 1 and 2 cells per pixel": a wall that marks four cells and
    draws three, a long food beside it, and the line where the food scent is that of the cell before the wall; at 1.01,
    1.2, 1.5 and 1.9 cells per pixel every pixel follows the CPU reference, which leaves out the wall's cells at every
    scale up to 2 (fixed in the reference too, which shared the fault).
  - "leaves the cells of walls out of the coarse maps": the same at 2.05, 2.5, 3, 4.1 and 6 cells per pixel, with a
    pixel column 1.6 cells before the wall, where a texel that holds part of the wall reaches; then a step before a
    capture at a level that the map holds (the refresh of decision 4) at each level, and the wall grown by two cells
    while paused, which must fill the map again in full.
  - "builds the pipelines or programs of the view once": now four each, with the refresh.
  - "fills the coarse map again only when the scent, the shape or the level changed": counts the passes of the
    capture (WebGPU render passes, WebGL2 draws), and checks the view against the reference after steps and a stroke
    made while the map was kept.
  - "measures the strand from frames in the … style", for each style: frames as the engine draws them, from a reset,
    until a measurement landed; the strand against the 99th percentile of the summed trail read from the trail itself,
    not from the backend's levels: within 10 %.
  - "measures the levels of an export without changing those of the frames".
- Unit tests: the strand of a log-normal trail of 100,000 cells (three spreads) within 3 % of its exact 99th
  percentile.
- e2e tests (`ui.spec.ts`): a lost device stays reported when the view is asked for, on WebGPU and WebGL2; the numbers
  under the legend's bar keep 3 px apart at 375 × 812, 812 × 375, 721 × 900, 768 × 1024 and 1280 × 800.
- Mutations, each reverted after its run, all caught: WebGPU measuring nothing in the agents style; the wall's cells
  read up to 1 cell per pixel only (WGSL and GLSL); the coarse map counting walls (WGSL and GLSL, the surviving mutation
  of the revision); the coarse map filled in every frame (WebGPU), or kept over a step (WebGL2) or over a stroke
  (WebGPU); the refresh clearing the share (WebGPU) or writing it (WebGL2); the refresh in place of the full fill after
  a stroke (both); an export blending its levels into those of the frames; WebGL2 compiling on a lost context; WebGPU
  taking a destroyed device for no loss; every number on a phone's legend; an even share within the bin (the unit
  test).
- The cost of the view, measured as the review did (draw-only frames of the paused app, off and on, median of 5
  rounds of 20 frames; the Maze at decay 0.003 on grids of 4096, 3072, 1024 and 768 cells on the long side; 2560 ×
  1600; M3 Pro with other work on the host, load average 4 to 8; WebGPU at 4096 measured twice). On − off in ms at fit
  / 4.4 / 8.8 cells per pixel, before (the review's version, `67443e0`) and after (decision 3):

  | Grid              | WebGPU before                           | WebGPU after                            | WebGL2 before      | WebGL2 after        |
  | ----------------- | --------------------------------------- | --------------------------------------- | ------------------ | ------------------- |
  | 4096 × 2560 (1.6) | −0.05 / 3.74 / 3.35; 0.72 / 1.93 / 3.03 | 1.06 / −2.97 / 1.96; 1.83 / 0.63 / 0.45 | 1.50 / 3.62 / 5.55 | 0.67 / 0.40 / −0.18 |
  | 3072 × 1920 (1.2) | 0.35 / 1.53 / −0.17                     | 0.44 / 0.13 / 0.13                      | 0.72 / 1.60 / 2.47 | 0.44 / 0.16 / 0.24  |
  | 1024 × 640 (0.4)  | 0.38 / 0.10 / 0.10                      | 0.29 / 0.02 / −0.01                     | 0.38 / 0.19 / 0.33 | 0.31 / −0.04 / 0.00 |
  | 768 × 480 (0.3)   | 0.28 / 0.05 / 0.10                      | 0.30 / 0.06 / 0.04                      | 0.35 / 0.07 / 0.30 | 0.35 / 0.01 / 0.03  |

  Paused, the view zoomed out now costs what it costs at fit or less; the one run of −2.97 ms lies within the spread
  of frames of 16 to 19 ms then. While the simulation runs, the map is refreshed in every frame zoomed out. The refresh
  alone, with the map filled again in full (the shape changed) and refreshed after a step (decision 4), in ms at 4.4 /
  8.8 cells per pixel, two rounds under load average 3 to 6 with frames of 3 to 23 ms:

  | Grid        | Full fill, WebGPU        | After a step, WebGPU     | Full fill, WebGL2        | After a step, WebGL2      |
  | ----------- | ------------------------ | ------------------------ | ------------------------ | ------------------------- |
  | 4096 × 2560 | 3.44 / 3.14; 3.40 / 2.95 | 2.51 / 2.02; 3.53 / 3.24 | 5.72 / 6.91; 6.92 / 9.04 | 2.85 / 3.43; 3.63 / 3.94  |
  | 3072 × 1920 | 2.80 / 2.05; 4.11 / 3.38 | 2.24 / 1.60; 3.02 / 3.39 | 4.54 / 5.58; 5.09 / 5.83 | 3.73 / 1.85; 3.01 / 3.72  |
  | 1024 × 640  | 0.48 / 1.19; 0.73 / 1.13 | 1.66 / 1.13; 0.32 / 1.06 | 1.49 / 0.08; 0.97 / 1.21 | 0.79 / −0.28; 0.79 / 0.69 |

  On WebGL2 the refresh after a step costs about half the full fill; on WebGPU it costs 70 % to 100 % of it, within
  the spread. A running simulation at 4096 × 2560 zoomed out thus pays about 2 to 3.5 ms per frame on WebGPU and 3 to
  4 ms on WebGL2 for the view, against frames of 35 to 70 ms there; at 1024 × 640 below 1 ms.

## Amendment 2026-11-12: the line where food steers as hard as a strand holds

### Context

The line of the revision above lay where the food scent equals the hold of a strand (the mark, `scentMark()`): a
level. The
second review found that agents steer by the difference between their sensors (`steer()` in `agents.wgsl`: the front,
left and right sensors, SO cells ahead at 0 and ±SA), not by levels: a scent that is the same at every sensor turns no
agent. It measured, at that line, the food's difference across the left and right sensor points (2 · SO · sin(SA)
apart, 6.9 cells with Jones' SO 9 and SA 22.5°) over the hold of the strand: 6.4 to 7.1 in the Jones model, 3.0 in the
extended model at decay 0.03, 0.94 at 0.003 and 0.63 at 0.001. The line thus meant something ten times different in
the two models, in the very comparison the owner wants. With several strains one summed strand stood for all, the
legend said "The mark shows the trail of a strand" where the food weight or saturation made that untrue, screen
readers heard "Scent per cell a strand Food (green glow)", and a mark outside 0.01 to 10,000 pushed its label past the
bar (items 3, 8 and 9).

The review proposed a line where w · |∇scent| · d equals the hold. A prototype drew three lines in the Transport
network on its 200 × 200 lattice with three dabs after 3,000 steps (WebGPU, 24 rays from the dabs), and measured the
review's ratio where each line lies on the map (the largest lift of the line over the view without it), medians:

| Model                 | The level of the hold | w · \|∇scent\| · d = hold | The sensors' difference = hold |
| --------------------- | --------------------- | ------------------------- | ------------------------------ |
| Jones, decay 0.1      | 7.36 (9.1)            | 1.94 (11.5)               | 1.00 (12.6)                    |
| Extended, decay 0.03  | 3.11 (10.8)           | 1.26 (13.3)               | 1.01 (13.8)                    |
| Extended, decay 0.003 | 0.95 (12.1)           | 1.06 (11.4)               | 1.01 (11.9)                    |

In brackets the line's distance from a dab in cells. The gradient misses the difference across 6.9 cells where the
scent falls off over less than that (in Jones over about 1.6 cells).

### Decision

1. **The line lies where the food steers an agent across its sensors as hard as a strand holds it** (2026-11-12, the
   coordinator's call under the owner's delegation of the same day: "nehm gerne einfach deine empfehlungen und frage
   mich weniger oder gar nicht"). For a strain: the food scent at the sensor point half = SO · sin(SA) cells up the
   gradient at p, less that half cells down it, equals the hold of a strand, self · sat(T) / w (`scentSensors()` in
   `scent.ts`, `scentSensorLine()` in `render.wgsl` and `render.frag`). Inside the line food steers the agent more.
   Reason: it is the only one of the three that marks the same steering balance in every model, a ratio of 1.00, 1.01
   and 1.01 in the table above; the level line gave 7.4 against 0.95 and misled.
2. **Several strains**: each strain that follows its own trail and food has its half spread and its hold; strains of
   one spread share one pair with the lowest hold, up to 4 pairs (`View.scentHalf`, `View.scentHolds`, after
   `View.scentFx`, whose third value the line no longer uses; the uniform grows to 192 bytes). The line lies where the
   largest of the pairs' differences over holds is 1: where food steers at least one strain as hard as its strand holds
   it. Reason: one line has to stand for every strain, and its sensors differ per strain.
3. **The sensors read the scent as the glow does**: up to 2 cells per pixel from the 4 cells around the sensor point
   without the cells of walls (`scentOpenAt()`, from the shape), zoomed out from the coarse map, and in a box beyond
   the edge with the slope of the outer cells. A sensor point with no cell that holds scent (in a wall) senses no food,
   so it gives no line, as a sensor in a wall reads no food in `sense()`. Reason: the line belongs to the view's
   picture of the scent, and the shape of the scent there is what the glow shows.
4. **A shortcut**: where the gradient at p says that the ratio lies more than 20 times off 1 (|∇scent| · 2 · half /
   hold below 0.05 or above 20), the pass reads no sensor. Reason: the two sensor lookups are the line's cost, and the
   difference across 2 · half exceeds the gradient times 2 · half only by a factor 2 sinh(x) / (2x), x = half over the
   length over which the scent falls off: below 20 for any fall-off longer than 0.8 cells.
5. **The legend says what the line means** in one plain sentence, under the bars: "Inside the line, food steers an agent
   more than a strand holds it.", with a short piece of the line in its colour. The mark on the bar and its label are
   gone: the line no longer lies at a level of the scale. Screen readers hear the caption, then "Food (green glow)",
   then the line's sentence. Learn → The model says that an agent steers by the difference between its sensors, what
   the line shows, and that the line stays about 12 to 14 cells from a food in both models while the glow of the
   extended model reaches much farther. Reason: items 8 and 9 of the review, and the line needs no scale to be read.
6. **A model topic, not a decision**: the steering reach of food is about 12 to 14 cells from a food in every model
   (the table above), and the wider scent of the extended model at a low decay does not steer from farther away. It
   stands in `TODO.md` as an open topic of the model (ADR 0022).

### Consequences

- The CPU reference of the GPU tests (`scentAt()` in `sim.gpu.test.ts`) computes the line as decision 1 to 4 say, from
  the same lookup as the glow at the sensor points (`scentLookup()`, `sensorDifference()`); the tests that place the
  line beside a wall or at the box edge aim it there with the food weight (`aimLine()`). Every pixel of the views of
  "scent view" follows it on both backends. A new test draws two strains of different spreads and food weights.
- `scentMark()` is removed: no code read it any more, and `scentSensors()` computes the same hold. Its cases are
  tests of `scentSensors()` now (nothing measured, food that weighs half, trail saturation, the Jones model without
  saturation and with another food weight, the lowest hold of several strains, a fleeing strain), with shared and own
  spreads. `scentLine()` (`scent.ts`, `render.wgsl`, `render.frag`) draws the line where its ratio is 1: it has no
  mark any more (2026-11-12, the coordinator's review of the branch).
- e2e: the legend's sentence shows once a strand is measured, and the legend reads "Scent per cell", then "Food".
- Mutations, each reverted after its run, all caught: the first pair only (WGSL and GLSL); the sensors reading the
  cells of walls (WGSL and GLSL); a sensor in a wall still counted (WGSL); the coarse map's sensors reading cells
  (WGSL); the full spread in place of the half (WGSL); a shortcut of 0.8 to 1.25 in place of 0.05 to 20 (WGSL); the
  difference down less up (GLSL); the highest hold for a shared spread (the unit test). The mutations of the walls and
  of the coarse map's refresh of the amendment above still fail their tests.
- Cost, the Maze at decay 0.003, 2560 × 1600, draw-only, on − off in ms at fit / 4.4 / 8.8 cells per pixel (load
  average about 7.4): 1024 × 640 WebGPU 0.71 / 0.13 / −0.15, WebGL2 0.66 / 0.05 / −0.19; 4096 × 2560 WebGPU 0.97 /
  −0.42 / 0.55, WebGL2 1.22 / 0.54 / 0.02. At fit the line adds about 0.3 ms to the view (0.29 to 0.38 ms before).
