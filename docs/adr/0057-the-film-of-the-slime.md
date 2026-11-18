# 0057: The slime in the picture is a wet film, thick where a tube stayed

- Status: accepted. The look is the owner's decision of 2026-11-17, made on pictures of three looks. The other
  decisions are of an agent under the owner's delegation of 2026-11-12. Built 2026-11-17.
- Date: 2026-11-17
- Changes [ADR 0055](0055-the-slime-field.md), decision 8 (the picture of the slime) and decision 9 (its memory).
  The stamp of ADR 0055, its life time and its brush stay.
- Extended by [ADR 0060](0060-the-growth-front-in-the-picture.md) (2026-11-17): the plasm hides the film below it
  (decision 9 here said that the trail lies on the film), and the edge of the gel has no teeth (an open point here).
- In short: the rule of the amount is in `docs/model.md`, section 6.9, and the rule of the picture in
  `docs/design.md`, section 5. [`research/flow/README.md`](../../research/flow/README.md), part 21, has the commands
  and the records.

## Context

The owner looked at the layer of ADR 0055 in the app on 2026-11-17 and said (translated from German):

1. The slime does not look slimy enough, and it is very jagged.
2. It should be more transparent than plain grey and have a slimy surface, so that it looks more alive: light slimy
   reflections, or a pattern that looks natural. It need not move: a static pattern is enough.
3. An idea: leave slime in the shape of the arm that made it, so that one still sees from which direction a tube
   came and where it turned.
4. The electrodes bother the owner in the same way. They are a pull request of their own, with ADR 0058.

Why the layer of ADR 0055 looked as it did, read in its code:

- **Flat.** It mixed one colour over the ground by the age of the stamp alone.
- **Everywhere the same.** A cell gets a stamp when the trail of a strain reaches the low level. A colony covers most
  ground once, so most ground held slime of nearly the same age: after 22,000 steps of the Snail maze the oldest
  slime had lost 8 % of its strength, with the life time of 144 hours.
- **Jagged.** A cell had slime or it had none, and the picture blended that over one cell.

What the sources say ([slime-mazes-and-the-front.md](../knowledge-base/slime-mazes-and-the-front.md), "Slime"):

- The slime sheath is a coat outside the cell. The plasmodium makes it while it grows and moves, and leaves it
  behind as a collapsed tube, the slime track (Clark and Haskins 2015, p. 646). So the idea of the owner is what
  the organism does: the track has the shape of the tube.
- The slime that stays behind is a thick layer, translucent and not alive (Reid et al. 2012).
- No source of this project gives the rate at which a plasmodium builds its slime.

**Which amount keeps the shape of a tube?** The stamp says when plasm was last in a cell, not how much. A picture
of the track needs an amount. `tests/pictures/slime-amount.spec.ts` runs the Snail maze with the seed 1, samples
the trail every 16 steps, and keeps candidate amounts. The level of the plasm of a cell is the share π of its trail
between the low level and the full level of its strain, the share that the tube body follows (`docs/model.md`,
8.1). At step 22,000, over the 76,224 cells that have slime and hold no plasm:

| Candidate                                               | Mean | Cells above 0.9 | Cells below 0.25 |
| ------------------------------------------------------- | ---- | --------------- | ---------------- |
| the largest level that the cell had                     | 0.98 | 95.3 %          | 0.4 %            |
| the level summed over the steps, full after 500 steps   | 0.98 | 96.5 %          | 0.8 %            |
| the same, full after 2,000 steps                        | 0.69 | 40.4 %          | 4.3 %            |
| the same, full after 8,000 steps                        | 0.28 | 4.8 %           | 62.8 %           |
| the rule of this record: full after 4,095 steps (below) | 0.52 | 16.4 %          | 9.4 %            |
| the time with plasm, full after 8,000 steps             | 0.46 | 13.0 %          | 33.2 %           |
| the amount that the app holds in its field              | 0.50 | 15.3 %          | 11.9 %           |

The candidates count a sample of every 16th step. The app gains in every step, and it takes what is left of old
slime when plasm comes back, so its amount is a little below the candidate of its rule.

The colony of this model is a mesh of tubes from its start. Every cell of a corridor holds full plasm for some
steps while the mesh sweeps over it, so the largest level and a fast sum are flat, as the stamp is. An amount that
grows slowly is high only where a tube stayed, and its picture shows the mesh that the colony had before it left.

