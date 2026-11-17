# 0056: The avoidance of slime waits for the growth front: what the Y-maze measured

- Status: accepted (decisions of the coordinator of 2026-11-17, under the owner's delegation of 2026-11-12). The
  rule for the moves stays the owner's to ask for, as the plan of 2026-11-16 left it (`TODO.md`).
- Date: 2026-11-17
- Extends [ADR 0055](0055-the-slime-field.md): the second part of stage 2 of the plan of
  [ADR 0052](0052-the-sources-on-slime-mazes-and-the-growth-front.md).
- In short: [`research/flow/README.md`](../../research/flow/README.md), part 20, has the commands and the records.

## Context

The plan of stage 2 gives the slime one rule: a cell with slime has the weight 0.025 when a parent picks the cell
of its child, and the rule does nothing when every free neighbour has slime. ADR 0055 built the slime field and
left the rule to this record, after a measurement in a Y-maze.

The targets are three facts of Reid et al. 2012
([slime-mazes-and-the-front.md](../knowledge-base/slime-mazes-and-the-front.md), "The plasmodium avoids its own
slime"):

1. With slime on one arm, 39 of 40 plasmodia chose the blank arm.
2. With slime on both arms they showed no preference.
3. On agar with slime everywhere the plasmodia moved as fast as on blank agar.

**The Y-maze of the measurement** is research code, not a scene of the app (`research/flow/engine/y-maze.ts`):

- One cell is 0.537 mm, as in the Tokyo scene. A base of 19 × 19 cells (1 cm²), two arms of 74 cells (4 cm) at 45°
  to the axis, a food at the end of each arm, and walls elsewhere. The arms are 19 cells wide, and 9 cells in one
  more case. The paper states neither the width nor the angle. A unit test checks that the layout is its own
  mirror image, cell for cell.
- The settings are those of the scene Snail maze: growth and shrinkage, one agent per cell, and the flow.
- The slime of an arm is painted at step 0. The colony comes onto the base after 18,000 steps (10 h), because the
  slime of the paper was 8 to 12 h old. It starts with about 50 agents and without a food on the base.
- The arm whose food holds plasm first is the chosen arm. The score looks after every step. The samples of 50
  steps that the coordinator had decided call 24 of 40 runs a split, because a colony crosses an arm in 65 steps.
- Rules ran as variants of the passes of WebGPU (`research/flow/engine/variant.ts`), not in the app.

## What the Y-maze measured

Slime on one arm, 40 seeds where no number of seeds is named. "First touch" is the median number of steps from the
start of the colony to the first food. "Other food" is the median number of steps from there to the other food.

| Rule                                                        | Blank : slime | p     | First touch | Other food |
| ----------------------------------------------------------- | ------------- | ----- | ----------- | ---------- |
| The app: no rule                                            | 19 : 20       | 1.00  | 65          | + 23       |
| Births: weight 0.025 for a cell with slime (the plan)       | 26 : 11       | 0.020 | 65          | + 29       |
| Births: the weight only for slime older than 300 steps      | 28 : 12       | 0.017 | 67          | + 37       |
| Births: old slime is not open while another neighbour is    | 26 : 14       | 0.081 | 67          | + 28       |
| Births: no birth onto old slime at all (10 seeds)           | 7 : 3         | 0.34  | 65          | + 6        |
| Sensors: a sensor reads 10 less on old slime (10 seeds)     | 6 : 4         | 0.75  | 65          | + 28       |
| Moves: a move onto old slime succeeds with the chance 0.025 | 40 : 0        | 2e-12 | 68          | + 183      |
| Moves: the same with arms of 9 cells                        | 39 : 1        | 8e-11 | 76          | + 149      |
| Moves: the same with the chance 0.25                        | 40 : 0        | 2e-12 | 68          | + 137      |

Slime on both arms, and the app without slime:

| Rule                               | Left : right   | p    | First touch |
| ---------------------------------- | -------------- | ---- | ----------- |
| The app, with slime and without it | 14 : 25        | 0.11 | 65          |
| Births: the three rules (10 seeds) | 3 : 6 to 6 : 4 |      | 67 to 68    |
| Moves: the chance 0.025            | 16 : 23        | 0.34 | 233         |
| Moves: the chance 0.25             | 23 : 17        | 0.43 | 203         |

What the numbers say:

1. **The app has no preference**, and painted slime changes no run, as ADR 0055 says.
2. **A colony crosses an arm of 4 cm in 65 steps**, which are 2.2 min of model time. The organism needs 1.3 to 4 h
   for it (`docs/fidelity.md`, row 6). Agents that walk carry the front of the model, at about 1 cell per step. The
   colony grows from 50 agents to about 330 in that time.
3. **No rule of the births reaches the first target.** The three rules give 65 to 70 % for the blank arm, and the
   target is 97.5 %. Even with no birth at all onto old slime, the food of the slimed arm is touched first in 3 of
   10 runs: agents walk onto the slime, their trail gives the cells a new stamp, and children follow.
4. **The inference of ADR 0055 was half right.** Behind a front every free neighbour of a parent has slime, and
   96 % of it is new. At the front, where 40 % of the children are born until the first touch, a third of the free
   neighbours has no slime. So the weight does act there. It does not decide the race, because of point 3.
5. **A sensor that reads slime as a repellent turns no agent**: at a front all three sensors lie on ground without
   trail and on the same slime.
6. **A rule for the moves reaches the targets 1 and 2 and misses target 3.** With slime on both arms the colony
   needs 233 steps to the first food, 3.6 times as long as without slime. The chance does not set this time (203
   steps with 0.25). The slime stops the agents that walk ahead, and the front then moves as fast as the trail of
   the dense colony renews the stamps ahead of it: about 0.3 cells per step.

Also tried, 10 seeds each: slime of the age 0 (a rule with an age does not see it), an age of 3,000 steps (the runs
of 300), and a colony without growth (its 50 agents scatter, with no preference).

## Why a rule of one agent does not reach all three targets here

The two arms are apart, with a wall between them. An agent, and a parent that picks a cell, read only the cells
close to them. So the colony enters a slimed arm in the same way with a blank arm beside it and with a slimed arm
beside it.

- Target 1 needs a late entry: the colony must reach the food of the slimed arm later than the food of the blank
  arm, by more than the two arms differ without slime. That is 23 steps in the median.
- Target 3 needs an entry that is not late, when both arms have slime.

The crossing of an arm takes 65 steps. So a delay that decides the choice is a large share of the whole time. In
the organism the crossing takes hours, and a delay of minutes at the slime would not show in its speed. Two things
are missing in the model, and a rule of one agent gives neither:

- **A front with the speed of the organism.** The front of the model is about 40 to 110 times too fast in this
  maze.
- **A competition between the parts of a front.** The plasmodium is one body, and its plasm goes to the part of
  the front that moves on. In the model a birth costs nothing, so the two arms do not compete. The flow cannot
  carry the signal in this maze either: the base has no food, so no site has a role before both foods are covered,
  and a tube adapts in 333 steps.

## Options

1. Build the weight in the pick of a birth, as the plan has it. It reaches 65 to 70 %.
2. Build the rule for the moves. It reaches the choice. The colony is 3.1 to 3.6 times slower on slime, where the
   organism is not slower. It also acts in every scene of the extended model, wherever an agent leaves the trail of
   its colony for ground that the colony left more than 300 steps before. Nobody measured those scenes with it.
3. Build no rule now. The avoidance goes to stage 4 of the plan, the front as a sink of the flow, with the Y-maze
   as a test of its prototype.

## Decision

1. **No rule reads the slime in stage 2 (option 3).** Reasons: the rule of the plan misses its target. The rule for
   the moves reaches the choice through a slower colony, which the organism does not show, and stage 4 would
   replace it. A rule that is known to be wrong in this way does not belong in the model.
2. **Stage 2 ends with the slime field of ADR 0055 and this measurement.** The slime shows in the picture and acts
   on nothing. The Slime tool paints slime that changes no run.
3. **The Y-maze stays research code.** It is no scene of the app: without a rule it shows two arms that fill alike.
4. **Stage 4 gets the three targets of this record**, and its prototype runs this Y-maze. From the measurement, its
   design must answer these points:
   - A colony without a covered food needs a source of plasm: the colony itself.
   - The parts of a front must compete for plasm. A birth, or a step onto new ground, must cost something.
   - Agents that walk ahead of the colony carry the front. A rule for the front must hold them, on blank ground
     too, or the speed of the front stays that of a single agent.
5. **The rule for the moves is not built without the owner's word.** The plan of 2026-11-16 left it to the owner.
   If the owner wants it before stage 4, it is a setting that is off in every scene and in every link of before,
   and its record measures the Tokyo scenes and the two mazes with it.

## Consequences

- `docs/fidelity.md`, row 23, has the numbers of the Y-maze, and row 6 the speed of the front in it.
- The research code of the Y-maze is in the repository: the layout with its unit test, the test of the runs, the
  script of the tables, and the rules as variants.
- A variant that reads the slime changes files below `src/` while its command runs, and puts them back: no growth
  pass binds the slime field.
- For a later rule in the growth passes: the pass `win` binds 8 storage buffers, the most that every WebGPU device
  has. A rule that reads the slime field there needs another way to reach the stamps.

## Open points

- **Not measured: a rule that holds an agent at old slime for some steps only.** It would delay the entry by a
  fixed time, not slow the whole way. By the argument above it still misses target 3 in this maze.
- **Not measured: the scenes of the app with the rule for the moves**, the U-shaped trap of Reid et al. 2012, and
  food scent that lifts the avoidance.
- **Why the sensor rule turns no agent** is read from the code of the variant, not measured.
- **The app with no slime gives 14 : 25 for the left and the right arm** (p 0.11). The layout is its own mirror
  image. Nobody followed this up.
- The rules ran on WebGPU only.
