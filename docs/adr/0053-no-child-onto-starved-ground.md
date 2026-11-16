# 0053: No child is born onto starved ground

- Status: accepted (the owner agreed to the rule with the plan of 2026-11-16,
  [ADR 0052](0052-the-sources-on-slime-mazes-and-the-growth-front.md); the details are decisions of the coordinator of
  the same day, under the owner's delegation of 2026-11-12), built 2026-11-16
- Date: 2026-11-16
- Extends [ADR 0029](0029-flow-in-the-tubes.md) (decision 9: an agent does not divide on a starved cell) and
  [ADR 0025](0025-growth-and-shrinkage.md) (the growth rule). It is stage 1 of the plan of ADR 0052, and it answers the
  first open point of [ADR 0051](0051-the-scenes-snail-maze-and-corn-maze.md).
- In short: [`research/flow/README.md`](../../research/flow/README.md), part 17, has the commands and the records.

## Context

ADR 0051 found that a colony with growth and the flow comes back into the blind branches of a maze. Over the last
10,000 steps of a run, a blind branch of the Snail maze holds 11 to 36 % of the trail of the route. ADR 0051 did not
study why.

The plan of 2026-11-16 (ADR 0052, `TODO.md`) names a cause that was read in the code and not measured:

- The rule "an agent does not divide on a cell with D < 0.01" (ADR 0029, decision 9) reads the cell of the parent
  (`divideInto()` in `growth.wgsl`). So a parent on a fed tube places a child onto starved ground beside the tube.
- The rule Light stops growth reads the cell of the child (ADR 0050, decision 2).

Stage 1 of the plan: the rule of starved ground reads the cell of the child, and a measurement says whether the dead
ends of the Snail maze and of the Corn maze then empty.

**Words.** D is the flow memory of a cell. A cell is **starved** while D < 0.01 (`FLOW.half`). **Closed ground** is
starved ground without a tube. **Fresh ground** never held a tube: D = 0.2. The **floor** of the flow memory is its
least value, 0.0001.

## Options

1. The cell of the parent alone decides, as before.
2. The cell of the child alone decides, as with light.
3. Both cells decide. A starved neighbour is not free, and the parent picks among its other free neighbours.
4. Both cells decide, and a parent whose pick is starved does not divide in that step, as with light. Not measured.

## Decision

Option 3. The owner agreed to a rule that reads the cell of the child on 2026-11-16. The details are the coordinator's
choices:

1. **The rule.** With the flow on, a neighbour with D_s < 0.01 is not free: no child is born onto it. D_s is the flow
   memory of the strain of the parent, from the last step. `docs/model.md`, section 9, has the exact rule.
2. **Both cells decide.** Decision 9 of ADR 0029 stays: an agent on a starved cell does not divide. Reason: the flow
   supplies no plasm there, and option 2 measured no better (the table of the other rules below): the blind branches
   held as much trail, and the tube of the Snail maze was broken in a tenth of the last dumps of one seed of three.
3. **A starved neighbour is left out of the pick.** Reason: the level 0.01 is a threshold and no chance, so the rule
   needs no draw of its own, and the parent keeps its one draw. Starved ground then acts as an occupied cell does.
   Stage 2 of the plan weights the free neighbours in this same pick.
4. **No setting, and no field of a link.** Reason: the rule has no strength. A link of a scene with growth and the
   flow that was made before this rule runs with the rule. Its cells differ from before; the measures of the scenes
   below do not, within the spread of the seeds.
5. **Only with the flow.** Without the flow no cell is starved, and the source of the passes is that of before,
   character for character (`variant.test.ts`). The Jones model never runs the flow.
6. **The CPU copy gets the flow memory.** `growthStep()` of `growth-reference.ts` takes the flow memory of each strain,
   and the GPU test compares one growth step of both backends with it.

## Results

All runs: an M3 Pro, Chromium with Metal, 2026-11-16, on the branch of this record: the engine of `main` at `fc65ee3`
with the rule. "Before" is `main`. The records are `logs/engine/starved-ground/` in the archive of `research/flow/`.

### Where a child is born

`births.gpu.test.ts` steps the Snail maze one step at a time and counts each child by the flow memory of its cell
before the step. Seeds 1 to 3 on WebGPU, windows of 300 steps from the steps 12,000, 20,000 and 28,000. The numbers
are for the dead ends (26,506 cells), per 1,000 steps: the least and the most of the nine windows.

| In the dead ends of the Snail maze                         | Before         | With the rule |
| ---------------------------------------------------------- | -------------- | ------------- |
| Children onto starved cells                                | 760 to 1,930   | 0             |
| Children onto cells with D from 0.01 on                    | 987 to 4,653   | 917 to 5,670  |
| Deaths                                                     | 1,487 to 6,143 | 740 to 5,547  |
| Closed ground, share of the cells                          | 49 to 78 %     | 63 to 76 %    |
| Ground without a tube with D from 0.01 to below 0.2, share | 16 to 27 %     | 14 to 24 %    |
| Fresh ground, share                                        | at most 5.8 %  | at most 1.9 % |

- **What the plan read in the code is true, and it is a third of the births.** Before the rule, 34 % of the children of
  the dead ends were born onto starved cells (26 to 52 % per window). The rule stops them all.
- **Two thirds of the children are born onto ground that is open**: ground without a tube whose flow memory is 0.01 or
  more. The rule does not touch them. They keep the colony of a dead end alive: births and deaths are about equal.

### The two mazes: the dead ends do not empty

The campaign of ADR 0051 again: seeds 1 to 10 on WebGPU to step 30,000, a dump every 500 steps, the same measures
(`measure-mazes.ts`). "Before" is the record of ADR 0051. The tail is the 20 dumps of the last 10,000 steps.

| Snail maze                                              | Before                 | With the rule           |
| ------------------------------------------------------- | ---------------------- | ----------------------- |
| The colony joins both foods at step, median (range)     | 9,000 (7,500 to 9,500) | 9,250 (7,500 to 11,000) |
| The tube joins the foods in the tail                    | 200 of 200 dumps       | 200 of 200 dumps        |
| Tube over the route                                     | 1.00 to 1.01           | 1.00 to 1.01            |
| Tube cells on the route                                 | 0.84 to 0.88           | 0.86 to 0.89            |
| Trail of a blind branch over the route's, mean of 60    | 0.174                  | 0.176                   |
| The same, least and most                                | 0.04 to 0.36           | 0.09 to 0.25            |
| Blind branches below 0.10                               | 3 of 60                | 2 of 60                 |
| Dumps with every blind branch below 0.10                | 6 of 200               | 6 of 200                |
| A blind branch holds 0.10 or more, share of the dumps   | 0.43                   | 0.44                    |
| A blind branch fills, times in 10,000 steps             | 2.25                   | 2.43                    |
| Flow memory of a blind branch over the route's, at most | 0.018                  | 0.018                   |

| Corn maze                                                  | Before                 | With the rule          |
| ---------------------------------------------------------- | ---------------------- | ---------------------- |
| The colony joins both foods at step, median (range)        | 3,500 (3,000 to 4,500) | 3,500 (3,000 to 4,500) |
| Only the shortest route carries flow, steps after the join | 500 to 2,500           | 500 to 2,500           |
| Another route carries flow from end to end                 | 0 of 600 dumps         | 0 of 600 dumps         |
| Tube over the shortest route                               | 1.00 to 1.02           | 1.01 to 1.03           |
| Tail dumps with a tube on the route of 28 rooms            | 30 of 200              | 31 of 200              |
| on the route of 30 rooms                                   | 36 of 200              | 28 of 200              |
| on a route of 34, 36 or 40 rooms                           | 4 of 200               | 4 of 200               |
| Tail dumps in which only the shortest route holds a tube   | 137 of 200             | 142 of 200             |
| Doors that a tube crosses at step 30,000, of 102           | 33 to 74               | 35 to 68               |

- **The rule changes no measure of the two mazes** by more than the seeds differ. The blind branches of the Snail
  maze hold 9 to 25 % of the trail of the route. The mean of a seed is 0.176 ± 0.015 with the rule and 0.174 ± 0.024
  before (mean and deviation of the 10 seeds).
- **The colony comes back in waves.** A blind branch fills, up to the trail of the route and above it (the highest
  value of a dump is 1.5), and it starves again. This happens 2.4 times in 10,000 steps per branch, and a branch
  holds 10 % or more in 44 % of the dumps. A mean over the tail hides this.
- **WebGL2**, seeds 1 and 2: the Snail maze joins its foods at the steps 7,500 and 9,500, its tube is 1.01 times the
  route, and its blind branches hold 11 to 26 % (13 to 26 % before). In the Corn maze the shortest route alone
  carries the flow from the steps 5,000 and 5,500, as before, and it alone holds a tube in 31 of 40 dumps (29).

### The Tokyo scenes

The Tokyo rail network, seeds 1 to 10 on WebGPU to step 48,000, measured as in ADR 0029. "Before" is the record of its
amendment 2026-11-14 (2). The samples are those of the steps 16,000, 24,000, 32,000, 40,000 and 48,000.

| Tokyo rail network                              | Before                  | With the rule           |
| ----------------------------------------------- | ----------------------- | ----------------------- |
| TL at step 48,000                               | 1.89 ± 0.13             | 1.77 ± 0.07             |
| MD at step 48,000                               | 0.84 ± 0.05             | 0.82 ± 0.02             |
| FT at step 48,000                               | 0.91 ± 0.04             | 0.89 ± 0.03             |
| TL, MD and FT over the 50 samples               | 1.84 ± 0.13, 0.83, 0.91 | 1.84 ± 0.13, 0.82, 0.91 |
| Links and agents over the 50 samples            | 53.9 and 4,010          | 54.7 and 4,027          |
| All 36 foods joined, samples from step 4,000 on | 78 of 80                | 77 of 80                |
| All 33 foods of Fig. 2 joined, the same samples | 80 of 80                | 80 of 80                |
| Closed ground, of 70,868 cells of land          | 22,339                  | 22,289                  |

- **The rule moves no measure of the Tokyo scene by more than the seeds differ.** TL at step 48,000 is 0.12 lower, and
  over the 50 samples it is the same. The organism: TL 1.75 ± 0.30, MD 0.85 ± 0.04, FT 0.80 or 0.86.
- **WebGL2**, seeds 1 to 3 at step 24,000: TL 1.87, 1.59 and 1.89, MD 0.81, 0.83 and 0.89, FT 0.93, 0.83 and 0.91
  (before: TL 1.93, 2.04 and 1.77, MD 0.83, 0.83 and 0.91).
- **Tokyo with light**, seeds 1 to 3 on WebGPU, on the map of the scene (51 lit cells): at step 48,000 TL 1.75 ± 0.11,
  MD 0.83 ± 0.01 and FT 0.86 ± 0.01; all 36 foods are joined in 23 of 24 samples from step 4,000 on; the network holds
  2.8 to 3.1 % of its cells on lit ground at step 2,000, and 0.5 to 1.1 % from step 16,000 on. ADR 0050 had one seed
  on this map: TL 1.68, MD 0.87, FT 0.85, and 2.4 % and 0.8 to 1.4 % on lit ground.
- **The scenes of ADR 0032**, seed 1 on WebGPU as their record: Food ring covers 9 of 9 food sites from step 2,001
  on, as before. In Rival networks each of the two strains covers all 10 foods from step 2,002 on (before: from step
  4,002 on), with 3,225 and 3,135 agents at step 12,002 (3,749 and 2,994). On the Tokyo map each of two strains covers
  39 to 42 of the 42 food sites from step 2,002 on (before: 40 to 42).
- **The regrowth of ADR 0029** (amendment 2026-11-15 (2): the foods of four cities are away from step 24,000 to step
  27,000; seeds 1 to 3): with the rule all 33 foods are joined again at step 27,300 (27,300 to 28,000, median and
  range of the first measured step). Before: 27,600 (27,300 to 28,000).

### The scenes that change their bytes

- **Seven scenes run growth and the flow**: Snail maze, Corn maze, Tokyo rail network, Tokyo with light, Food ring,
  Rival networks and Tokyo, two networks. Only these can change: without the flow the source of the passes is that of
  before, and without growth the passes do not run.
- **After 500 steps every scene has the bytes of `main`.** The digests of all 27 runs on each backend, with the state
  of the flow, are equal: 54 of 54. Reason: no cell is starved that early. A tube needs 998 steps from the memory of
  fresh ground to 0.01, and it starts to fall only when the colony covers two foods.
- **After 3,000 steps five of the seven scenes differ from `main`, on both backends**: Tokyo rail network, Tokyo with
  light, Tokyo, two networks, Food ring and Rival networks. The two mazes still have the bytes of `main` then: their
  colony does not cover its second food that early. Their runs give the lines of the record of ADR 0051 up to the
  steps 5,500 to 7,000 (Snail maze) and 3,500 to 5,000 (Corn maze), and they differ from the next dump on.

### Why the dead ends do not empty

The cause is the mark of starved ground, and not the cell that a child is born onto.

- **A cell is closed for births while D < 0.01.** D falls only while the cell holds a tube, by 0.3 % per step. A
  starved tube loses its agents at 1 to 2 % per step, so its tube body is gone soon. From then on D grows again, by
  0.023 % per step. So a cell does not fall to the floor. It stops at a D of its own.
- **Measured** (`births.ts`, the numbers `opens`, both rules alike): of the ground of the dead ends that is closed
  at the end of a window, a quarter is open again within 2,500 to 4,300 steps, half within 6,100 to 8,500, and three
  quarters within 11,500 to 13,300. From the floor every cell would take 20,025 steps.
- **So about a fifth of the ground of a dead end is open at any time** (14 to 27 %, the table of the births). The
  growth rule fills open ground at once: an agent in a thin part of the colony divides every 3 steps, and starvation
  takes at most 2 % of the agents per step (ADR 0029, decision 9).
- **The colony comes back as a wave.** It grows over the open ground of a blind branch. Its tubes there carry no flux,
  so their memory falls below 0.01 within some hundred steps, and they starve. The wave leaves the ground closed for
  some thousand steps, and then the next one comes.
- **The variant `floor` below tests this cause**: when every cell that a starved tube left holds the same mark, the
  floor, the blind branches stay empty.

The 18 h of ADR 0029 (decisions 7 and 19) are the time from the floor to fresh ground. They are not the time for which
starved ground is closed for births. ADR 0051 and `docs/fidelity.md` read them so; `docs/model.md`, 8.4 and 8.6, now
has both times.

### Other rules, measured for stage 2 of the plan

`research/flow/engine/variant.ts` puts another rule into the WGSL passes for one run; no variant is a rule of the app.
The Snail maze, seeds 1 to 3 on WebGPU, the last 10,000 of 30,000 steps. "Blind" is the mean trail of the 18 blind
branches over the route's, with the least and the most.

| Rule                                                                 | Blind               | Below 0.10 | Tube joined |
| -------------------------------------------------------------------- | ------------------- | ---------- | ----------- |
| `parent`: before this record                                         | 0.164, 0.04 to 0.26 | 1 of 18    | 60 of 60    |
| This record                                                          | 0.162, 0.09 to 0.21 | 1 of 18    | 60 of 60    |
| `child`: the cell of the child alone (option 2)                      | 0.179, 0.15 to 0.26 | 0 of 18    | 58 of 60    |
| `left`: also no child onto ground that a starved tube left           | 0.185, 0.09 to 0.28 | 1 of 18    | 59 of 60    |
| `weight`: such ground has the weight 0.025 in the pick               | 0.187, 0.05 to 0.28 | 1 of 18    | 60 of 60    |
| `floor`: a starved tube that vanishes leaves its ground at the floor | 0.012, 0.00 to 0.08 | 18 of 18   | 59 of 60    |
| `left+floor`                                                         | 0.018, 0.00 to 0.06 | 18 of 18   | 60 of 60    |
| `parent+floor`: `floor` with the births of before this record        | 0.024, 0.00 to 0.10 | 17 of 18   | 60 of 60    |

"Ground that a starved tube left" is a cell without a tube body and with D below 0.2. The three runs of `parent` give
the lines of the record of ADR 0051.

- **`floor` keeps the blind branches empty.** 96 to 97 % of the tube cells then lie on the route (86 to 89 % with the
  rule of this record). In the Corn maze (seeds 1 to 3) 87 to 88 % of the tube cells lie on the shortest route (60 to
  74 %), and the trail of the route is 660 to 718 times that of the dead ends (6.5 to 247); a side route of two or
  three rooms still holds a tube in a part of the dumps.
- **`floor` is not built in this pull request.** It changes the rule of the flow memory (ADR 0029, decision 7), and
  the plan says that the rule of the tubes stays. The owner decided on 2026-11-16, with these results, that the cause
  gets more analysis and a fix in a pull request of its own. `floor` has a price on the Tokyo map (seeds 1 to 3):
  over the samples from step 16,000 on, TL 1.66 ± 0.11 against 1.86 ± 0.14 with the rule of this record on the same
  seeds, 50.0 links against 55.5, and 3,655 agents against 4,088; MD and FT stay (0.83 and 0.89 against 0.82 and
  0.90). One sample of 24 has one of the 33 foods of Fig. 2 without a tube (none of 24). In the Snail maze the tube of
  the route is broken in 1 of the 60 dumps (none of 60).
- **`floor` does not keep the colony away from foods that come back.** In the regrowth test of ADR 0029 (above) all
  33 foods are joined again at step 27,300 (27,300 to 29,000) with `floor`, against 27,300 (27,300 to 28,000) with
  the rule of this record. From step 30,000 on the disc around the four cities then holds 0.64 to 0.81 of the cells
  of the network that it held at step 24,000 (0.96 to 1.32 with the rule; medians of the three seeds).
- **`weight` is the rule that the plan has for the slime of stage 2**, with the mark of starved ground in the place of
  the slime: a marked neighbour has the weight 0.025 in the pick, the pick is as before when every free neighbour has
  the mark, and a cell with a tube body has no mark. It changes nothing. Reason: in a blind branch that the colony
  left, every free neighbour has the mark, and then the weight does nothing, by the plan itself.
- **`left` is a wall in place of the weight, and it changes nothing either.** Reason, read from the rules and from this
  result, and not measured apart: a move does not read the mark, so agents walk onto the ground; their trail gives
  cells a tube body, and `left` leaves a cell with a tube body out.
- **`child` is worse than both cells**: the tube of the route is broken in 2 of the 20 last dumps of seed 3.
- **`parent+floor` is nearly as empty as `floor`.** So the rule of this record adds little to `floor`.

### Tests and wrong rules

- `flow.gpu.test.ts`, "lets no child be born onto starved ground, as the CPU copy of the growth passes does", on both
  backends, in a box and on the periodic grid: one growth step of two strains against `growthStep()`. The ground of
  each strain is a pattern of its own of blocks of 3 × 3 cells with four memories: the floor, just below 0.01, just
  above it, and fresh ground. Of 444 agents, 175 to 177 get a child. The copy that reads the cell of the parent alone
  puts 49 to 52 children onto starved cells, and the copy that reads the cell of the child alone has 277 to 289
  children.
- `growth-reference.test.ts`: five unit tests of the CPU copy with one parent.
- `research/flow/engine/mutate.ts` has ten new wrong rules, SG1 to SG10: a child onto starved ground, the cell of the
  parent in place of the cell of the child, the flow memory of the first strain, a starved neighbour that stops the
  birth, and the neighbour before the wrap of the grid, each in WGSL and in GLSL. Each fails the new test. The check
  of `mutate.ts` says that 288 of 288 wrong rules fit their files.
- The wrong rules G1 and F8, an agent divides on a starved cell, now fail the new test only. The test of ADR 0029,
  "lets no agent divide on a cell that the flux passed by", starves a whole half of the grid: there no child has a
  cell with either half of the rule. The new test has parents on starved cells beside fed cells.

## Consequences

- No child is born onto starved ground. The births that the rule stops had no effect on any measure: such a child
  starved within about 50 to 100 steps.
- **The first aim of the plan is not reached by this rule.** The colony grows back into a dead end that it left, as
  before. This record names the cause, the mark of starved ground, and one rule that removes it, `floor`. The owner
  decided on 2026-11-16 that the cause gets more analysis and a fix of its own: stage 1b in `TODO.md`, which also has
  what follows for stages 2 to 4.
- Seven scenes change their bytes from about step 1,000 on. Their measures stay within the spread of the seeds.
- `docs/model.md` has the rule (8.5, 9, 13) and the two times of the mark (8.4, 8.6). `docs/fidelity.md` has the new
  numbers in its rows 1, 2 and 5, and the cause in its rows 2, 16 and 23.
- The next stages get three tools: `growthStep()` with the flow memory, `variant.ts` for a run with another rule, and
  `births.gpu.test.ts` with `births.ts` for where children are born.
- **Also in this pull request**: the texts of the app said that the slime mold found the shortest way through the maze
  of 2000. By Fig. 1d of the paper that holds for 5 of 19 runs (ADR 0052, open points). Four texts say it now as the
  figure has it: `src/ui/Learn.svelte`, and in `src/model/presets.ts` the scenes Maze and Corn maze and the text of
  the source. The coordinator read the table of Fig. 1d again in a browser on 2026-11-16.

## Open points

- `floor` ran with 3 seeds per scene, on WebGPU, to step 30,000 in the mazes. Its ground opens again 20,025 steps
  after it closed, so only a longer run shows the next wave. Its effect on the Maze, which has no growth, is not
  measured.
- Option 4, a parent whose pick is starved does not divide, is not measured.
- The cost of a step is not measured. The rule adds up to 8 reads of the flow memory for a parent that divides.
- Whether a wave needs births at all, or whether agents that walk in suffice, is not measured apart (`left` above).
- Tokyo with light ran with 3 seeds, and the scenes of ADR 0032 with seed 1.
