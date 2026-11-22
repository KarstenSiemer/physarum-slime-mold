# 0094: The gain of a young colony does not depend on the density

- Status: accepted. Decided 2026-11-22 by an agent under the owner's delegation of 2026-11-12, on the owner's report
  of 2026-11-22.
- Date: 2026-11-22
- Extends [ADR 0090](0090-the-white-level-is-never-below-the-plasm.md), item 7 (the cap at the fixed gain).
- In short: the rule of the picture is in `docs/design.md`, section 5 (Auto levels). The runner
  `research/front/levels.gpu.test.ts` makes the records and the pictures of this record again, and
  `research/front/levels-rules.ts` plays the rules over the records.

## Context

The owner, 2026-11-22: the fix of the too thick start (ADR 0090) added a new bug. At the start the slime can lie over
the tubes for a good while: the tubes look milky and colourless, and later their bright colours pop out at once.

ADR 0090, item 7: while the floor sets the white level, the frames brighten no higher than the fixed gain with which
they start. That gain is 0.4 over the equilibrium of the trail (`equilibrium()` in `src/engine/sizing.ts`), and the
equilibrium comes from the density setting, not from the trail of the colony. In the owner's link the density is 0.01,
the fixed gain 0.8, and the plasm needs a gain of 0.22 to 0.28: the cap never binds. Where the fixed gain lies below
the gain of the plasm, the frames stay too dark for the whole time that the floor sets the white level. A colony on a
grid of 1536 × 1536 cells needs thousands of steps to cover the 2 % of the grid at which the 99th percentile passes the
floor. Too dark plasm hides little of the ground below it (`glow()` in `src/engine/shaders/render.wgsl`), so the slime
shows through it. When the 99th percentile passes the floor, the cap ends, and the gain rises to the measurement in a
few turns: the pop.

## Measures

Defined before the runs. A run is one seed of `research/front/levels.gpu.test.ts`, 2 steps per frame as in the app.

1. Not too bright (ADR 0090): in every frame up to the last step of the run, the gain of the frame times the median
   trail of the cells that hold an agent is at most 2.6.
2. No long dark phase: from step 101 on, in every frame whose measurement has the floor as its white level, the
   measured gain is at most 1.5 times the gain with which the frame draws. The trail under a new colony stops growing
   by step 51 in the owner's link and in Food ring with the rules (the records of ADR 0090).
3. No pop: from step 101 on, the gain of the frames never rises by more than 1.5 times within 100 steps.

The cases: the owner's link at its own density (0.01) and at a density of 0.1, and Food ring with the rules
(`{"territory":true}`), on both backends, 3,000 steps each.

## The cause in a run

`research/front/levels.gpu.test.ts` now also records a measurement of the state after every frame (`m`: the measured
gain, the white level, the floor and the black level). The owner's link with a density of 0.1, on `main` (ff39d2b):

- WebGPU: the frames draw with the fixed gain 0.08 from the first step to step 1,993, while the measurements give a gain
  of 0.22 to 0.28. The plasm is drawn at a product of 0.4 to 0.5 instead of about 1.3. At step 1,993 the 99th
  percentile passes the floor (about 35,000 cells hold an agent, 1.5 % of the grid), the cap ends, and the gain rises
  to 0.27 by step 2,201: 3.2 times within 100 steps (measure 3).
- WebGL2: the same until step 1,081, where its samples put the 99th percentile above the floor; the frames are 3.5
  times too dark (measure 2), and the gain rises 2.4 times within 100 steps.
- The colony is the same at both densities: on an empty dish the density sets no agent, only the fixed gain. Its cells
  and its trail match step for step.

The fixed gain of the 33 scenes lies between 0.014 (Cyclones) and 2.4 (Three networks). With one agent per cell, nine
scenes start below 0.1, and four between 1.6 and 2.4.

## Options

The levels change no part of the model, so the measurements of a run are the same under every rule of the smoothing.
`research/front/levels-rules.ts` plays a rule over the measurements of a record, with the turns of the frames of each
backend. Its play of the rule of `main` gives the gain of every frame of the six records of `main` exactly. It also
plays each rule from other fixed gains (0.014, 0.08, 0.8 and 2.4) over the same measurements: a rule whose picture
does not depend on the density passes from every fixed gain.

