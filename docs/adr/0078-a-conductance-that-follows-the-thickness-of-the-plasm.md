# 0078: A conductance that follows the thickness of the plasm: a small try

- Status: accepted. Decided by the owner on 2026-11-20: after ADR 0077 (no crown in 12 runs) the crown research goes
  on, with this small try (2 weights of the drift, 2 seeds each). The option and the measure are an agent's, under the
  owner's delegation of 2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0077](0077-a-sink-whose-share-follows-its-supply.md) and
  [ADR 0076](0076-the-crown-at-the-head-of-a-tube.md) (finding 4, what the rules lack, point 2).
- In short: the section "A conductance that follows the thickness of the plasm" of
  [`research/front/the-crown-at-the-head.md`](../../research/front/the-crown-at-the-head.md); the raw records are in
  the archive under `logs/engine/cube-0078/`.

## Context

In the organism the crown comes from a loop: thick plasm conducts far better than thin plasm, the flow empties the
thin layer into the veins and the front, the front grows where the flow brings plasm, and the weak veins starve. The
model breaks the loop at three places: the tube body comes from the trail, so a thin layer conducts as a thick one
(ADR 0076, point 2); Jones' births refill the thin layer (`jones=edge` stops that); every sink takes an equal share
(`shareOn=supply` changes that). No run had changed all three. `bodyOn=agents` touched the first only linearly.

## The option (`bodyOn=cube` in `research/front/sim.ts`, off by default)

The tube body of a cell follows s³, with s the share of the open cells of its 3 × 3 block that hold an agent (the
block of `bodyOn=agents`), full at s = 1. Reasons: a sheet of thickness h conducts as h³ (Poiseuille); full is the
most plasm the model can hold on a cell. No number is set by a picture. A cell needs agents on about 37 % of its block
over time to keep a body (0.37³ = 0.05, the least body). No change of the option: the runs show no fault (every run
keeps its port at the food and 39 to 94 sinks, and its arms carry the flux).

## The measure

The spread of the pressure over the sinks at step 8,000: the 10th to 90th percentile of the pressure at the sinks of
the last flow pass, over the drop from the food to their mean (`sinkSpread()`, level-free; `crowns.ts` writes it to
`<name>-sinks.jsonl`, `crown-table.ts` prints it).

## Runs (the neck, the rule set of E2f with `take`, step 8,000, seeds 1 and 2)

Spread at the sinks: drift 1.5 seeds 1 and 2; drift 5 seeds 1 and 2.

| Row                                      | Forms   | Agents        | Spread at the sinks    |
| ---------------------------------------- | ------- | ------------- | ---------------------- |
| A `bodyOn=cube`                          | tree 4  | 1,058 – 1,223 | 0.50, 0.24; 0.61, 0.12 |
| B with `jones=edge`                      | tree 4  | 613 – 1,031   | 0.04, 0.56; 0.25, 0.20 |
| C with `jones=edge shareOn=supply`       | tree 4  | 810 – 1,036   | 0.03, 0.04; 0.23, 0.20 |
| C without the option (E2g, run again)    | sheet 4 | 1,441 – 1,584 | 0.05, 0.01; 0.07, 0.05 |
| the rules as they are (drift 1.5 seed 1) | sheet   | 2,990         | 0.21                   |

- The runs without the option give their records of E2f and E2g byte for byte.
- With the option the colony stays small: arms of full plasm with blunt ends, some joined in a loop, and the arms are
  the veins. No thin sheet stays behind (agents on 13 to 30 % of the old ground), and no sheet lies at the head.
  `form()` counts all 12 as trees.
- With equal shares (rows A and B) the spread reaches 0.56 to 0.61. With `shareOn=supply` (row C) it is small at drift
  1.5 (0.03 and 0.04, as without the option) and 0.20 to 0.23 at drift 5 (0.05 to 0.07 without the option). So the
  sinks of `shareOn=supply` level the pressure at the rim, as the coordinator's reasoning says: a sink that stands
  high takes more and so stands lower.

**No run shows a crown**: no sheet at the head of a tube wider than the tube, no lobed rim, no vein that forks toward
the rim. Montages: `research/front/out/e2h/montage/cube-look-8000.png` and `cube-measure-8000.png` (git ignores them;
rows A, B, C; columns drift 1.5 seeds 1 and 2, drift 5 seeds 1 and 2).

## Decision

The option stays in the prototype, off by default. Every record from before stays as it was.

## Consequences and open points

- Not measured: more seeds, other drifts, the forms after step 8,000, the speed of the front, the Y-maze, the dish,
  another exponent or block, the engine.
- With the steep conductance the thin layer no longer carries flux, but the colony then grows arms, not a sheet: the
  front gets plasm only where it is already thick. The owner decides whether the crown aim of stage 4 ends.