## Options

1. **The stamp alone, drawn better**: smooth edges and a surface, no new field. It shows where slime is, and not
   the shape of a tube. This was look C of the pictures.
2. **An amount of slime per cell, for the picture**: a field that grows where a tube stays. Looks A and B.
3. **A picture from the fields of the flow** (the flow memory, the tube body). Ruled out: the slime must not need
   the flow (ADR 0055, decision 3), and both fields forget a tube that starved.

Three looks went to the owner as pictures of each style, fitted and zoomed in, with the Snail maze after the colony
left its blind branches and with strokes of the Slime tool: A, a wet film whose thickness is the amount; B, fine
lines along the walls of the emptied sheath; C, an even wet film from the stamps alone.

## Decision

1. **Look A, the wet film** (the owner, 2026-11-17: "the wet film looks good, I like it"). The slime is a clear film
   on the ground. It is milky where it is thick, light lies on its surface, and it is thick where a tube stayed.
2. **The slime field gets an amount of slime per cell**, a whole number A from 0 to 4,095. Only the picture reads
   it. In every step a cell that holds plasm, the cell that gets a stamp, does this in order:
   - It takes what is left of its amount. That is nothing without slime (no stamp, or an age at or above the life
     time L), all of it for slime of the age 0 or 1, and else ⌊A · (L − age) / L⌋.
   - A ← max(A, min(P, A + 1)), with P the level of the plasm times 4,095, rounded.

   Every other cell keeps its amount. The picture shows A / 4,095 · (1 − age / L). Reasons:
   - A gain of 1 per step makes the amount full after 4,095 steps under a full tube, 2.3 hours of model time. The
     table above has the reason for a slow gain. The number is a choice made on pictures: no source gives a rate.
   - The amount ends at the level of the plasm. So the track of a thin tube is thin, and the track of a tube is
     thinner at its sides than in its middle: the picture gets a smooth slope from the trail, with no edge of a cell.
   - The amount does not decay in the field. The picture takes the age from the stamp, as before, so a change of
     the life time still acts on all slime at once (ADR 0055, decision 3).
   - Plasm that comes back to old slime starts from what the picture showed there. Without this, a thin twig that
     crosses an old track would bring the track back to its first thickness in the cells that it touches.
   - Whole numbers: both backends and the CPU reference agree to 1 of 4,095 (the last bit of the float of the
     trail can round the level the other way), and the difference cannot grow.

3. **The stamp keeps its meaning.** A cell has slime while it has a stamp younger than the life time (ADR 0055).
   Stage 4 of the plan reads "ground without slime" from the stamp alone. No rule reads the amount.
4. **The Slime tool paints the amount too.** A cell at the distance d from the middle line of a stroke of the
   radius r gets the larger of what is left of its amount and 4,095 · t³ (t (6t − 15) + 10), with
   t = clamp((r − d + 0.5) / 4, 0, 1). So painted slime rises from the edge of its stroke to the full amount over
   4 cells, with no step in its slope, and the picture draws a stroke with a smooth rim at any zoom. An erase, a
   wall, Clear and a reset clear the amount with the stamp. Reason for the full amount: the experiments of Reid et
   al. 2012 coat the agar with slime, an even thick layer.
5. **Where the amount lives.** A second storage buffer of `u32` on WebGPU, where the pass of the stamps writes it
   in place. Two targets of unsigned integers of 2 B (R16UI) on WebGL2: a fragment cannot read the target that it
   writes, so the pass of a step reads one target and writes every amount into the other. The pass of the amounts
   runs before the pass of the stamps there, because it needs the stamps of before the step. The brush copies the
   cells of a segment into the free target before it draws them.
6. **The picture reads a map of the film**, one texel per cell, that a pass fills once for each state of the slime
   that a frame draws. The film of a cell is the mean of the thickness of the open cells among the 3 × 3 around it,
   with the weights 1, 2, 1 along each axis. A cell is open when it lies inside the arena and holds no wall that
   the picture draws. Reasons:
   - A wall and a cell outside the arena take the film of the open cells beside them, so the film goes on up to a
     wall and to the rim of the dish, which are drawn over it (the reason of ADR 0055, decision 8, for its blend
     over the open cells). A cell with no open cell among its 3 × 3 takes the mean over the 5 × 5 in the same way,
     with the weights 1, 2, 3, 2, 1: the smooth outline of a wall runs through the cells of the wall, and a pixel
     beside it reads the cells two deep. The gel does the same for its height (`besideWall()`).
   - The cells beside a wall hold less trail than their neighbours. Without the mean the film had a tooth for each
     cell along a slanted wall, and the light on the film showed every tooth.
   - A map costs two reads per cell once per state. Without it every pixel would read the stamps and the amounts
     of 25 cells.
