# Part E2f of stage 4: notes on the crown at the head of a tube (2026-11-20)

The brief of the coordinator: a layout where a crown can form, a measure that tells a tree, a crown and a fan apart,
the drift weights 0, 1.25, 1.5, 3 and 5 with `take` (10 seeds each), and if no crown forms, what the rules lack and a
rule that the organism supports. Prototype only: no file under `src/`, not `ENGINE.md`. ADR 0076 records the result.
These notes hold the state, so that a fresh agent can go on.

Every run has the rule set of step 9 (README.md) with the start of the app, the test of the tube of a sink and the
drift `take` (ADR 0073, ADR 0074):
`speed=0.004 speedOn=push paid=20 norm=2 reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app
paidBy=rank fresh=box sums=fixed sinkTube=1 scent=0 driftOn=take drift=<d>`. Commands run from the root; records and
pictures go to `research/front/out/e2f/` (git ignores it).

## The layout: a neck (`layouts.ts` `neck()`, `crowns.ts layout=neck`)

A box of 260 × 240 cells. Its first 40 rows are wall but for a channel 14 cells wide; the food (radius 5) lies at the
closed end of the channel. The colony grows a tube through the channel and then meets open ground, where its head has
room to spread. The lane of 80 cells is too narrow (ADR 0074: the colony fills it), and in a dish a colony grows as a
disc with no tube. `layout=dish` and `layout=edge` (the box without the walls) are kept for checks.

## The measure (`measure.ts` `crownProfile()`, `crown-table.ts`)

- The coordinate is the age of the ground: the steps since the front reached a cell (its front stamp). Bands of age
  0–200, 200–400, 400–800, 800–1,600, 1,600–3,200, 3,200–6,400 and more; at 0.010 to 0.020 cells per step that is 2 to
  4, 4 to 8, …, 32 to 64 cells behind the rim. The line of a band is the cells reached within 50 steps of its middle:
  the outline of the front at that time. A tree, a crown and a fan all have young ground only where they grow.
  The distance from the rim failed for trees (the sides of a tube are rim too); the distance along the colony from
  the start failed for the half disc (its rim is not one line of that distance).
- Thick plasm: an agent on at least 40 % of the open cells of the 5 × 5 square around a cell. The trail cannot tell a
  thick sheet from a thin one: an agent drops trail only when it moves, and the trail of a sparse sheet is above the
  level that makes a full tube body (B = 1 from a trail of one deposit).
- A vein: a ridge of D, the mean over the body cells of its 3 × 3 cells at least 0.05 and 1.5 times the mean of the
  cells 4 away on both sides in one of 4 directions, the sides only on ground with a front stamp (else the fresh D of
  0.2 at the rim counts as a ridge).
- Per band: the shares of the ground with agents, thick plasm, a tube body and veins, the mean D and flux Q; per line:
  the parts of thick plasm, of the body and of the veins, and their cells per part.
- `measure-<step>.png` of `crowns.ts pics=` draws the measure cell by cell (thick plasm bright yellow, body dark
  yellow, veins white, the lines blue). Checked by eye on seed 1 at steps 3,000 to 8,000: the lines are the arcs of the
  old rims, the thick band lies at the rim, the veins are the V from the mouth of the channel.

## First pictures and numbers (seed 1, `out/e2f/look1`, `look3`)

- Drift 0: a tree of arms of full plasm, 8 to 15 cells wide, with blunt ends: no sheet at the head.
- Drift 1.5 and 5: the head spreads from the mouth as a half disc. A band of thick plasm about 8 to 10 cells deep lies
  at the rim (agents on 60 to 80 % of the cells); behind it a thin sheet (agents on 10 to 20 %) whose tube body covers
  all ground; veins only as a V of two from the mouth. No vein in the head, none that forks toward the rim. In the
  look of `look()` the thin sheet looks like the thick one, because the look draws the trail.
- The flux per body cell of the head is 0.02 to 0.08 (Q at the ages 0 to 400 of seed 1, step 3,000), so the tube rule
  sets D near f(Q) of 0.001 to 0.01, and D falls from the fresh 0.2 to 0.03 to 0.07. There the base conductance 0.02
  of a tube cell is as large as D, and a cell with more D than its neighbours gets almost no more flux: no vein can
  grow. (The growth rate of a vein in a sheet is about rate · (μ · D / (D + 0.02) − 1), below 0 for D under 0.025 at
  μ = 1.8.)

## Runs

- `out/e2f/c1`: the campaign of the five drifts, 10 seeds each, 8,000 steps, measures every 1,000 steps, pictures of
  seeds 1 and 2 at steps 4,000 and 8,000 (50 jobs, `out/e2f/c1.jobs`, about 25 minutes on 6 cores). Table:
  `node --import ./research/flow/register.mjs research/front/crown-table.ts research/front/out/e2f/c1 at=4000,8000`.
  Result at step 8,000: drift 0 a tree in 10 of 10 (a T of arms along the wall), drift 1.25, 1.5, 3 and 5 a sheet in
  10 of 10 each: a thick band at the rim (agents on 61 to 68 % of its cells), behind it a thin sheet (agents on 10 to
  16 %) with a tube body on 83 to 87 % of the old ground and veins on 6 to 7 %, the V of two veins from the mouth, no
  vein on the young lines. Q at the head 0.063 to 0.080, D 0.067 to 0.074. `c2` repeats it with the final measure.
  (`c1` is not in the archive.)
