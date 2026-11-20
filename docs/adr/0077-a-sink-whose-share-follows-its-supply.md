# 0077: A sink whose share follows its supply: a small try

- Status: accepted. Decided by the owner on 2026-11-20: option 3 of ADR 0076, first as a small try with pictures (2
  weights of the drift, 2 seeds each); a full measurement only if the pictures show a crown. The rule and its form are
  an agent's, under the owner's delegation of 2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0076](0076-the-crown-at-the-head-of-a-tube.md) (option 3, finding 7).
- In short: the section "A sink whose share follows its supply" of
  [`research/front/the-crown-at-the-head.md`](../../research/front/the-crown-at-the-head.md); the raw records are in
  the archive under `logs/engine/sink-0077/`.

## Context

ADR 0076, finding 7: every sink takes an equal share of the flux, so the rim advances as one band, and nothing lets
the part of the rim in front of a tube outgrow the rest. In the organism a front cut off from its supply stops (Schenz
2019, Sec. 2.2.3), and a front splits and one part stops (Kuroda et al. 2015, p. 3736).

## The rule (`shareOn=supply` in `research/front/sim.ts`, off by default)

Every sink drains over the conductivity G of its own cell, times its weight, into one common level L of all sinks, at
the pressure of the last solve; L is the level at which the sinks together take what they take now (norm times the
flow strength), so a sink takes G · max(0, p − L) (`supplyLevel()`). The sink rate follows that demand with the time
of a sink (`tau`), as it followed the weight; the take and the paid births follow the rate as before. Reasons:

- Not circular: with set rates the inflow of a sink equals its take. The pressure of a sink against the other sinks is
  set by the paths that bring flux to it: a sink at the end of a good tube stands higher than one fed along a band.
- No level against the ground (ADR 0074): L is a level of the sinks themselves; a constant added to every pressure
  moves L with it and changes no take (a unit test).
- No new number: the conductance is that of the sink's own cell (the drift `take` reads the drop of the take over the
  same conductance), the total is the one of ADR 0065, the time is `tau`.
- Not changed: no rule of the fault list; the runs ran stably (the sinks take the total exactly, every take finite).

## Runs (the neck, the rule set of E2f with `take`, step 8,000, seeds 1 and 2)

| Row                         | Drift 1.5, seeds 1 and 2 | Drift 5, seeds 1 and 2 | Agents behind | Toward the rim |
| --------------------------- | ------------------------ | ---------------------- | ------------- | -------------- |
| the rules as they are       | sheet, sheet             | sheet, sheet           | 11 to 15 %    | (few veins)    |
| `shareOn=supply`            | sheet, sheet             | sheet, sheet           | 10 to 12 %    | 0.78 to 0.97   |
| `shareOn=supply jones=edge` | sheet, sheet             | sheet, sheet           | 8 to 10 %     | 0.81 to 0.88   |

- The check row gives the records of E2f (`c2`) byte for byte.
- `shareOn=supply`: the half disc with the V of two veins, as before, but smaller (2,358 to 3,475 agents against
  2,916 to 3,924).
- With `jones=edge`: one thick tube turns along the wall, thin tubes run from it to the band at the rim, and the
  ground between them is bare (in E2f without the rule: agents on 3 to 4 % behind, veins along the rim, |cos| 0.24 to
  0.31). The veins near the head now run toward the rim, but the rim is still one smooth arc, the head is a band and
  not a sheet wider than a tube, and no vein forks at the rim. `form()` counts them as sheets: agents on 8 to 10 % of
  the old ground.

**No run shows a crown**: no sheet at the head of a tube that is wider than the tube, with veins that fork toward
the rim. Montages: `research/front/out/e2g/montage/supply-look-8000.png` and `supply-measure-8000.png` (git
ignores them; rows as in the table, columns drift 1.5 seeds 1 and 2, drift 5 seeds 1 and 2).

## Decision

The rule stays in the prototype, off by default. By the owner's decision there is no full measurement, as no picture
shows a crown. Every record from before stays as it was.

## Consequences and open points

- Not measured: more seeds, the Y-maze, the dish, other drifts, the forms after step 8,000, the engine.
- The owner decides whether the crown aim of stage 4 ends (the coordinator's recommendation follows the pictures).
