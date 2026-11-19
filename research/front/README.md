# The growth front as a sink of the flow: a prototype on the CPU (stage 4)

This folder belongs to [ADR 0065](../../docs/adr/0065-the-growth-front-takes-the-flow-a-prototype.md) and to
[ADR 0067](../../docs/adr/0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md), the forms of a GPU (step 9). The first
part tells in plain words what the prototype found. The rest lists the commands.
[how-the-crown-forms.md](how-the-crown-forms.md) tells how the agents and the new rules make a crown, and which
behaviour of the organism each rule copies.

## The story in one page

**The question.** The organism grows a crown at the head of a tube: a sheet of plasm, wider than the tube, with
veins that fork toward the rim (the handover for stage 4 in `TODO.md`). In a Y-maze it takes the arm without slime
39 of 40 times (Reid et al. 2012). The app grows arms with blunt ends and chooses 19 : 20 (ADR 0056). Can a front
that takes flux give both, as stage 4 of the plan says?

**Step 1: a copy of the app.** `sim.ts` runs the rules of the scenes with growth and the flow on the CPU, for one
strain. With the rules of the app it crosses the Y-maze in 60 to 65 steps with about 300 agents and no preference,
as the app does (65 steps, ADR 0056).

**Step 2: why there is no crown.** Three causes, read in the runs. Agents walk ahead of the colony at one cell per
step and carry the front. Jones' rule gives births only where few agents are, so no dense sheet can grow. And an
agent follows the strongest trail, which lies in the tube behind it, so the plasm of a head flows back into the tube.

**Step 3: a sink alone does not reach the front.** A child is almost never born onto ground without slime: the trail
of the front puts slime on the ground before a child comes. So the front of the prototype is the rim of the colony
within 6 cells of ground without slime, where the trail ends (it falls by 0.57 per cell).

**Step 4: the plasm moves with the flow.** A sensor also reads minus a weight times the pressure of its strain (the
drift), so an agent turns down the pressure: the plasm streams from the food to the sinks. Then a sheet spreads at
the head of a tube, and veins run from the end of the tube to the rim. Without this drift the colony grows a tree of
tubes with small heads.

**Step 5: the front gets its own speed.** The colony now lives on a territory. An agent moves and is born only on
it. Each agent beside ground outside pushes that ground into the territory with the chance 0.004 per step. So the
front moves faster where more plasm lies at it (Kuroda et al. 2015: the speed grows with the thickness), and no
agent runs ahead. A fixed chance per cell did not work: both arms of the Y-maze then grew alike.

**Step 6: the Y-maze.** 40 runs per case. The slime lies on one arm, on both arms, on every open cell (slime
everywhere, as on the agar of Reid et al. 2012), or nowhere. The colony is its own source: it has no food. The rules
of steps 3 to 5 with the slime weight 0.025 of the owner, for the three forms of the drift (step 8), and the births
that the flux pays only at the fresh rim (`out/y4`):

| Case                             | Drift 0: a tree | Drift 1.5: a crown | Drift 5: a fan   | The organism     |
| -------------------------------- | --------------- | ------------------ | ---------------- | ---------------- |
| Slime on one arm: blank : slime  | 39 : 1          | 40 : 0             | 40 : 0           | 39 : 1           |
| Slime on both arms: left : right | 20 : 20         | 19 : 21            | 18 : 22          | no preference    |
| Slime everywhere: left : right   | 14 : 26         | 24 : 16            | 20 : 20          | –                |
| No slime: left : right           | 26 : 14         | 18 : 22            | 17 : 22, 1 split | no preference    |
| First food, no slime             | 3,625 steps     | 3,212 steps        | 3,230 steps      | 2,400 to 7,200   |
| First food, slime on both arms   | 1.92 times      | 1.27 times         | 1.24 times       | –                |
| First food, slime everywhere     | 2.23 times      | 1.48 times         | 1.32 times       | as fast as blank |

