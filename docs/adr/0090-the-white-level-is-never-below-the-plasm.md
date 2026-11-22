# 0090: The white level is never below the plasm

- Status: accepted. The owner approved phase 0 of the plan of 2026-11-22 on that day ("Ja, Phase 0"). The option is
  the recommendation of the plan (option A of its part 1.3), chosen by the coordinator under the owner's delegation of
  2026-11-12. Built 2026-11-22 by an agent under the same delegation.
- Date: 2026-11-22
- Extends [ADR 0009](0009-rendering-pipeline.md), decision 2 (the auto levels), and
  [ADR 0062](0062-the-black-level-stays-below-the-plasm.md). The percentiles and the black level stay.
- Extended by ADR 0094 (2026-11-22): item 7 is gone; the frames draw the build-up of a new colony with the floor of its
  next frame.
- In short: the rule of the picture is in `docs/design.md`, section 5 (Auto levels). The plan is
  [research/front/PLAN-2026-11-22.md](../../research/front/PLAN-2026-11-22.md), part 1. The runner
  `research/front/levels.gpu.test.ts` makes the numbers and the pictures of this record again.

## Context

The owner put a colony on an empty dish with the Inoculate tool (the link of 2026-11-22: Food ring on an empty dish of
1536 × 1536 cells). For about 40 steps the slime looked fine. Then its thin arms turned into a thick blob and a cross,
and they thinned out again by about step 700. The model held fine arms the whole time.

The cause is the white level. ADR 0009 puts it at the 99th percentile of the trail of all cells of the grid. A colony
on less than 1 % of the grid puts that percentile on the faint trail that the diffusion spreads around it: the 3 × 3
mean spreads the trail by one cell in every step, so the cells with some trail grow by a ring in every step, far beyond
the plasm. The gain is 1.3 over the white level, so it rose from 0.8 to over 1,000, and the picture drew the whole
colony white. Where more than 35 % of the cells hold some trail, the black level is 0.8 of the white level, and the
gain rose to 5,600. The same percentile is the strand of the scent view (ADR 0009), so its line lay wrong too.

The measure of the plan (part 1.4): in every frame, the gain of the frame times the median trail of the cells that
hold an agent. 1.3 maps that trail to the radiance of the white level; the pass is at most 2.6 in every frame from the
first step to step 2,000.

## Options

The plan, part 1.3:

- A. A floor: the white level is never below the median trail of the cells that hold an agent. The measurement holds
  that median already for the black level (ADR 0062).
- B. Levels from the plasm alone: white and black are percentiles over the cells that hold an agent. The exposure of
  every scene changes.
- C. Keep the levels, and hold the first gain for some steps. It hides the flop at the start alone; with the rules of
  the growth front a colony stays small for thousands of steps.

## Decision

Option A, with these parts:

1. The white level is the larger of the 99th percentile of all cells and the median trail of the cells that hold an
   agent (`whiteFloor()` in `src/engine/exposure.ts`). The trail is the one that the frame draws. Where the agents
   cover more than about 2 % of the grid, the 99th percentile lies above the floor, and the levels are those of before.
2. The floor counts only while the median lies above the lowest bin of the histogram. In the step of an inoculation
   the new agents hold no trail yet, and the floor would give a gain of a thousand.
3. With one agent per cell the cells that hold an agent are those of ADR 0062. Without the rule agents share cells,
   and nobody keeps the agents per cell: the floor reads the cells that an agent moved into in the step (the counts of
   the deposit, `Simulation.movedCells`). The black level of ADR 0062 stays with the rule alone, so the dense scenes
   keep their 65th percentile.
4. The strand of the scent view is never below the same floor, read from the trail of the model (`strandLevel()`).
5. The frames reach the floor at once. Where their white level lies below the floor of a measurement, they take the
   whole measurement and not a quarter of it (`smooth()`). A brighter measurement still comes slowly.
6. The frames measure in every frame while the floor sets the white level, and while a measurement gives nothing
   (`measureSoon()`). Right after an inoculation the trail under the agents grows fast: 0.39 at step 3 and 2.33 at
   step 9 in the owner's link, and 2.6 times from one frame to the next in Food ring on WebGL2. A measurement of every
   sixth frame let the picture of a growing colony burn out between two measurements. The measurements between the
   turns of before (every sixth frame on WebGPU, every fifteenth on WebGL2) only hold the floor, so the picture
   brightens at the pace of before.
