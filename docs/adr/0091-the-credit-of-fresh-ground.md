# 0091: The credit of fresh ground

- Status: proposed. The owner approved phase 1 of the plan of 2026-11-22 on that day, all three studies at once; this is study 1a.
  An agent ran it and wrote this record under the owner's delegation of 2026-11-12. The owner decides at gate 1
  which rules go into the engine.
- Date: 2026-11-23
- Extends [ADR 0085](0085-the-crown-so-far.md) (part E2o, widened).
- In short: the story and the tables are in [research/front/P1A-NOTES.md](../../research/front/P1A-NOTES.md). The plan
  is [research/front/PLAN-2026-11-22.md](../../research/front/PLAN-2026-11-22.md), sections 2.2 B, 2.4 option 2 and
  2.5. `research/front/p1a.sh` makes the runs again.

## Context

Fresh ground starts with the flow memory D = 0.2 (`FLOW.fresh`, `src/engine/flow.ts:61`), 20 times the level 0.01
below which no agent is born. The constant has three jobs: the start of ground that never held a tube (the clear value,
`src/engine/sim.ts:979`, `src/engine/gl/sim.ts:931`), the level up to which starved ground comes back, and the most D
that ground without a tube holds, so that a vanished tube falls to it (the last two are one `min()`,
`src/engine/shaders/flow.wgsl:419`, `src/engine/gl/glsl/flow.frag:263`). Two engine probes with 0.02 and 0.01 in a dish
with a ring of foods gave forking veins and a lobed rim, one seed each. ADR 0085 guessed that a rim on credit conducts
too well along itself.

## Options

The study ran in the CPU prototype, with the rules and the levers of the Crown of veins, in the box of E2n and in a
dish as Food ring, 6 seeds, to step 12,000. The options of `research/front/sim.ts` are off by default, and the runs of
other studies keep their bytes:

1. The credit 0.2 (today), 0.05, 0.02 and 0.01, all three jobs at once (`credit`).
2. One job at 0.02, the other two at 0.2, in the dish (`creditJobs` `start`, `cap`, `fall`). For this the prototype
   marks the ground that once held a tube.
3. Form (i), without a constant (`creditOn=feeder`): a cell that joins the territory takes the D of the tube cell that
   feeds it, its neighbour with a tube and the highest pressure.
4. Form (ii), without a constant (`creditOn=births`): the agents read a level of their own, which follows today's rule
   of D with the credit; D, which only the flow reads, starts at the floor, so a new tube cell conducts at the base.

## Decision

Proposed for gate 1:

1. **Only the start acts.** A port changes the start of fresh ground. The cap and the fall may stay at 0.2: alone, at
   0.02, they give today's colony in the dish (radius 120 and 120 against 118 at step 12,000). The cap cannot act
   within a run, because starved ground comes back by a factor of 1.41 in 12,000 steps.
2. **Do not port the credit on its own in phase 2.** A lower start gives more and finer veins that fork toward the
   rim, and a faster colony, but no case passes the measures of the sheet, of the boom or of the arms (table below).
3. **If the owner wants the finer veins now, port form (i)**, behind the rules, and only after the fix of the boom of
   study 1b. It needs no constant, and its veins fork toward the rim in 5 or 6 of 6 seeds in the box at every step
   from 3,000 (today from 9,000). It makes the boom in the dish stronger (+140 % and −43 %, today +100 % and −18 %).
4. **D = 0.01 is an edge, not a level.** In both backends float32(0.01) squared rounds to float32(10⁻⁴), the packed
   half² (`growth.wgsl:52`, `growth.frag:100`, `flow.wgsl:425`), so it reads as open, and one float32 step lower reads
   as starved. A port uses no credit at the birth level itself.

## Results

The median over 6 seeds at step 12,000; the range and more steps are in the notes.

| Case        | Sheet, box / dish | Boom in the dish | Veins in the box | Fork in the box | Heads in the box |
| ----------- | ----------------- | ---------------- | ---------------- | --------------- | ---------------- |
| today (0.2) | 0.70 / 0.63       | +100 %, −18 %    | 4 → 11           | 6/6             | 1                |
| 0.05        | 0.65 / 0.48       | +130 %, −33 %    | 4 → 11           | 5/6             | 1                |
| 0.02        | 0.68 / 0.56       | +120 %, −29 %    | 7 → 11           | 2/6             | 1                |
| 0.01        | 0.82 / 0.58       | +130 %, −31 %    | 7 → 14           | 4/6             | 1                |
| form (i)    | 0.79 / 0.53       | +140 %, −43 %    | 7 → 15           | 5/6             | 1                |
| form (ii)   | 0.74 / 0.48       | +130 %, −20 %    | 7 → 15           | 5/6             | 1                |

The aims of the plan: sheet at most 0.3, boom within ±30 %, at least twice the veins at three quarters of the radius
as at a quarter, and at least 3 heads with a front that stands. The box never falls by more than 2 %: its rise is the
growth of a young colony, so the measure No boom fails there for every case. In the dish, before the ring of foods
(step 6,000), no case forks; after it, the outer arc lies on the ring.

Two isolating measures (`research/front/p1a-why.ts`) say why the sheet and the round rim stay:

- Only 5 to 22 % of the cells of old ground hold an agent, but their trail lies above the plasm level on 90 to 100 %
  of the old ground near a vein. A cell with a start of 0.02 gives births for about 270 steps, so the credit does not
  feed these agents: they walk in.
- Per sector of 10 degrees, the rim radius follows the flux of the strongest vein below it only weakly (r from 0.03 to
  0.69 in the box), and the rim radius varies by 2 to 3 %. The rim moves where agents push it, and the drift spreads
  them evenly (the plan, 2.2 D).

## Consequences

- `research/front/sim.ts` has the options `credit`, `creditJobs` and `creditOn`, off by default.
- Arms need a rim that advances where the flux arrives (phase 3, the plan 2.4 option 4). The sheet needs a study of
  what feeds the agents on old ground, with the births by kind of study 1b.
- Not measured: the zigzag of the veins; the engine (the probes stay one seed each); steps beyond 12,000.
- Pictures for the owner, seed 1 at steps 4,000, 8,000 and 12,000 at a zoom of 5: `research/front/out/p1a/` in the
  main checkout (git ignores it), `box-montage.png` and `ring-montage.png` with the rows today, 0.02, 0.01, form (i),
  form (ii), and single pictures of today, 0.01 and form (i).
