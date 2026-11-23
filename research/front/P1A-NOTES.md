# Study 1a: the credit of fresh ground

Part of phase 1 of [the plan of 2026-11-22](PLAN-2026-11-22.md) (section 2.4, option 2; part E2o of ADR 0085,
widened). The record of the decision is [ADR 0091](../../docs/adr/0091-the-credit-of-fresh-ground.md). Prototype only:
no rule, pass or scene of the app changed.

## The story

Fresh ground starts with the flow memory D = 0.2 (`FLOW.fresh`), 20 times the level 0.01 below which no agent is born.
Two engine probes in a dish with a ring of foods gave forking veins and a lobed rim with a credit of 0.02 and 0.01. They
were one seed each. This study asked the question again in the CPU prototype, on 6 seeds, in two layouts: the box of
E2n and a dish with a ring of foods as in Food ring. Both run the rules and the levers of the Crown of veins (8 edges,
base 0.002, flux to the front k = 2, drift 1.5), to step 12,000.

What it found:

1. **Of the three jobs of the constant, only the start acts.** In the dish a start of 0.02 alone gives what the credit
   0.02 gives (radius 156 against 153 at step 12,000, forking veins from step 10,500). The cap of starved ground alone
   and the fall of a vanished tube alone stay at today's values (radius 120 and 120 against 118). The cap cannot act
   within a run: starved ground comes back by a factor of 1.41 in 12,000 steps.
2. **A lower start gives more and finer veins that fork, and a faster colony.** In the box, with 0.01 and with both
   forms, the veins on the arc at a quarter of the radius go from 4 to 7, and at three quarters from 11 to 14 or 15. With form (i) (a new cell takes the
   D of the tube cell that feeds it) the veins fork toward the rim in 5 or 6 of 6 seeds at every time from step 3,000;
   today they do so from step 9,000. The pictures show the finer veins (`research/front/out/p1a/box-montage.png`).
3. **It does not reach the other three aims.** No case thins the sheet to 0.3: old ground holds plasm on 0.65 to 0.82
   of its cells in the box and 0.39 to 0.63 in the dish. No case splits the rim in the box: one head in all 36 runs at
   all times. And the boom at the ring of foods gets stronger, not weaker: today +100 % and −18 %, with less credit
   +120 to +140 % and −20 to −43 %. The box has one food, and its colony never falls by more than 2 %.
4. **Why the sheet stays.** Only 5 to 22 % of the cells of old ground hold an agent. The trail of these agents lies
   above the plasm level on 90 to 100 % of the old ground near a vein and on 15 to 63 % of the ground away from the
   veins at step 12,000. A cell on a start of 0.02 gives births for only about 270 steps, so the credit does not feed
   these agents: they walk in.
5. **Why the rim does not split.** Per sector of 10 degrees, the rim radius follows the flux of the strongest vein
   below it only weakly (Pearson r from 0.03 to 0.69 in the box, the median over 6 seeds), and the rim stays round:
   its radius varies by 2 to 3 % in the box. The rim moves where agents push it, and the drift spreads them evenly
   (the plan, 2.2 D). The credit does not touch this.
6. **D = 0.01 sits on the edge.** In both backends of the engine float32(0.01) squared rounds to float32(10⁻⁴), the
   packed half², so it reads as open; one step of float32 lower reads as starved. The prototype compares a float32 D
   with the double 0.01 and reads float32(0.01) as starved. Its case 0.01 runs at the next float32 above 0.01.

**Recommendation for phase 2**: do not port the credit on its own. It passes the measure of the veins, and fails the
other three in every case. If the owner wants the finer veins of the pictures, port form (i), which needs no constant,
behind the rules, and only after the fix of the boom of study 1b, because it makes the boom in the dish stronger.
Arms need a rim that advances where the flux arrives (phase 3), and the sheet needs a look at what feeds the agents on
old ground (the births by kind of study 1b).

## The cases

| Case          | Words                                 | What changes                                                    |
| ------------- | ------------------------------------- | --------------------------------------------------------------- |
| `c020`        | (none)                                | today: start, cap and fall at 0.2                               |
| `c005`        | `credit=0.05`                         | all three jobs at 0.05, as the probes patched it                |
| `c002`        | `credit=0.02`                         | all three at 0.02                                               |
| `c001`        | `credit=0.010000000707805157`         | all three at the next float32 above 0.01                        |
| `feeder`      | `creditOn=feeder`                     | form (i): a new cell of the territory takes the D of its feeder |
| `births`      | `creditOn=births`                     | form (ii): the agents read their own level E, D starts at 1e-4  |
| `start`, etc. | `credit=0.02 creditJobs=start` (dish) | one job at 0.02, the other two at 0.2: `start`, `cap`, `fall`   |

The feeder is the neighbour in the territory with a tube and the highest pressure. In form (ii) E follows the rule of
today's D (start 0.2), and D, which only the flow reads, starts at the floor: a new tube cell conducts at the base.

## The measures on 6 seeds

The median and the range over seeds 1 to 6 at step 12,000. The boom is the largest rise and fall of the agents within
1,000 steps, from the first record with 1,000 agents. Veins: the parts of the ridges of D ≥ 0.05 on the arcs at a
quarter and at three quarters of the median rim radius; fork: the seeds with at least twice as many on the outer arc.
Arms: the seeds with at least 3 heads (ADR 0084) and a part of the rim that stands.

