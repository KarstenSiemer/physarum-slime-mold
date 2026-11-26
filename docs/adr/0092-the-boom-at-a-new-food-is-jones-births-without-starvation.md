# 0092: The boom at a new food is Jones' births without starvation

- Status: proposed. Study 1b of phase 1 of the plan of 2026-11-22, which the owner approved on that day for all
  three studies side by side. Done by an agent under the owner's delegation of 2026-11-12. The owner decides at gate 1.
- Date: 2026-11-22
- Extended by [ADR 0100](0100-every-birth-from-the-budget-in-the-engine.md) (2026-11-26): its option 3 is in the engine, with the cap on the credit; the boom at a new food stays.
- Extended by [ADR 0096](0096-gate-1-study-1d-before-a-port.md) (2026-11-23): at gate 1 the owner chose study 1d
  before a port.
- Extended by [ADR 0097](0097-paid-births-thin-the-sheet-and-fill-the-dish.md) (2026-11-23): study 1d measured
  option 3 with rule 2 and `feed=flux`. Paid by the front first, the births thin the sheet; at nine foods the rise
  stays, as the credit of nine foods.
- In short: the story and the tables are in [research/front/P1B-NOTES.md](../../research/front/P1B-NOTES.md). The
  runner `research/front/boom.gpu.test.ts`, the cases `research/front/boom.sh` and the tables `research/front/boom.ts`
  make the numbers again. No rule, pass or scene of the app changed.

## Context

With the rules and the levers of the Crown of veins, Food ring shows the owner's pulse: when the colony covers more
foods, its count of agents doubles within 1,000 steps and falls again
([PLAN-2026-11-22.md](../../research/front/PLAN-2026-11-22.md), 2.2 C). The plan named two candidates: the respawn on
tubes with D > 0.5 (`docs/model.md` 7.2) and Jones' births where D ≥ 0.01 again (section 9).

## Findings

1. The respawn does not make the boom. In the engine every birth and death was sorted by its kind, exactly, by the
   random streams of the respawn and the starvation. Before the boom about 10,000 births of the growth pass and 3,000
   to 3,800 respawns per 500 steps balance 11,000 to 12,400 starved agents. At the second covered food the tube cells
   with D ≥ 0.01 rise from 12,183 to 27,953 within 500 steps, the starved agents fall from 12,419 to 266 per 500
   steps, and Jones' births go on. The respawns fall from 3,760 to 8 per 500 steps, as the cells with D > 0.5 fall
   from 855 to 24.
2. No remedy of the plan passes the measure No boom on one seed: a Flow strength of 2 or 4 with more Flux to the
   front, no respawn, and a pressure limit of 32 or 8 times the Flow strength all rise by +101 % to +112 % within 1,000
   steps. Today fails on 6 of 6 seeds (+99 % to +113 %, −28 % to −55 %).
3. The flood follows the flux to the front more than the flux between foods: Flux to the front 0.5 halves the boom
   (+45 %, −20 %), 0.25 does not end it (+152 % in a small colony). Without Jones' births the respawn makes a spike
   on the veins (+251 %). So no flux between foods that was tried keeps a thin sheet from flooding.
4. The measure as the plan wrote it also fails on normal growth: in 3 of 6 seeds the largest rise lies at the first
   1,000 agents, before a second food. The rise from the first step with 2 covered foods reads the boom alone.

## Options for phase 2

1. No respawn while the rules run (2.4 option 3, b). It does not end the boom: Jones' births take its place.
2. A low Flow strength, or a flux between foods that the sheet does not carry (a, c). As tried, neither ends it, and
   a low Flow strength lowers the budget of the paid births (0.2 in place of 0.8 per step).
3. Every birth while the rules run comes from the budget of the paid births, Jones' births and the respawn too, with
   the budget of study 1c (the food pays the growth). A flux that opens ground then makes no mass by itself.

## Recommendation

Option 3, after study 1c has its budget, in the prototype first and then in the engine; measured with the rise from
the second food and the fall, on 6 seeds. The agent recommends it; the owner decides at gate 1.

## Consequences

- The measure No boom reads the rise from the second covered food (P1B-NOTES.md, "The measure").
- Option 3 changes the growth pass of both backends and section 9 of `docs/model.md`, only while the rules run; the
  scenes without the rules keep their bytes.
- The runner sorts births and deaths of any scene and patch, so phase 2 can check its rule by kind.