- Cap: `main`, ADR 0090 item 7.
- (a) No cap: in the floor phase the frames brighten by a quarter at each turn and reach the floor at once (item 5).
- (b) No brightening while the floor sets the white level and rises from one measurement to the next; else as (a).
- (c) As (a), and while the floor rises, the frames take the floor grown once more by its last rise.
- (d) As (c), but only in the build-up of a new colony: from a measurement without a floor to the first measurement
  whose floor does not rise.
- (e) As (d), and at the first measurement of a build-up, where no rise is known yet, the frames do not brighten.

The measures of the runs of `main`, each played from its own fixed gain (1: the largest product; 2: the most too
dark; 3: the largest rise):

| Case                   | Backend | Cap              | (a)              | (b)              | (d)              |
| ---------------------- | ------- | ---------------- | ---------------- | ---------------- | ---------------- |
| The link, density 0.01 | WebGPU  | 1.87, 1.06, 1.13 | 2.23, 1.06, 1.13 | 1.87, 1.12, 1.08 | 1.45, 1.06, 1.13 |
| The link, density 0.01 | WebGL2  | 1.91, 1.15, 1.11 | 2.16, 1.15, 1.11 | 1.91, 1.22, 1.13 | 1.52, 1.15, 1.11 |
| The link, density 0.1  | WebGPU  | 1.17, 3.45, 3.23 | 2.09, 1.06, 1.13 | 1.29, 1.61, 1.48 | 1.45, 1.06, 1.13 |
| The link, density 0.1  | WebGL2  | 1.29, 3.54, 2.40 | 2.04, 1.15, 1.11 | 1.29, 1.96, 1.49 | 1.52, 1.15, 1.11 |
| Food ring, rules on    | WebGPU  | 1.80, 1.37, 1.21 | 2.87, 1.37, 1.21 | 1.80, 1.38, 1.17 | 1.82, 1.37, 1.21 |
| Food ring, rules on    | WebGL2  | 1.66, 1.48, 1.16 | 2.37, 1.48, 1.16 | 1.66, 1.52, 1.12 | 2.14, 1.48, 1.16 |

- The cap passes only from a fixed gain of 0.8. From 0.014 and 0.08 the frames are up to 24 times too dark (measure
  2); from 2.4 the first frames of Food ring reach 2.87 and 2.83 (measure 1).
- (a) fails measure 1 in Food ring on WebGPU (2.87 at step 9), and from 2.4 on both backends. The first turn takes a
  quarter of the gain of a trail that is still tiny. The frames then reach the floor at once, at step 7, and the trail
  grows by 2.2 times to the next frame.
- (b) fails measure 2 in the link with a density of 0.1 (1.61 and 1.96) and in Food ring on WebGL2 (1.52), and from
  0.014 up to 4.9. While the floor rises the frames wait, and after the build-up a quarter at each turn is too slow.
  From 2.4 it fails measure 1 as the cap does.
- (c) fails measure 2 in Food ring on WebGL2 from every fixed gain (1.73 at step 203). Its colony holds 32 to 83 cells,
  and its floor changes by up to a third from one frame to the next, by more than 9 % in one frame of ten: (c) takes
  each rise for growth and draws the colony too dark.
- (d) passes every measure in these runs and from every fixed gain: the largest product is 1.45 to 2.14, the frames
  are at most 1.48 times too dark (as with the cap, in Food ring on WebGL2 at step 103), and the gain rises at most
  1.21 times within 100 steps.
- (e) fails measure 2 from 0.014 and 0.08 (up to 2.23): at the first measurement of a build-up the frames wait, and a
  quarter at each later turn is too slow, as in (b).

Over all 20 runs of this record (the six cases on `main` and with (d), and Food ring with the seeds 1 to 4 on both
backends with (d)), each played from its own fixed gain and from 0.014, 0.08, 0.8 and 2.4, that is 80 plays: the cap
fails 51 of them, (a) 19, (b) 53, (c) 26, (d) 1 and (e) 16. From its own fixed gain (20 plays) (d) and (e) fail none,
the cap 4 (the link with a density of 0.1), (b) 6, and (a) and (c) 8 each. The one play that (d) fails: Food ring
with the seed 1 on WebGL2 from 2.4, with a product of 2.74 at step 9.

## Decision

(d), by the measures:

1. Item 7 of ADR 0090 is gone. The fixed gain `0.4 / equilibrium()` is the gain of the frames until the first
   measurement, and no limit after it. `smooth()` and `measure()` no longer take it.
