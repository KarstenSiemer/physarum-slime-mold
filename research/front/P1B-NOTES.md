# Study 1b: the boom at a new food

Phase 1 of the plan of 2026-11-22 ([PLAN-2026-11-22.md](PLAN-2026-11-22.md), 2.4 option 3). The record is
[ADR 0092](../../docs/adr/0092-the-boom-at-a-new-food-is-jones-births-without-starvation.md). Food ring with the
levers of the Crown of veins (`territory`, `flowEdges` 8, `flowBase` 0.002, Flux to the front 2, Flow strength 8), in
the engine on WebGPU, 20,000 steps. No file of the app changed.

## The story

When the colony reaches the foods on the ring, its count of agents doubles within 1,000 steps and then falls by a
third to a half. I sorted every birth and every death of the engine by its kind, step by step, through the boom. The
sorting is exact: a respawn puts the agent on the point that its own random stream draws, and a starved agent drew
less than the chance of its cell. In the steps without the growth test, these two explain every birth and every death.

The respawn does not make the boom. Before the boom the colony turns over fast: per 500 steps about 10,000 births of
the growth pass and 3,000 to 3,800 respawns, against 11,000 to 12,400 starved agents, on about 5,000 agents. Most
children of Jones' rule land on ground with D just above 0.01 and starve within a few hundred steps. Then the colony
covers its second food (step 7,969 on the seed of the scene). Within 500 steps the tube cells with D ≥ 0.01 rise from
12,183 to 27,953, and the starvation stops: 266 starved agents in steps 8,500 to 8,999, against 12,419 in steps 7,500
to 7,999. Jones' births go on, so the count rises. The respawns fall from 3,760 to 8 per 500 steps, because the cells
with D > 0.5 fall from 855 to 24: the flux spreads over the whole sheet, and no cell holds a vein. Later the flux
gathers into a ring of tubes between the foods, the sheet starves again, and the count falls.

So the boom is Jones' births on ground that the flux opens, without the starvation that balanced them.

| Steps (seed of the scene) | Agents          | Respawns | Growth pass | Paid claims | Starved | Shrunk | Cells D > 0.5 |
| ------------------------- | --------------- | -------- | ----------- | ----------- | ------- | ------ | ------------- |
| 7,500–7,999               | 5,296 → 5,515   | 3,760    | 10,623      | 401         | 12,419  | 1,745  | 855           |
| 8,000–8,499               | 5,515 → 8,891   | 2,907    | 9,359       | 399         | 7,128   | 1,762  | 582           |
| 8,500–8,999               | 8,891 → 9,192   | 394      | 3,973       | 400         | 266     | 3,800  | 69            |
| 9,000–9,499               | 9,192 → 10,951  | 68       | 4,972       | 401         | 1,938   | 1,343  | 77            |
| 9,500–9,999               | 10,951 → 10,032 | 60       | 9,105       | 399         | 8,397   | 1,687  | 32            |
| 10,000–10,499             | 10,032 → 7,659  | 8        | 15,018      | 400         | 15,637  | 1,762  | 24            |

The growth pass holds Jones' births and the paid births; the paid claims bound the paid births from above. They are
flat at 0.8 per step: the budget is spent in full the whole time, and it is a tenth of the rise.

## The remedies

The measure No boom of the plan: the largest change of the count within 1,000 steps once the colony holds 1,000
agents; pass inside ±30 %. "From the food" reads the same rise only from the first step with 2 covered foods.

| Case (one seed, the scene's)                  | Rise   | Fall  | Rise from the food | Peak   |
| --------------------------------------------- | ------ | ----- | ------------------ | ------ |
| Today                                         | +108 % | −45 % | +106 %             | 11,245 |
| (a) Flow strength 2, Flux to the front 8      | +101 % | −77 % | +94 %              | 12,338 |
| (a) Flow strength 4, Flux to the front 4      | +107 % | −62 % | +107 %             | 11,222 |
| (b) no respawn (`FLOW.birth` 0)               | +112 % | −47 % | +112 %             | 11,379 |
| (c) a pressure limit of 32 · I0 (`FLOW.head`) | +105 % | −70 % | +105 %             | 13,996 |
| (c) a pressure limit of 8 · I0                | +106 % | −69 % | +85 %              | 10,057 |
| Flux to the front 0.5                         | +45 %  | −20 % | +45 %              | 5,752  |
| Flux to the front 0.25                        | +152 % | −33 % | +152 %             | 6,008  |
| No Jones' births (growth min and max 81)      | +251 % | −70 % | +251 %             | 6,251  |

No case passes, so no remedy ran on 6 seeds. Today on 6 seeds (3787577443 and 1 to 5) fails on every seed: rise +99 %
to +113 %, fall −28 % to −55 %, rise from the food +67 % to +113 %, peaks 9,270 to 13,715.

- (a) and (c) lower the flux between foods 4 times, or cap it, and the boom stays. So the flux between foods does not
  make the flood alone. A smaller flux to the front halves it (k 0.5): then the colony is a ring of tubes along the rim
  from step 10,000 on, with no sheet. But it grows slowly, and with k 0.25 a small colony booms later all the same.
- (b) takes the respawn away, and Jones' births take its place: the turnover and the boom stay.
- Without Jones' births the respawn makes a spike on the veins (from about 1,800 agents to 6,251 after step 15,500).
- So I cannot name a flux between foods that a thin sheet stands: every flux tried flooded it, and the flood follows
  the flux to the front more than the flux between foods.

**The measure.** In 3 of the 6 seeds of today the largest rise lies at the first 1,000 agents, before any second food
(+99 % to +106 %): a colony that grows from 1,000 agents doubles within 1,000 steps by its normal growth. The rise
from the food reads the boom alone; phase 2 should use it, and the fall as it is.

**The budget (study 1c).** (a) lowers the budget with the Flow strength: 0.2 births per step at 2 in place of 0.8. The
Flux to the front does not change it. The boom is ten times the budget, so a budget of 1c changes it only if Jones'
births and the respawn are paid from it too.

## For phase 2

Not (b) alone: the respawn is not the cause. Not (a) or (c) as tried. The boom comes from free births: Jones' rule
gives a child wherever D ≥ 0.01, and only the starvation brakes it. My recommendation: phase 2 takes the rule of 1c
(the food pays the growth) and pays every birth while the rules run, Jones' births and the respawn too, from that
budget; then a flux that opens ground cannot make mass. Measure it with the rise from the food, on 6 seeds.

Not done: the CPU prototype (`sim.ts`) was not run (budget); the engine sorting is exact. WebGL2 was not run.

## Files

`boom.gpu.test.ts` (the runner), `boom.ts` (the tables), `boom.sh` (the cases). Records and pictures in
`research/front/out/p1b/` of the main checkout (not in git): `boom-today-k05.png` shows today at steps 8,001, 9,001,
10,001, 11,001 and 12,001 above Flux to the front 0.5 at steps 10,001, 12,001, 14,001, 16,002 and 20,000.