7. **Smooth at any zoom, and fixed in the grid.** The render pass reads the 3 × 3 texels of the map around a pixel
   as a quadratic B-spline, the spline of food and walls (ADR 0009): the thickness and its gradient. The spline has
   no crease, so the light has no seam at the edge of a cell. Above 2 cells per pixel the pass reads a coarse map
   in the same way: the mean of the film over 2, 4, 8 or 16 cells per side, with the levels that the trail has
   (ADR 0028), filled from the map of the cells. The texels and both patterns of decision 8 are fixed in the grid,
   so nothing shimmers when the view moves or zooms. This also ends an open point of ADR 0055: zoomed far out, a
   thin line of slime no longer drops out.
8. **The surface** (`slimed` in `render.wgsl`; `SLIME_LOOK`, `SLIME_RELIEF` and `SLIME_BEAD` in
   `src/engine/render.ts`):
   - **The body.** Thin slime is clear and thick slime is milky: the film shows the share thickness^1.6 of its
     full body. On the dark grounds the body adds a pale colour to the ground. On paper the film is a wet stain:
     it mixes a darker colour into the paper, and its edge has a tide line.
   - **The light.** The lamp of the walls and of the gel, from the top left, puts a small bright highlight and a
     wide weak light on the film. The surface is the film with a relief of 2.5 cells for the full thickness.
   - **The waves**, a static pattern: the thickness varies by 16 % in soft noise with a step of 12 cells, and a
     quarter of a noise of twice the frequency. Its lattice has a whole number of steps along each side of the
     grid, so it repeats with a periodic grid. The pass counts the steps in whole numbers: the nearest to the side
     over 12, and up at a half. With a float, WGSL rounds a half to the even number and GLSL away from 0, and the
     two backends drew other waves on a side of 12 n + 6 cells.
   - **The beads**: small round drops on thick slime, 0.7 to 2.2 cells in radius, about one for 200 cells. A bead
     only catches the light. A bead that also shaded the film looked like a dark dot at the fitted zoom.
   - Detail that is smaller than a pixel fades out from 1 cell per pixel on, and is gone at 1.5: the waves in the
     light and the beads.
   - One colour for all strains (the owner, 2026-11-16, ADR 0052): `#c4d7ce` in the glow and agents styles,
     `#d7e1c8` in the gel style, `#8f8a78` on paper.
9. **What stays of ADR 0055, decision 8.** The film lies on the ground, and the food, the trail, the tubes, the
   light, the walls and the electrodes lie on it. Every style draws it, and the scent view does not. The switch
   Show slime changes no run. A frame without the film has the pixels and the cost of before.
10. **Memory**: the extended model counts 11 B per cell for the slime, in place of 4 B: the stamp, 4 B; the amount,
    4 B; the map of the film, 2 B; and its coarse map, 2 B per texel and a quarter of a texel per cell. That is
    10.5 B, counted as 11. The fit of the grid counts them from the start, as it counts the coarse maps of the trail
    and of the scent (ADR 0028), so the switch and the zoom change no grid.
11. **Not in this record**: the electrodes (ADR 0058), and the picture of the front, stage 3 of the plan. Stage 3
    draws zones by the age of the front, and its last zone is "the slime where the colony left": the film of this
    record. The map of the film and its spline are a way to draw such a zone with smooth edges.

## Results

Measured on 2026-11-17 on an M3 Pro, in headless Chromium. The commands and the records are in
[`research/flow/README.md`](../../research/flow/README.md), part 21. The times are of the branch before it took the
electrodes of ADR 0058 in, against `main` at `a6ffe64`.

### No run changes

**Every scene keeps its bytes.** The digests of the agents, the trail, the scent, the environment, the flow memory
and the pressure equal the record of ADR 0055: 54 of 54 runs after 500 steps (every scene, both backends), and 16 of
16 after 3,000 steps (the eight scenes with the flow, both backends).
The runs are of the head of the branch with the electrodes of ADR 0058 merged in. ADR 0056 and ADR 0058 changed no
byte of a run, so that record is the state of `main`.

