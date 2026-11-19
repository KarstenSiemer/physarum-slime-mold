# The growth front as a sink of the flow: a prototype on the CPU (stage 4)

This folder belongs to [ADR 0065](../../docs/adr/0065-the-growth-front-takes-the-flow-a-prototype.md). The first part
tells in plain words what the prototype found. The rest lists the commands.

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

**Step 4: the plasm moves with the flow.** A sensor also reads minus 5 times the pressure of its strain, so an agent
turns down the pressure: the plasm streams from the food to the sinks. Then a sheet spreads at the head of a tube,
and veins run from the end of the tube to the rim. Without this drift the colony grows a tree of tubes with small
heads.

**Step 5: the front gets its own speed.** The colony now lives on a territory. An agent moves and is born only on
it. Each agent beside ground outside pushes that ground into the territory with the chance 0.004 per step. So the
front moves faster where more plasm lies at it (Kuroda et al. 2015: the speed grows with the thickness), and no
agent runs ahead. A fixed chance per cell did not work: both arms of the Y-maze then grew alike.

**Step 6: the Y-maze.** 40 runs with slime on one arm, 23 with slime on both arms and 23 without slime. The rules
of steps 3 to 5, with the colony as its own source (it has no food):

| Case                             | Slime is no sink (the owner's rule) | Slime is a sink of weight 0.025 | The organism     |
| -------------------------------- | ----------------------------------- | ------------------------------- | ---------------- |
| Slime on one arm: blank : slime  | 40 : 0                              | 40 : 0                          | 39 : 1           |
| Slime on both arms: left : right | 8 : 15 (p 0.21)                     | 10 : 13 (p 0.68)                | no preference    |
| No slime: left : right           | 12 : 11                             | 8 : 14 and 1 split              | no preference    |
| First food, no slime             | 3,479 steps (1.9 h)                 | 3,332 steps                     | 2,400 to 7,200   |
| First food, slime on both arms   | 6,507 steps: 1.87 times             | 4,217 steps: 1.27 times         | as fast as blank |

**Step 7: the crown.** Pictures show a crown at the head of a tube (drift 1.25) and a fan that migrates (drift 5).
Measured on runs of a lane and a dish: the veins lie along the flow (the mean |cos| of the angle is 0.89 to 0.99),
and a cell becomes a vein (D ≥ 0.5) a median of 400 to 1,900 steps after the front reached it (the organism: about
1,500, Schenz 2019). The front runs 0.015 to 0.03 cells per step: 1.5 to 3 cm/h (the organism: 1 to 3 cm/h).

**What is not reached.**

- With the owner's rule, a colony on slime everywhere is 1.87 times slower: without a sink there is no drift, and
  less plasm pushes the front. A small weight for slime gives 1.27 times; the rest is the base of the maze, which
  is fresh and holds the drift first.
- In an open dish the front is an octagon and the veins prefer the axes of the grid: the square cells show, as de
  Almeida 2021 found on regular lattices.
- Murray's exponent is not measured: the skeleton of the veins gives 0 to 2 junctions per picture.
- The numbers 0.004, 5, 6 cells, 2 times the flow strength and 20 per birth are choices made on these runs.

## The rules of the prototype

`front` of `sim.ts`, all off by default. The rule set of step 6 is
`speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 drift=5 solver=app`:

- `speed`, `speedOn=push`: the territory and its push (step 5).
- `reach`, `rim`: the sinks are the agents with a free cell of the territory beside them, within `reach` cells of
  ground without slime; `slimeWeight` gives a rim without such ground a weight.
- `norm`: all sinks of the strain take `norm` times the flow strength, shared by an exponential mean over `tau`
  (100) steps. `colony`: without a covered food every tube cell gives an equal share; else the ports of the
  covered sites give it.
- `paid`: every `paid` of flux that the front takes is one birth at an agent of the front.
- `drift`: a sensor reads minus this weight times the pressure.
- `solver`: the app's 16 iterations, or `exact` (conjugate gradients), for a check. Both give the Y-maze result.

## Commands

From the root of the repository. Pictures and records go to `research/front/out/`, which git ignores.

- The Y-maze, one case and a range of seeds: `node --import ./research/flow/register.mjs research/front/ymaze.ts
case=one seeds=1-40 speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 solver=app drift=5
slimeWeight=0 name=y3/w0-one` (cases `one`, `both`, `none`; about 2 min per run).
- The table: `node --import ./research/flow/register.mjs research/front/tables.ts research/front/out/y3`.
- Pictures and measures of a dish or a lane: `research/front/shots.ts scene=dish side=200 pics=3000,5000 ...` with
  the same rules; `research/front/ypics.ts slimed=left pics=1500,3300 ...` for the Y-maze.
- The test of the prototype: `npx vitest run --project unit research/front/research.test.ts`.
- `NOTES.md` is the working record of every variant on the way.