Each slower time lies outside the spread of the seeds (a Mann-Whitney test against no slime: p below 3·10⁻⁷).
Slime everywhere slows the colony more than slime on both arms, so the fresh base of the maze is not the cause, as
this page said before. The cause: the flux that a rim on slime takes pays no birth. Two changes follow. The births
go to every sink, in the share of the flux that it takes (`paidOn=sinks`, the owner's decision 7 of the ADR). And
every sink sits at the edge of the territory, where the colony grows, while ground without slime within 6 cells sets
only its weight (`sinkAt=edge`, decision 8). Before, a sink on fresh ground could sit 6 cells inside the edge, and a
sink on slime only 2. With both changes (`out/y6`; 120 seeds for slime on both arms, `out/both120`):

| Case                             | Drift 0: a tree | Drift 1.5: a crown | Drift 5: a fan   | The organism     |
| -------------------------------- | --------------- | ------------------ | ---------------- | ---------------- |
| Slime on one arm: blank : slime  | 31 : 9          | 40 : 0             | 40 : 0           | 39 : 1           |
| Slime on both arms: left : right | 19 : 21         | 60 : 59, 1 split   | 60 : 59, 1 split | no preference    |
| Slime everywhere: left : right   | 19 : 21         | 21 : 19            | 20 : 20          | –                |
| No slime: left : right           | 19 : 21         | 18 : 22            | 22 : 18          | no preference    |
| First food, no slime             | 3,768 steps     | 3,420 steps        | 3,275 steps      | 2,400 to 7,200   |
| First food, slime on both arms   | 1.15 times      | 1.07 times         | 1.08 times       | –                |
| First food, slime everywhere     | 1.01 (p 0.53)   | 0.98 (p 0.53)      | 1.01 (p 0.71)    | as fast as blank |

So the crown and the fan reach all three targets. The first 40 seeds with slime on both arms gave 28 : 12 at drift
5, and 80 more seeds gave 32 : 47: chance. With slime on both arms the fresh base of the maze takes the flux first,
and the colony is 1.07 to 1.15 times slower (p below 0.003); the paper gives no time for this case. The tree takes the
blank arm 31 of 40 times (the organism 39 of 40; Fisher's test: p 0.014; with the old place of the sinks 33 of 40).
The owner decided on 2026-11-19 that the births follow every sink: a colony in a dish full of slime must still give
birth, else a strain dies in time despite enough food, and a second strain cannot multiply. Before the owner's
decision on the weight, slime was no sink: drift 5 then gave 40 : 0, and 1.87 times on both arms (23 runs,
`out/y3`).

**Step 7: a dish full of slime.** The owner asked whether a colony keeps its births in a dish full of slime
(2026-11-19). A dish of 160 cells (8.6 cm) with one food in the middle, slime on every cell or none, 20,000 steps
(11 h), 10 seeds per case, the rules of step 6 (`dish.ts`, `out/dish2`):

| Case                                     | Drift 0: a tree     | Drift 1.5: a crown  | Drift 5: a fan      |
| ---------------------------------------- | ------------------- | ------------------- | ------------------- |
| Half of the dish covered, no slime       | 40 % at step 20,000 | after 4,985 steps   | after 4,289 steps   |
| The same, slime everywhere               | 40 % (p 0.41)       | 1.04 times (p 0.71) | 0.96 times (p 0.17) |
| Agents at step 20,000, slime everywhere  | 1,132 (least 885)   | 855 (least 587)     | 1,037 (least 795)   |
| Births of the last 5,000 steps, on slime | 7,547               | 14,954              | 23,144              |

No colony dies. When the dish is full, the number of agents stays, and Jones' births go on; the flux pays no birth
then, because no sink has room. With the births only at the fresh rim the crown covers half of the dish 1.18 times
later on slime (p 0.034, `out/dish1`), and it lives too, because Jones' births do not read the slime. The tree is slow
in an open dish: it covers 40 % of it in 20,000 steps.

**Step 8: the crown.** Pictures show a crown at the head of a tube (drift 1.25) and a fan that migrates (drift 5).
Measured on runs of a lane and a dish: the veins lie along the flow (the mean |cos| of the angle is 0.89 to 0.99),
and a cell becomes a vein (D ≥ 0.5) a median of 400 to 1,900 steps after the front reached it (the organism: about
1,500, Schenz 2019). The front runs 0.015 to 0.03 cells per step: 1.5 to 3 cm/h (the organism: 1 to 3 cm/h).

**Step 9: the forms of a GPU** ([ADR 0067](../../docs/adr/0067-the-rules-of-stage-4-in-the-forms-of-a-gpu.md)).
Three parts of the rule set had no form that a GPU runs: the paid births go in one order over all agents of the front,
the distance to ground without slime comes from two passes that run in sequence over the grid, and the shares need
sums over all cells. Each now has a form of a GPU, as an option of `sim.ts`:

- `paidBy=rank`: the order of step 6 itself. In a growth step each agent of the front that could claim a child (at the
  rim, with a free cell of the territory beside it) draws its own key −ln(1 − u) / r, r its sink rate, and the whole
  part of the budget B of them with the least keys claim a child. A GPU writes the keys in one pass over the agents;
  in the next, each of these agents counts the agents of its strain with a smaller key and stops at the whole part of
  B. As with the order, a budget below 1 pays nothing, and the budget never exceeds the number of agents of the front.
- `fresh=box`: a sink looks at the 13 × 13 cells around it for ground without slime. That gives the same answer as the
  chamfer transform on every cell, so the same runs. The engine follows paths over open cells within the square, so
  that no test of a sink sees through a wall (ADR 0067, decision 10). In the Y-maze and the dish a path reaches every
  open cell of each square, so the paths give these runs too.
- `sums=fixed`: each sink rate counts in steps of 2^-16 as an integer, so every order of the additions gives the same
  sum, and each sink takes its share with the rate that the sum counted, so the sinks take exactly what the sources
  give. The engine keeps the sum R in two words of 32 bits, so that many sinks do not overflow it.

The births took six tries (NOTES.md, notes 20 to 23, 27 to 29). Marks per cell, drawn after the step before a growth
step, would fit the passes of a GPU best, but they lose births where few agents can claim one. With P the sum over all
tube cells the budget climbed to its cap, and the paid births fell by a third. With the marks on the cells whose agent
could claim a child at the end of the step before (`paidBy=ahead`), the Y-maze kept every choice, but in the open dish
the tree ended with 0.74 to 0.78 times the territory (p 0.028 and 0.00088): at drift 0 fewer than one agent per growth
step can claim a child, and it walks on before the growth step. A chance per agent in the growth step draws where the
agents are. As min(1, B · r / P), the first candidate of the coordinator (`paidBy=chance`), it spent less than the order
where few agents can claim a child and one of them has most of the sink rate: its chance stops at 1, and the others
keep theirs. The tree then reached the food 1.13 times later with slime on both arms (p 0.00032), and ended in the open
dish with 0.69 times the territory (p 0.0025). With chances that add up to the budget (`paidBy=fill`) the Y-maze and the
crown and the fan in the dish keep every result, but the tree in an open dish with slime everywhere ends with 0.83 times
the territory (p 0.0075, 40 seeds), 30 % of the dish against 37 % without slime (p 0.0097). The order spreads its
births more widely over the agents that could claim one. The rank gives the births of the order.

The integer sums took two tries (note 26). When each sink took its share with its own rate, the sinks missed what the
sources give by the rounding of the sum, up to 8 · 10⁻⁵ of the flux with slime everywhere, where every rate is 40
times smaller; the crown in the Y-maze with slime everywhere then took 1.10 times as long (p 0.0040, even with the
order). With the counted rates the sinks miss by 10⁻⁹, as in floats.

The territory of the start stays the disc of the start and a rim of 3 cells. A square of 7 × 7 cells around each start
agent (`start=agents`) keeps every agent 4 cells from the edge of the territory, and a sink lies within 2 cells of the
edge: the tree in the open dish then got a quarter of its paid births in the first 500 steps (note 24).

With the three forms (`out/y11`, `out/dish7`, `out/both120gpu-rank`, `out/more-rank`) against the rule set of step 6
(`out/y6`, `out/dish2`, `out/both120`, `out/more/rules`, `out/more2/rules`): 40 seeds per case of the Y-maze and 120 at
the drift 1.5 and 5 with slime on both arms, everywhere and none; 10 seeds per case of the dish, 40 for the tree with
slime everywhere and 20 without. The rule set of step 6 is in brackets:

| Case                             | Drift 0: a tree     | Drift 1.5: a crown         | Drift 5: a fan                      | The organism     |
| -------------------------------- | ------------------- | -------------------------- | ----------------------------------- | ---------------- |
| Slime on one arm: blank : slime  | 36 : 4 (31 : 9)     | 40 : 0 (40 : 0)            | 40 : 0 (40 : 0)                     | 39 : 1           |
| Slime on both arms: left : right | 17 : 23 (19 : 21)   | 65 : 55 (60 : 59, 1 split) | 50 : 69, 1 split (60 : 59, 1 split) | no preference    |
| Slime everywhere: left : right   | 17 : 23 (19 : 21)   | 56 : 64 (60 : 60)          | 64 : 56 (57 : 63)                   | –                |
| No slime: left : right           | 18 : 22 (19 : 21)   | 53 : 66, 1 split (52 : 68) | 57 : 63 (58 : 62)                   | no preference    |
| First food, no slime             | 3,832 steps (3,768) | 3,504 steps (3,516)        | 3,392 steps (3,346)                 | 2,400 to 7,200   |
| First food, slime on both arms   | 1.19 times (1.15)   | 1.05 times (1.04)          | 1.06 times (1.06)                   | –                |
| First food, slime everywhere     | 1.01, p 0.61 (1.01) | 1.02, p 0.11 (1.00)        | 1.01, p 0.37 (1.03)                 | as fast as blank |

Against the rule set no choice and no time leaves the spread of the seeds: Fisher's test gives p 0.22 to 1.0, and the
first food comes 0.98 to 1.05 times as late (Mann-Whitney p 0.18 to 0.99). The dish:

| Case                                    | Drift 0: a tree           | Drift 1.5: a crown        | Drift 5: a fan            |
| --------------------------------------- | ------------------------- | ------------------------- | ------------------------- |
| Territory at step 20,000, no slime      | 33 % (40 %; p 0.079)      | the whole dish            | the whole dish            |
| The same, slime everywhere              | 32 % (36 %; p 0.29)       | the whole dish            | the whole dish            |
| Half of the dish covered, no slime      | –                         | after 5,139 steps (4,985) | after 4,160 steps (4,289) |
| The same, slime everywhere              | 0.96 times (0.91; p 0.57) | 1.03 times (1.04; p 0.26) | 1.04 times (0.96; p 0.13) |
| Agents at step 20,000, slime everywhere | 1,133 (1,118)             | 793 (855)                 | 912 (1,037)               |

For the tree "the same, slime everywhere" is its territory against the one without slime. The half of the dish comes
as early as with the rule set (p 0.082 to 0.94), and no colony dies. The tree covers a third of the open dish in 20,000
steps, with the rule set 36 to 40 %; its spread is wide: one campaign of the rule set gave 4,906 to 8,435 cells.

**What is not reached.**

- The tree takes the blank arm only 31 of 40 times (Fisher's test against the organism: p 0.014), and it covers only
  40 % of an open dish in 20,000 steps.
- In an open dish the front is an octagon and the veins prefer the axes of the grid: the square cells show, as de
  Almeida 2021 found on regular lattices.
- Murray's exponent is not measured: the skeleton of the veins gives 0 to 2 junctions per picture.
- The numbers 0.004, 5, 6 cells, 2 times the flow strength and 20 per birth are choices made on these runs.

## The rules of the prototype

`front` of `sim.ts`, all off by default. The rule set of step 6 is
`speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app`
with `drift=0`, `1.5` or `5`. `paidOn=fresh` is the rule before the owner's decision 7, and `sinkAt=fresh` the place
of the sinks before decision 8:

- `speed`, `speedOn=push`: the territory and its push (step 5).
- `reach`, `rim`, `sinkAt`, `slimeWeight`: the sinks are the agents at the edge of the territory with a free cell of it
  beside them (`sinkAt=edge`), with the weight 1 within `reach` cells of ground without slime and `slimeWeight`
  elsewhere. With `sinkAt=fresh` a sink on fresh ground sits anywhere within `reach` of ground without slime.
- `norm`: all sinks of the strain take `norm` times the flow strength, shared by an exponential mean over `tau`
  (100) steps. `colony`: without a covered food every tube cell gives an equal share; else the ports of the
  covered sites give it.
- `paid`: every `paid` of flux that the front takes is one birth at an agent of the front. `paidOn`: the births go
  to the agents of the rim on fresh ground (`fresh`), or to the agents of the rim at every sink, with odds in the
  share of the flux that it takes (`sinks`).
- `drift`: a sensor reads minus this weight times the pressure.
- `solver`: the app's 16 iterations, or `exact` (conjugate gradients), for a check. Both give the Y-maze result.
- The forms of a GPU of step 9 (ADR 0067), each with its old word as the default: `paidBy=rank` (else `order`),
  `fresh=box` (else `chamfer`) and `sums=fixed` (else `float`); `GPU_FORMS` of `sim.ts` holds the three. Four tries
  that lost results stay as words: `paidBy=chance`, `paidBy=fill`, `paidBy=ahead` and `start=agents` (else `disc`).

## Commands

From the root of the repository. Pictures and records go to `research/front/out/`, which git ignores.

- The Y-maze, one case and a range of seeds: `node --import ./research/flow/register.mjs research/front/ymaze.ts
case=one seeds=1-40 speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 solver=app drift=5
slimeWeight=0.025 paidOn=sinks name=y5/d5-one` (cases `one`, `both`, `none` and `all`, slime on every open cell; 10 to
  25 s per run). An unknown key or a number that does not parse stops the run.
- The table: `node --import ./research/flow/register.mjs research/front/tables.ts research/front/out/y5`. A case with
  slime also shows its time against the case without slime of the same name, with a Mann-Whitney test.
- A whole campaign, the Y-maze and the dish for the three forms of the drift (78 jobs on 11 cores, about 25 minutes):
  `bash research/front/campaign.sh y11 dish7 "paidBy=rank fresh=box sums=fixed"` (step 9); without the third argument
  it runs the rule set of step 6. Seeds 41 to 120 with slime on both arms:
  `bash research/front/both120.sh both120gpu-rank "paidBy=rank fresh=box sums=fixed"`. More seeds of the tree in the
  dish and of the Y-maze with slime everywhere and without: `bash research/front/more.sh more-rank "paidBy=rank
fresh=box sums=fixed" forms` (without `forms` it also runs the rule set). Some forms in the four cases that left the
  spread: `bash research/front/split.sh split fixed="sums=fixed"`. The earlier records came from
  `paidBy=ahead fresh=box sums=fixed start=agents` (`out/y7`, `out/dish3`; the records name it `paidBy=chance`),
  `paidBy=chance fresh=box sums=fixed` (`out/y8`, `out/dish4`) and `paidBy=fill fresh=box sums=fixed` (`out/y9`,
  `out/dish5` with the first integer sums of NOTES.md, note 26; `out/y10`, `out/dish6`, `out/both120gpu-final`,
  `out/more/forms` and `out/more2/forms` with the balanced ones).
- Two campaigns case by case: `research/front/compare.ts research/front/out/y11 research/front/out/y6
research/front/out/dish7 research/front/out/dish2` (Fisher's test for the choice, Mann-Whitney for the times; `-` in
  place of the first two folders compares the dish alone).
- The grids that the buffers of ADR 0067 would change: `research/front/fit.ts`.
- Pictures and measures of a dish or a lane: `research/front/shots.ts scene=dish side=200 pics=3000,5000 ...` with
  the same rules; `research/front/ypics.ts slimed=left pics=1500,3300 ...` for the Y-maze.
- The test of the prototype: `npx vitest run --project unit research/front/research.test.ts`.
- `NOTES.md` is the working record of every variant on the way.