### The time of a step

The amount, against `main`, which keeps the stamps alone. Milliseconds per step, the mean of the medians of three
rounds in turns:

| Scene, grid           | Backend | Without the flow       | With the flow         |
| --------------------- | ------- | ---------------------- | --------------------- |
| Maze, 512 × 320       | WebGPU  | 0.197 → 0.237 (+ 20 %) | 1.86 → 1.92 (+ 3 %)   |
| Tokyo, 512 × 512      | WebGPU  | 0.468 → 0.507 (+ 8 %)  | 3.10 → 3.11 (+ 0 %)   |
| Cyclones, 1,024 × 640 | WebGPU  | 3.82 → 3.92 (+ 3 %)    | 20.07 → 20.43 (+ 2 %) |
| Maze, 512 × 320       | WebGL2  | 0.441 → 0.448 (+ 2 %)  | 2.43 → 2.46 (+ 1 %)   |
| Tokyo, 512 × 512      | WebGL2  | 0.787 → 0.729 (− 7 %)  | 3.77 → 3.79 (+ 1 %)   |
| Cyclones, 1,024 × 640 | WebGL2  | 12.41 → 12.31 (− 1 %)  | 29.30 → 30.01 (+ 2 %) |

On WebGPU the amount costs 0.01 to 0.37 ms per step: 0.01 to 0.05 ms in the two small scenes, and 0.1 to 0.4 ms on
1,024 × 640 cells. On WebGL2 two rounds of one case differ by up to 20 %, which is more than the pass of the amounts costs,
so the table does not resolve its cost there. The whole slime field, the stamps and the amount, against a life time
of 0: 0.03 to 0.48 ms more on WebGPU, but for one case that the rounds do not resolve, and 0.05 to 0.99 ms more on
WebGL2.

### The time of a draw

On a canvas of 2,560 × 1,600 pixels, the switch off against the film with its maps filled, in turns on the same
state, medians of 21 batches of 50 draws. The scene Three strains (1,536 × 960 cells), glow style, milliseconds. In
this scene every cell holds slime after 3,000 steps, so every pixel draws the film. "The layer" is what the layer of
ADR 0055 added to a draw on `main` in the same turn of runs:

| Cells per pixel | WebGPU               | The layer | WebGL2               | The layer |
| --------------- | -------------------- | --------- | -------------------- | --------- |
| 0.15            | 1.93 → 3.87 (+ 1.94) | + 0.26    | 4.14 → 8.02 (+ 3.88) | + 0.21    |
| 0.6 (fitted)    | 1.92 → 4.10 (+ 2.18) | + 0.23    | 4.10 → 8.24 (+ 4.14) | + 0.19    |
| 1.2             | 3.35 → 5.37 (+ 2.02) | + 0.30    | 5.36 → 8.26 (+ 2.90) | + 1.06    |
| 1.8             | 4.11 → 5.10 (+ 0.99) | + 0.38    | 6.67 → 7.98 (+ 1.32) | + 1.26    |
| 2.4             | 2.62 → 4.20 (+ 1.58) | + 0.60    | 5.31 → 6.53 (+ 1.22) | + 1.39    |
| 4.8             | 2.48 → 4.16 (+ 1.67) | + 0.76    | 4.93 → 6.37 (+ 1.44) | + 2.58    |

- **The film doubles the time of a draw where it covers the picture**, in a view that fits the grid or is zoomed
  in: 2 ms more on WebGPU and 4 ms more on WebGL2, where the layer cost 0.2 to 0.3 ms. This is the cost of the
  surface: a pixel with film reads 9 texels of the map, 8 values of the lattice of the waves and 9 steps of the
  lattice of the beads, and lights the surface twice (Open points).
- Zoomed out beyond 2 cells per pixel the film costs 1.2 to 1.7 ms. The layer read up to 81 cells per pixel there
  and cost up to 2.6 ms on WebGL2; the film reads 9 texels of the coarse map.
- **The other styles** cost the same: in the fitted view 1.9 to 2.2 ms on WebGPU and 3.1 to 4.0 ms on WebGL2 in the
  gel, paper and agents styles.