7. While the floor sets the white level, the frames brighten no higher than the fixed gain with which they start (0.4
   over the equilibrium of the trail). The first measurements of a colony see a trail that is still building up, and
   a quarter of their gain drew the colony 2.4 times too bright two frames later in Food ring on WebGL2.
8. Both backends measure the same. WebGPU counts the trail of the drawn picture and of the model over the cells
   (`histogram.wgsl`, `held` and `moved`). WebGL2 samples a grid 160 wide, so a colony of 50 cells on a large grid lies
   between its samples. Each of its samples now reads the mean trail of the cells with an agent in its block of
   cells, and counts once for each of them (`sample.frag`). On a grid of up to 160 cells across a block is one cell,
   and the levels are those of before.
9. The frames of WebGL2 start as those of WebGPU: from the fixed gain, with a quarter of each measurement. Its first
   measurement jumped to the levels, and with the trail of a new colony that doubles from one frame to the next, the
   next frame drew it too bright: the product reached 3.03 at step 9 in Food ring with the rules.

## Results

Runs of `research/front/levels.gpu.test.ts`, one seed, 2 steps per frame as in the app. "Before" is the code of
`main` (65cdf6a), "after" this record. The largest product of a frame up to step 2,000; the gain is the one with
which the frame draws.

| Run                      | Backend | Before | After |
| ------------------------ | ------- | ------ | ----- |
| The owner's link         | WebGPU  | 5,637  | 1.87  |
| The owner's link         | WebGL2  | 7,723  | 1.91  |
| Food ring with the rules | WebGPU  | 43,024 | 1.68  |
| Food ring with the rules | WebGL2  | 42,912 | 1.85  |

- After the change the largest product lies at step 9 or 11, where the trail under a new colony still grows fast
  between two frames. Before the change the product passed 2.6 from step 13 on, with the fixed gain of 0.8.
- Two earlier versions failed. With a quarter of every measurement in every frame and without part 7, the product
  reached 2.23 and 2.24 on WebGPU, and 2.16 and 3.04 on WebGL2 (the link, Food ring). With the first jump of WebGL2
  as well, WebGL2 reached 2.56 and 3.03.
- The five scenes of the group Agents share cells, each with one dab of the Inoculate tool on an empty dish
  (`{"layout":"empty"}`), to step 601: the largest product is 0.02 (Cyclones, Dunes) to 0.65 (Dot grid) on both
  backends. Their agents crowd into strands: the 99th percentile lies above the floor in every frame, so the floor does not act there, and no frame shows a flop.
- No scene's picture changed in the tests: every test of a picture passes as before. Two tests of the smoothing
  changed. `src/engine/engine.gpu.test.ts` moves the levels with a third of the trail and not three times the trail:
  three times the trail lifts the plasm above the white level of the frames, and they now take its levels at once.
- The pictures are in `research/front/out/levels/` of the coordinator's checkout (git-ignored): `link-compare.png`
  (the owner's link at the steps 11 to 2001, above before, below after) and `ring-compare.png` (Food ring with the
  rules at the steps 501 to 4001).

Tests: `src/engine/exposure.test.ts` (the rules on the CPU) and `src/engine/levels.gpu.test.ts` (a small colony with
and without the rule of one agent per cell, and the blocks of the samples of WebGL2, on both backends). The wrong
rules `BL12` to `BL23` of `research/flow/engine/mutate.ts` each fail at least one of them; `BL2`, `BL4`, `BL6`, `BL8`
and `V51` to `V54` follow the new text of their files.

## Consequences

- A small colony is drawn as the plasm that the model holds, at every size of the colony and of the grid.
- The frames measure in every frame while a colony is small. A measurement is a histogram pass over the grid on WebGPU
  and a pass of 25,600 samples on WebGL2, each with a read back of a few hundred bytes or kilobytes. The time is not
  measured.
- With the picture of the tubes WebGPU counts one more histogram, over the cells of the agents in the trail of the
  model, for the strand.
- No rule of the model changes: `docs/model.md` stays, and every scene keeps its bytes.