2. The build-up of a new colony (`smooth()` in `src/engine/exposure.ts`): its floor sets the white level and rises at
   every measurement, from a measurement without a floor (the start, an empty dish) to the first measurement whose
   floor does not rise. Its trail grows by up to 2.6 times from one frame to the next, and a measurement reaches the
   frames one frame late. So the frames take each measurement of the build-up as if its floor were the floor grown once
   more by its last rise, the floor of the next frame: they reach that floor at once, and brighten toward its gain by a
   quarter at a turn.
3. The frames keep the floor of their last measurement and whether the colony builds up (`Frames`), on both backends;
   a reset forgets both. A `blend` of 1 (a test, `settle()`) takes the measurement as it is.
4. Items 5, 6, 8 and 9 of ADR 0090 stay: the floor holds at once, the frames measure in every frame in the floor phase,
   and a measurement between two turns only holds the floor.

## Results

Runs of `research/front/levels.gpu.test.ts`, 3,000 steps each. "Before" is `main` (ff39d2b), "after" this record. The
play of (d) over each run of this code gives the gain of every frame of the run, on both backends.

| Case                   | Backend | Before           | After            |
| ---------------------- | ------- | ---------------- | ---------------- |
| The link, density 0.01 | WebGPU  | 1.87, 1.06, 1.13 | 1.45, 1.06, 1.13 |
| The link, density 0.01 | WebGL2  | 1.91, 1.15, 1.11 | 1.52, 1.15, 1.11 |
| The link, density 0.1  | WebGPU  | 1.17, 3.45, 3.23 | 1.45, 1.06, 1.13 |
| The link, density 0.1  | WebGL2  | 1.29, 3.54, 2.40 | 1.52, 1.15, 1.11 |
| Food ring, rules on    | WebGPU  | 1.80, 1.37, 1.21 | 2.08, 1.30, 1.28 |
| Food ring, rules on    | WebGL2  | 1.66, 1.48, 1.16 | 2.44, 1.43, 1.27 |

- The link with a density of 0.1 now draws the same frames as at its own density from step 9 on. Before the change they
  differed until step 2,201.
- The model of the link is the same in every run. That of Food ring is not: a run of the same seed grows another
  colony, so its before and after are other colonies. With the seeds 1 to 4 on both backends and (d), the largest
  product is 1.61 to 2.50, the frames are at most 1.44 times too dark, and the gain rises at most 1.25 times within
  100 steps. The cap gives at most 1.97, 1.44 and 1.25 over the same runs.
- The largest products of (d) lie at step 9 in Food ring. There the trail under the colony rose by 1.64, by 1.32 and
  then by 2.35 times from one frame to the next (WebGL2): a floor grown by the last rise falls short where the growth
  speeds up. The cap drew these frames darker only because 0.8 lies far below the gain of the first frames; from 2.4
  it reaches 3.38, and from 0.014 and 0.08 it fails measure 2 in every run (up to 26 times too dark).
- Pictures (git-ignored): `research/front/out/levels/link01-compare-webgpu.png` and `link01-compare-webgl2.png`, the
  owner's link with a density of 0.1 at the steps 61, 301, 1,001, 1,801, 2,001, 2,201 and 3,001; above `main`, below
  this record. Above, the tubes are pale and milky until step 2,001 and turn yellow at step 2,201; below they are
  yellow from the start.
- Not changed: from about 2 % of the grid on, the 99th percentile sets the white level (ADR 0009), and the plasm is
  drawn paler than the brightest strands. In the link the product falls to about 1.0 by step 3,001, before and after.

Tests: `src/engine/exposure.test.ts`. The test of the cap is gone; three tests are new: a young colony reaches the gain
of its plasm from any fixed gain within ten turns, the build-up is drawn with the floor of the next frame, and the
build-up ends at the first floor that does not rise. The wrong rules of `research/flow/engine/mutate.ts`: `BL22` is now
the cap at the gain with which the frames start, `BL24` to `BL26` are new (no floor of the next frame, a build-up that
never ends, a prediction with a blend of 1), and `BL15` follows the new text. Each fails at least one test.

## Consequences

- A young colony is drawn with the gain of its own plasm from the end of its build-up on, whatever the density. The
  density sets only the gain of the frames before the first measurement.
- The first frames of a colony still depend a little on that gain: from 2.4, one of the ten runs of Food ring drew one
  frame at a product of 2.74 (step 9).
- The frames keep two more values on each backend. No rule of the model changes: `docs/model.md` stays, and every
  scene keeps its bytes.