- Its ridge test counted lone body cells with the fresh D in the thin fringe ahead of the rim as veins (seen in
  `out/e2f/montage/zoom-measure.png`); since then a vein needs a body on 5 of its 3 × 3 cells. `c2` runs the five drifts
  again with that test and saves the fields (`dump=`), so a changed measure runs again without the runs
  (`crowns.ts remeasure=<folder>-state`).

## Tries (4 seeds each, drift 1.5 unless named, step 8,000)

- `k1`: more flux for the tube rule: `norm=2k paid=20k drift=1.5/k` (the same births, the same pull to first order).
  k = 2: a fan of 5 to 8 veins from the mouth, ending 20 to 30 cells behind the rim; the thin sheet keeps its body (95
  % of the old ground). k = 4 and 8: D rises everywhere, so the pull of the drift falls, and the colony grows along the
  wall as the tree does.
- `m1`: drifts 0.25 to 1 at k = 1 and 2: the form jumps from the tree (0.25) to the sheet (0.5 and more); no tree of
  small crowns between them.
- `b1`: `bodyOn=agents` (the tube body follows the share of agents in the 3 × 3 block, full at 40 %): a compact fan
  with radial veins in the sheet; the thin sheet stays (agents on 15 to 30 %, a body on all of the old ground).
- The cause of the thin sheet: Jones' births. A moving agent with 1 to 10 agents in its 9 × 9 block gets a child every
  third step, wherever D is at least 0.01 (`growthPass()` of sim.ts). So every explored cell refills to about one agent
  in eight, and its trail keeps a full tube body.
- `j1`: `jones=fresh`, Jones' births only within `reach` (6) cells of ground without slime, at the front. The back
  empties: agents on 4 to 5 % of the old ground, a body on 39 to 57 %, veins on 7 to 11 %; just behind the head 18
  veins cross the line of 1,200 steps, 4 to 5 the lines of 2,400 and 4,800 (seed 1). With `bodyOn=agents` and with k = 2
  similar. Montage: `out/e2f/montage/jones-fresh-8000-s1.png` (trail k1, agents k1, trail k2, agents k2).

## The final campaigns (the records of the story and of ADR 0076)

All in the archive under `logs/engine/crown-0076/` (unpack with `research/flow/logs.ts`), one `runs.jsonl` per case
folder, so `crown-table.ts <folder> at=8000` reads them as they lie:

- `c2`, `p1`, `p2`: the five drifts, 10 seeds, 8,000 steps; the rules as they are, `jones=fresh`, `jones=edge`. The run
  records hold the measures every 1,000 steps. `c2r`, `p1r`, `p2r`: the same runs measured again from the saved fields
  at steps 4,000, 6,000 and 8,000 with the direction of the veins (`towardRimByBand()`); the tables of the story come
  from these. The saved fields (`out/e2f/<set>/d<drift>/s<seed>-state/`, about 0.5 MB each) stay out of the archive.
- `tries/k1`, `tries/m1`, `tries/b1`: more flux, the low drifts, `bodyOn=agents` (4 seeds; the ridge test before the
  rule of 5 body cells, no saved fields). `tries/j1r`: `jones=fresh` alone and with the other tries, measured again.
- `dish/fresh`, `dish/edge`: the dish of 160 cells at drift 1.5, slime everywhere and none, 10 seeds, 20,000 steps
  (`dish.ts table=<folder>`). `ymaze/fresh`, `ymaze/edge`: the Y-maze at drift 1.5, 40 seeds per case (`tables.ts
<folder>`; `compare.ts` against `logs/engine/drift-0074/y/take` and `dish/take`).
- `jobs/`: the job lists. `big.jobs` ran `c2`, `p1`, the dish and the Y-maze of `jones=fresh` (122 jobs, about 65
  minutes on 6 cores, named before it ran); `edge.jobs` ran `p2`, its dish and its Y-maze (76 jobs, about 50 minutes);
  `remeasure.jobs` the measures again (166 jobs, a few minutes).

## Results (step 8,000, median)

- The rules as they are: drift 0 a tree (10 of 10), 1.25 to 5 a sheet (10 of 10 each); agents on 11 to 15 % of the old
  ground; 0 to 1 cell of vein on the line of 2,400 steps.
- `jones=fresh`: drift 0 a tree; 1.25 to 5 tubes in 35 of 40, a sheet in 5; agents on 3 to 4 % of the old ground; the
  veins near the head along the rim (|cos| 0.24 to 0.32). In the dish 1.43 times slower on slime everywhere (p 0.00016):
  out.
- `jones=edge`: drift 0 a tree; 1.25 to 5 tubes in 39 of 40, a fan in 1; agents on 3 to 4 % of the old ground; veins
  near the head along the rim (|cos| 0.24 to 0.31). The Y-maze keeps its choices, the dish is 1.09 times slower and as
  fast on slime everywhere, a full dish gives no birth (261 and 201 agents at step 20,000, before 619 and 643).
- Montages for the owner: `out/e2f/montage/` (the story lists them).

## Where to go on

The next rule to try (not built): a sink whose share follows the supply that reaches it, for example the pressure at
its cell over the pressure of the sinks around, so that the rim in front of a tube outgrows the rim between the tubes
(the organism: a front splits and one part stops, Kuroda et al. 2015, p. 3736; a front cut off stops, Schenz 2019,
Sec. 2.2.3). Run it with `jones=edge` and without, in the neck, and read `form()` and the direction of the veins.
