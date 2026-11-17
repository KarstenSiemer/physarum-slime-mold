# 0055: The slime field: where the colony was, for how long, and how the app shows it

- Status: accepted (decisions of the coordinator of 2026-11-17, under the owner's delegation of 2026-11-12; "one slime
  for all strains" is the owner's decision of 2026-11-16, ADR 0052), built 2026-11-17
- Date: 2026-11-17
- Extends [ADR 0052](0052-the-sources-on-slime-mazes-and-the-growth-front.md): the first part of stage 2 of its plan.
- Changes [ADR 0054](0054-a-starved-tube-leaves-starved-ground.md), decision 4: the time of the mark of starved ground
  is a setting now.
- In short: the facts are in
  [`docs/knowledge-base/slime-mazes-and-the-front.md`](../knowledge-base/slime-mazes-and-the-front.md), "Slime", and
  the rule is in `docs/model.md`.

## Context

Stage 2 of the plan of 2026-11-16 is the slime field (`TODO.md`, "Slime, dead ends and the growth front"). The plan
left these points to the design:

- Do the slime and the mark of starved ground live in one field or in two?
- What is the default of the life time of the slime, and how does that setting reach the mark of starved ground?
- Does the flow memory recover in 18 h again, and do the Tokyo scenes go back to a flow strength of 1.4?
- Does the slime get a rule for the moves of the agents?

Two papers were read in full on 2026-11-17, for this record. The knowledge-base file has their facts.

- **Reid et al. 2012.** The Y-maze has arms of 4 cm, and the arm whose food the plasmodium touches first is the
  chosen arm. On agar with slime everywhere the plasmodia moved as fast as on blank agar. The slime of the U-shaped
  trap was up to 2 days old at the start of a run, and a run lasted up to 5 days.
- **Briard et al. 2020.** The plasmodia of this paper did not answer the slime. The ground was rinsed first, to
  remove the slime. What stayed in the ground repelled when a starved or stressed plasmodium had left it, and
  attracted when a well-fed one had. Three strains showed no difference between their own ground and that of another
  strain.

Measured before (ADR 0053 and ADR 0054):

- A lower weight in the pick of a birth does not keep a colony out of a dead end, and a wall for births that a tube
  body lifts does not either: agents walk onto the ground, their trail gives the cells a tube body, and children
  follow.
- The mark of starved ground does keep it out. The mark is a flow memory at its floor. It closes the ground for
  births, it stays while agents walk over it, and an agent on it dies with 1 to 2 % per step.

**Words.** **Slime** is the layer that a plasmodium leaves on its ground. A cell **holds plasm** while the trail of a
strain there is at or above the low level of that strain (below). The **stamp** of a cell is the step at which it
last held plasm. **Blank ground** has no slime; the plan of ADR 0052 calls it fresh ground, but the flow uses that
name for ground with a flow memory of 0.2 (ADR 0053), so this record uses the word of Reid et al.

## Options

1. One field. The slime takes the mark of starved ground over, and the flow memory recovers in 18 h again.
2. Two fields. The slime is new, the mark stays in the flow memory, and each has a time of its own.
3. Two fields, and one setting gives both their time.

## Decision

1. **Stage 2 has two pull requests.** This record is the first: the slime field, its life time, its brush and its
   picture. No rule reads the slime yet, so no run changes. The second is the rule of avoidance with its
   measurement in a Y-maze (ADR 0056). Reason: the owner sees the slime with the first, and stage 4 needs the field.
   The rule needs a measurement before its design is safe ("What the second pull request must measure first",
   below). Two pull requests also stay small enough to read.
2. **Two fields, and one setting for their time (option 3).** Three reasons:
   - The organism has two things. The slime is one. The substance that stays in rinsed ground is the other (Briard
     et al. 2020). The mark of starved ground fits the second: ground that a starved tube left is closed, and ground
     that a fed tube left is taken again at once.
   - The mark of starved ground does two jobs that need the flow memory. It stays under a tube body, and it starves
     the agents that walk onto it. A field that only says "the colony was here" does neither (ADR 0053, the rule
     `left`).
   - The slime is one field for all strains (the owner, 2026-11-16). The flow memory is a field of each strain.
3. **The slime field.** One field for all strains. It holds the stamp of each cell, or none.
   - A cell holds plasm in a step when the trail of at least one strain, after the diffusion of that step, is at or
     above the low level of that strain: T_s ≥ 0.2 · u_s. This is the level from which the tube body grows
     (`docs/model.md`, 8.1; `trailLevels()` in `src/engine/flow.ts`). The test is the same with the flow and
     without it.
   - A cell that holds plasm in a step gets the number of that step as its stamp. Every other cell keeps its stamp.
     A wall and a cell outside the arena never get one.
   - A cell **has slime** at step t while it has a stamp S and t − S < L. L is the life time in steps.
   - The pass runs after the diffusion of a step, in every step while L > 0. A reset clears every stamp.
   - Reason for a stamp in place of an amount that decays: a stamp is exact on both backends, it needs no write
     where nothing happens, and a change of the life time acts on all slime at once. The age of the slime is also
     what the picture needs, and what stage 3 plans for the front.
   - Reason for the trail level: the model already says with it where a plasmodium is. The tube body follows the
     same level, but it exists only with the flow, and the slime must not need the flow.
4. **The life time is the setting Slime life time**, in hours of model time: 0 to 240, default 144 (6 days). An hour
   is 1,800 steps (ADR 0029, decision 10), also without the flow. At 0 the model has no slime, and the pass does
   not run. Reason for 144: it is the time that ADR 0054 took for the mark of starved ground, from the longest
   avoidance of slime that a source reports. The trap of Reid et al. 2012 supports a time of days. No source
   measured the life time.
5. **The same setting gives the mark of starved ground its time.** With the flow, the flow memory of ground without
   a tube grows by the share `FLOW.recover` · (144 / Slime life time) per step. At 144 this is `FLOW.recover`, bit
   for bit, so every scene keeps its bytes. At 18 it is the share of ADR 0029, decision 19, 0.00023. At 0 the mark
   keeps the share of ADR 0054. Reason: ADR 0054 left the setting to this stage. The time says how long a colony stays away
   from ground that it left. The picture of the slime and the closed ground then fade together.
6. **The flow memory keeps one recovery time, and the Tokyo scenes keep a flow strength of 2.8.** Reason: the mark
   stays in the flow memory (decision 2). A second, shorter time for ground above the level 0.01 (option 6 of
   ADR 0054) changes the rule of the tubes and the bytes of the eight scenes with the flow. It is an open point for
   the second pull request, which has the campaign for it.
7. **A brush paints slime.** Reason: the experiments of Reid et al. 2012 coat the agar with slime, and a scene is a
   list of strokes.
   - The tool Slime gives the open cells of its stroke the stamp of the current step, with the hard edge of food.
     Painted slime ages as the slime of the colony does: one field holds both.
   - Erase clears the stamp of its cells, also a stamp of the colony. A wall does the same: a wall replaces what a
     cell holds, as it does with food and light. So no wall holds a stamp. Clear clears every stamp, as an erase of
     the whole grid does.
   - A reset clears every stamp (decision 3). The engine then paints the strokes of the list again that write or
     clear a stamp, in their order, with the stamp of the current step: 0 after a reset. It does the same when a
     switch of the model gives the model its field again. The field is then the one that the strokes painted, cell
     for cell: after the last stroke that covers a cell, no stroke makes the cell a wall or opens it.
   - The tool is there while the model has slime: in the extended model, with a life time above 0.
8. **The app draws the slime** as a pale layer where a cell has slime. The layer tints the ground. The food, the
   trail, the tubes, the light, the walls and the electrodes lie on it. Its strength falls in a straight line with
   the age of the slime, from full at the age 0 to nothing at the life time. Every style draws it, and the scent
   view does not. The setting Show slime of the view turns it off; it changes no run. Reason for the ground: the
   slime lies on the agar and below the plasmodium, and the picture must still show where the colony is now.
   - The layer has one pale colour for all strains. Its full strength is 0.02 in the glow and agents styles, 0.024
     in the gel style and 0.22 in the paper style (`SLIME_LOOK` in `src/engine/render.ts`). Reason: stronger
     layers washed out the walls in the pictures of each style.
   - Between the cells the view blends the strengths, never the stamps, and only over the cells that can hold
     slime. Reason: with the walls in the blend the layer faded towards a wall and towards the rim of the dish, in
     steps of whole cells.
   - Zoomed out, a pixel shows the mean of the strength over its square. Above 2 cells per pixel one cell stands
     for each texel of the coarse map of the trail. Reason: the layer then needs no texture and no pass of its own.
     A thin line of slime can drop out there.
   - The render pass holds the code of the layer only for a frame that draws it. A frame without the layer has the
     pixels and the cost of before.
9. **Memory**: the stamp is 4 B per cell, on both backends. The fit of the grid counts them in the extended model,
   with slime or without it, so that the setting does not change the grid.
10. **Links and the Jones model.** A link without the setting has a life time of 0: it has no slime, and it runs as
    it was made, as in ADR 0050. The Jones model has no slime: a switch to it frees the field with its stamps, and
    a switch back starts with the painted slime only (decision 7).
11. **Not in this record**: a rule that reads the slime (the avoidance, the moves), the scene Y-maze, and the
    U-shaped trap. The owner's wish that the slime is "perfused" stays an open question (ADR 0052).
12. **The panel has a section Slime**, in the extended model: the Slime life time and, while the model has slime,
    the switch Show slime. Reason: the slime needs no flow, so its switch does not belong in the section Flow, and
    the second pull request puts its settings there too.

## How the build reads the decisions

The helpers that built the three parts made these choices, and the coordinator took them over:

- The pass of the stamps tests no wall and no arena (decision 3). The diffusion leaves no trail on a wall or outside
  the arena, and every low level is above 0, so such a cell never holds plasm.
- A stroke keeps the arena of its painting, as a stroke of food does (decision 7). So a cell gets a stamp only if it
  lies inside the arena of the stroke and inside the arena of the simulation.
- With a life time of 0 the extended model still has the field, and a stroke of slime still stamps it (decisions 4
  and 9). Only the tool is hidden. So the painted slime of a scene is there again when the life time comes back.
- A frame draws no layer while the simulation holds no field: after a switch to the extended model, until the
  first stamp (decisions 8 and 10). No cell has slime then.
- The rule of the mark holds the 144 hours as a number of its own (`RECOVER_LIFE` in `src/engine/flow.ts`), not
  the default of the setting (decision 5). Another default must not change the time that a life time gives.
- Erase, Clear and the notice of a switch to the Jones model name the slime in their texts.

## Results

Measured on 2026-11-17 on an M3 Pro, in headless Chromium. The commands and the records are in
[`research/flow/README.md`](../../research/flow/README.md), part 19.

### No run changes

- **Every scene keeps its bytes.** The digests of the agents, the trail, the scent, the environment, the flow
  memory and the pressure equal those of `main` at `3825266`: 54 of 54 runs after 500 steps (every scene, both
  backends), and 16 of 16 after 3,000 steps (the eight scenes with the flow, both backends).
- **A Slime life time of 18 hours gives the runs of ADR 0054 with 18 hours.** The Snail maze ran to step 80,000
  with the setting at 18, seeds 1 to 3, with a sample every 500 steps. All 484 lines of `measure-mazes.ts` equal the
  record `analysis-snail-maze-floor.txt` of ADR 0054, which set the share 0.00023 by hand. So the setting gives the
  mark its time (decision 5), and the stamps of a run with another life time change no measure.

### The time of a step

The pass of the stamps, with the default life time against a life time of 0, which runs no pass. Milliseconds per
step, the mean of the medians of two rounds in turns (a third round was disturbed and is left out):

| Scene, grid           | Backend | Without the flow       | With the flow         |
| --------------------- | ------- | ---------------------- | --------------------- |
| Maze, 512 × 320       | WebGPU  | 0.129 → 0.140 (+ 9 %)  | 1.49 → 1.55 (+ 4 %)   |
| Tokyo, 512 × 512      | WebGPU  | 0.363 → 0.404 (+ 11 %) | 2.56 → 2.58 (+ 1 %)   |
| Cyclones, 1,024 × 640 | WebGPU  | 2.89 → 3.00 (+ 4 %)    | 16.80 → 17.03 (+ 1 %) |
| Maze, 512 × 320       | WebGL2  | 0.347 → 0.366 (+ 6 %)  | 2.03 → 1.98 (− 2 %)   |
| Tokyo, 512 × 512      | WebGL2  | 0.540 → 0.637 (+ 18 %) | 3.08 → 3.00 (− 3 %)   |
| Cyclones, 1,024 × 640 | WebGL2  | 10.10 → 10.17 (+ 1 %)  | 24.79 → 26.30 (+ 6 %) |

On WebGPU the pass costs 0.01 to 0.23 ms per step. On WebGL2 two rounds of the same case differ by up to 15 %.
That is more than the pass costs in most cases, so the table does not resolve its cost there.

### The time of a draw

The layer of the slime on a canvas of 2,560 × 1,600 pixels, switch off against switch on in turns on the same
state, medians of 21 batches of 50 draws. The scene Three strains (1,536 × 960 cells), glow style, milliseconds:

| Cells per pixel | WebGPU               | WebGL2               |
| --------------- | -------------------- | -------------------- |
| 0.15            | 1.59 → 1.81 (+ 14 %) | 4.51 → 4.56 (+ 1 %)  |
| 0.6 (fitted)    | 1.60 → 1.80 (+ 12 %) | 4.53 → 4.56 (+ 1 %)  |
| 1.2             | 2.73 → 2.99 (+ 10 %) | 5.09 → 5.94 (+ 17 %) |
| 1.8             | 3.60 → 3.91 (+ 9 %)  | 6.00 → 7.05 (+ 18 %) |
| 2.4             | 2.32 → 2.96 (+ 27 %) | 5.17 → 6.43 (+ 24 %) |
| 4.8             | 2.23 → 2.84 (+ 27 %) | 4.69 → 6.94 (+ 48 %) |

The gel style and the Snail maze give the same picture: 0.01 to 0.9 ms more up to 1 cell per pixel, and up to
2.5 ms more on WebGL2 at 4.8 cells per pixel. So the layer costs about a tenth of a draw on WebGPU in a view that
fits the grid, and up to half of a draw on WebGL2 in a view that is zoomed far out (Open points).

### The picture

`tests/pictures/slime.spec.ts` makes the pictures again: the Snail maze after 22,000 steps with a life time of 144
and of 6 hours in each style, a stroke of the Slime tool on plain ground, and the start scene. With 6 hours the
ground that the colony left first is blank again, and the ground that it left later is paler than new slime. The
layer shows in every style: clearly in the gel and paper styles, and faintly in the glow style.

### Tests

- **The stamps** (`slime.gpu.test.ts`, both backends against the CPU reference `slime-reference.ts`): the stamps
  step by step under living agents, in each order of a step, in a dish, with the flow and with two strains; no
  stamp with a life time of 0; a reset; the Jones model.
- **The brush** (the same file, "the brush"): the Slime tool, an erase, a wall and Clear against the CPU reference,
  at the edge of a brush, with strokes that are longer than a periodic grid, and with 6,400 strokes in one call.
- **The picture** (the same file, "the picture"): the layer against the CPU reference `slimeLayer()`, also on the
  copies of a periodic grid. With the layer off every pixel equals that of the shaders of before, in every style.
  The scent view draws no layer. A draw changes no byte of the simulation.
- **The engine** (`engine-env.test.ts`): the engine paints the slime again after a reset and after a switch of the
  model, a link holds the strokes, and the fit of the grid counts the field.
- **The time of the mark** (`flow.test.ts`, `flow.gpu.test.ts`): at 144 hours the passes get the share of ADR 0054
  bit for bit, and at 18 hours starved ground recovers with eight times that share.
- **Wrong rules**: SL1 to SL119. 31 are wrong forms of the stamps and of the time of the mark, 46 of the brush and
  42 of the picture. Each fails at least one test. The list has 417 wrong rules.
- **All tests at the head of the branch**: 791 unit tests with the research tests, 1,213 GPU tests on both backends
  (7 more run on one backend only), and 84 tests of the built app.

## Consequences

- The extended model needs 4 B more per cell. A grid at the limit of the memory of a GPU gets a little smaller.
- A step of the extended model runs one pass more, and a start of the app builds one pipeline more for it. The
  layer of the slime builds two render pipelines more at the first frame that draws it.
- A scene and a link can hold strokes of slime. A link with them keeps the version 4: an older build refuses the
  kind of the stroke, as it refuses a later version.
- A new link of the extended model holds the Slime life time. A link made before has none: it has no slime, and
  its mark of starved ground keeps the time of ADR 0054.
- The time of the mark of starved ground follows the setting. A scene that sets a shorter life time lets a colony
  come back sooner to ground that it left.
- The help of Flow in the tubes names the Slime life time for the time that starved ground stays closed.
- The panel has one section more, and the toolbar one tool more (key 9).
- The build prints the notice of Vite that its main chunk is larger than 500 kB: 504 kB, 494 kB before. The build
  passes.

## Open points

- **No rule reads the slime.** The second pull request of stage 2 measures the Y-maze and builds the avoidance
  (below).
- **The mark of starved ground is a mark of each strain.** Briard et al. 2020 found no difference between the
  ground of the own strain and of another one. A colony of one strain grows onto ground that another strain
  starved on. Not measured, and not changed here.
- **A draw that is zoomed far out is slow on WebGL2** with the layer: up to 2.5 ms more at 4.8 cells per pixel.
  Two ways to make it cheaper are not built: 4 reads in place of 9 above 1 cell per pixel, or a coarse map of the
  strength as the trail has one, which costs a texture and a pass.
- **The pass of the stamps is a pass of its own.** The last pass of the diffusion could write the stamp, on WebGL2
  into a second target. That saves the pass, and it ties the two rules together. Not tried.
- **The main chunk of the build is above 500 kB.** A split by backend would load only the shaders of the backend
  that runs. Not tried.
- **Tests in the image of CI**: `slime.gpu.test.ts` and the e2e test of the Slime tool ran there (SwiftShader) and
  pass. The other tests of this pull request ran on the M3 Pro only before the push; CI runs them all.
- **The supplement of Briard et al. 2020** (S9, the three strains) is not read.

## What the second pull request must measure first

These lines are inferences of the coordinator from the rules and from the papers. Nothing here is measured.

- **A weight in the pick acts in a thin layer only.** The plan gives a cell with slime a weight of 0.025 in the pick
  of a birth, and no effect when every free neighbour has slime. So the weight acts only on a parent that has blank
  and slimed neighbours at once: a layer of one cell where blank ground meets slime. Agents walk across that layer,
  and behind it every free neighbour has slime. ADR 0053 measured this for the dead ends.
- **The choice of the organism is a choice of the whole front.** The plasmodium moves its plasm to the part of the
  front that goes on. In the model only the flow joins the far parts of a colony. Stage 4 makes a birth onto blank
  ground a sink of the flow. A front on slime then gets no flux while another front grows on blank ground, and the
  rule of the tubes starves it. With slime everywhere no front is a sink, no tube adapts, and the colony grows as on
  blank ground: that would give "no preference" and "the same speed" of Reid et al. 2012.
- **So the Y-maze comes first.** The second pull request builds the Y-maze as a test of research, measures the
  planned weight there with 40 seeds, and reports how much of the losing arm the colony fills. If the weight alone
  does not reach 39 of 40, the target of the Y-maze moves to stage 4, and the record says so.
