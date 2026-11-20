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
  vein on the young lines. Q at the head 0.063 to 0.080, D 0.067 to 0.074. Montage: `out/e2f/montage/forms-look-8000.png`
  (columns drift 0, 1.25, 1.5, 3, 5; rows seeds 1 and 2).
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

## Next campaign and its cost (named before it runs)

122 jobs, about 390 minutes of one core, about 65 minutes on 6 cores: `c2` (the five drifts, the rules as they are,
50 runs), `p1` (the same with `jones=fresh`, 50 runs), the dish of 160 cells with `jones=fresh` at drift 1.5 (slime
everywhere and none, 10 seeds, 20,000 steps) and the Y-maze with `jones=fresh` at drift 1.5 (one, both, none, 40
seeds).