| Box       | Sheet            | Boom: rise, fall | Veins  | Fork | Heads | Arms | Radius |
| --------- | ---------------- | ---------------- | ------ | ---- | ----- | ---- | ------ |
| today     | 0.70 (0.67–0.73) | +66 %, 0 %       | 4 → 11 | 6/6  | 1     | 0/6  | 139    |
| 0.05      | 0.65 (0.61–0.68) | +75 %, 0 %       | 4 → 11 | 5/6  | 1     | 0/6  | 168    |
| 0.02      | 0.68 (0.61–0.70) | +69 %, 0 %       | 7 → 11 | 2/6  | 1     | 0/6  | 176    |
| 0.01      | 0.82 (0.74–0.88) | +63 %, 0 %       | 7 → 14 | 4/6  | 1     | 0/6  | 153    |
| form (i)  | 0.79 (0.73–0.81) | +56 %, 0 %       | 7 → 15 | 5/6  | 1     | 0/6  | 163    |
| form (ii) | 0.74 (0.68–0.75) | +76 %, 0 %       | 7 → 15 | 5/6  | 1     | 0/6  | 192    |

| Dish       | Sheet            | Boom: rise, fall | Veins  | Fork | Heads | Arms | Radius |
| ---------- | ---------------- | ---------------- | ------ | ---- | ----- | ---- | ------ |
| today      | 0.63 (0.36–0.75) | +100 %, −18 %    | 3 → 4  | 1/6  | 6     | 3/6  | 118    |
| 0.05       | 0.48 (0.45–0.54) | +130 %, −33 %    | 3 → 18 | 6/6  | 1     | 0/6  | 146    |
| 0.02       | 0.56 (0.46–0.58) | +120 %, −29 %    | 2 → 17 | 6/6  | 1     | 0/6  | 153    |
| 0.01       | 0.58 (0.54–0.70) | +130 %, −31 %    | 3 → 21 | 6/6  | 1     | 0/6  | 135    |
| form (i)   | 0.53 (0.46–0.64) | +140 %, −43 %    | 3 → 20 | 6/6  | 1     | 0/6  | 144    |
| form (ii)  | 0.48 (0.41–0.51) | +130 %, −20 %    | 2 → 13 | 5/6  | 2     | 0/6  | 177    |
| start 0.02 | 0.56 (0.48–0.61) | +120 %, −23 %    | 3 → 13 | 6/6  | 1     | 0/6  | 156    |
| cap 0.02   | 0.39 (0.34–0.98) | +100 %, −26 %    | 3 → 2  | 0/6  | 5     | 2/6  | 120    |
| fall 0.02  | 0.54 (0.37–0.73) | +100 %, −18 %    | 3 → 5  | 2/6  | 5     | 1/6  | 120    |

Two cautions. In the box the rise is the growth of a young colony, with no fall of more than 2 %, so the measure No boom as
the plan defines it fails for every growing colony. In the dish the colonies differ in size at step 12,000, and the
ring of foods lies at radius 115: with less credit the outer arc lies on the ring, and the forks there are the tubes to
the foods. At step 6,000, before the ring, no case forks in the dish (today 8 → 6, 0.01 14 → 1, form (i) 13 → 5).
Today's heads in the dish are the rim at the foods, where the colony stands at step 12,000.

In the box the veins fork toward the rim at these steps (seeds of 6, at 3,000 / 4,500 / 6,000 / 7,500 / 9,000 / 10,500
/ 12,000): today 0 0 0 3 6 6 6, 0.01 2 6 5 5 2 2 4, form (i) 6 6 6 6 5 6 5, form (ii) 6 6 6 4 2 3 5.

## Why the sheet stays and the rim does not split

`p1a-why.ts`, the median over 6 seeds. Near a vein: within 3 cells of a ridge of D ≥ 0.01.

| Layout, step | Old cells with an agent | Plasm near a vein | Plasm away from veins | Rim radius against vein flux, r  |
| ------------ | ----------------------- | ----------------- | --------------------- | -------------------------------- |
| box, 6,000   | 0.16 to 0.22            | 1.00              | 0.79 to 0.98          | today 0.03, the others 0.37–0.69 |
| box, 12,000  | 0.09 to 0.11            | 0.95 to 0.99      | 0.42 to 0.63          | 0.27 to 0.44                     |
| dish, 6,000  | 0.11 to 0.15            | 0.98 to 1.00      | 0.90 to 1.00          | 0.38 to 0.59                     |
| dish, 12,000 | 0.05 to 0.13            | 0.90 to 0.94      | 0.15 to 0.41          | −0.58 to 0.05 (the foods)        |

## Commands

From the root of the repository; the runs and pictures go to `research/front/out/p1a/` (git ignores it).

- `bash research/front/p1a.sh sweep` (72 runs, about 4 hours with 4 jobs), `bash research/front/p1a.sh jobs 0.02`
  (18 runs), `bash research/front/p1a.sh table`.
- `node --import ./research/flow/register.mjs research/front/p1a-why.ts root=research/front/out/p1a/box at=12000`.
- Pictures: seed 1 at steps 4,000, 8,000 and 12,000 at a zoom of 5 (`<case>/s1-look-<step>.png`); the montages
  `box-montage.png` and `ring-montage.png` have the rows today, 0.02, 0.01, form (i), form (ii).