- **A scene with less slime costs less**: the Snail maze (384 × 384 cells, slime on a quarter of them) pays 0.03
  to 0.82 ms on WebGPU and up to 1.0 ms on WebGL2.
- **The first frame after a step fills the maps**: 0.64 to 0.90 ms more on WebGPU and up to 1.05 ms more on WebGL2
  for the 1.47 million cells of Three strains, and 0.1 to 0.2 ms for the Snail maze.
- With the switch off a draw runs the shader without the film, as before. The times with the switch off differ by
  up to 14 % between the branch and `main`, and by up to 13 % between two runs of one build.

### The picture

`tests/pictures/slime.spec.ts` makes the pictures again: the Snail maze after 22,000 steps with a life time of 144
and of 6 hours in each style, fitted and zoomed in, strokes of the Slime tool on plain ground, and the start
scene. The film shows the mesh that the colony had in the blind branches before it left them. Both backends draw
the same picture: over strokes of the Slime tool in the four styles, fitted and zoomed in 6 times, the largest
difference of a channel is 2 of 255, the dither.

### Tests

- **The amount** (`slime.gpu.test.ts`, "the amount of slime", both backends against the CPU reference
  `slime-reference.ts`): the amount step by step under living agents and with two strains; plasm that comes back to
  old slime, also after the life time is over; the brush with its rim, over thicker slime, with two strokes in one
  call and on a periodic grid; an erase, a wall, Clear, a reset and the Jones model.
- **The picture** (the same file, "the picture"): the map of the film and its coarse map against the CPU reference,
  with walls, in a dish and on a periodic grid; the picture of the film in each style against the CPU reference
  `slimeColour()`, at views from 0.1 to 6 cells per pixel; the patterns on grids whose side is not a multiple of
  their step. With the film off every pixel equals that of the shaders without it. The scent view draws no film.
- **Faults that the tests found**, all fixed: the two backends drew other waves on a grid with a side of 12 n + 6
  cells (decision 8); on WebGPU the pass of the coarse map kept the texture of a trail that a new grid had freed;
  and the film dipped by up to 1.6 % along the outline of a wall, which the 5 × 5 of decision 6 ends.
- **Wrong rules**: SL1 to SL222. The 77 of the stamps, of the time of the mark and of the brush stay, 25 of them
  with a new text, because the passes now hold the amount. 102 are wrong forms of the picture (SL78 to SL179, in
  place of the 42 of the layer) and 43 of the amount (SL180 to SL222). Each fails at least one test. One wrong rule
  was dropped: "a cell without a stamp has slime" changes no picture, because such a cell has no amount.
  The list has 607 wrong rules, with the 87 new ones of the electrodes (ADR 0058).
- **All tests at the head of the branch**, with the electrodes of ADR 0058 merged in: 874 unit tests with the
  research tests, 1,340 GPU tests on both backends (8 more run on one backend only), and 84 tests of the built app.

## Consequences

- The extended model needs 7 B more per cell. A grid at the limit of the memory of a GPU gets a little smaller.
- A step of the extended model with slime keeps the amount: one more buffer in the pass of the stamps on WebGPU,
  and one pass more on WebGL2.
- A frame after a step fills the map of the film. A paused simulation keeps it.
- The picture of every scene of the extended model changes where the colony left ground. No scene changes a byte
  of its run.
- `SLIME_LOOK` holds the numbers of the look of each style. Another strength or colour is one number there.
- The help of Show slime and the Learn text say what the film shows.

## Open points

- **The film is costly where it covers the picture**: 2 ms of a draw on WebGPU and 4 ms on WebGL2 on a canvas of
  2,560 × 1,600 pixels (Results). Two ways to make it cheaper without another picture: a pixel reads only the steps
  of the lattice of the beads whose bead can reach it, 2.7 of the 9 on average; and a pixel below a trail that
  covers the ground draws no film in the gel and paper styles. Neither is built or measured.
- **The edge of a living tube in the gel style has teeth** at a zoom of 5 and more, one for each cell, on open
  ground and beside a wall: `gel()` ends the gel where the height passes a level, and the height is bilinear between
  the cells. Seen beside the film, which has none. Not changed here.
- **The rate of the amount is a choice.** A source for the rate at which a plasmodium builds its slime would
  replace the 4,095 steps.
- **The film is one colour for all strains.** The amount is one field, as the stamp is.
