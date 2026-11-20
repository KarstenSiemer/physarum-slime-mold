# 0082: The growing colony with a flow over 8 neighbours

- Status: accepted. A study of an agent under the owner's delegation of 2026-11-12; the coordinator asked for it.
- Date: 2026-11-20
- Extends [ADR 0081](0081-a-flow-over-8-neighbours.md) (not measured: the growth and the agents with 8 edges).
- The scripts: `research/front/crowns.ts` (the runs), `research/front/e2l.ts` (the measures and the pictures of D). The
  raw records are in the archive under `logs/engine/crown-0082/`; the notes are `research/front/E2l-NOTES.md`.

## The question

Does the growing colony form a crown when its flow has 8 edges and its rim gets the flux at which the still sheet
forks (0.26 per rim sink, ADR 0081)?

## The runs

The neck and the rule set of E2f (ADR 0076), `stencil=8`, equal shares, step 8,000, seeds 1 and 2: `norm=2k paid=20k`
for k = 1, 2 and 4, the drift scaled (`1.5/k`) and not (`1.5`), `jones=all` and `jones=edge`: 20 runs. One run with
`stencil=4` (k = 2, drift 0.75, seed 1) gives the record of E2f's try again: the agents, the reach and the measures of
every band alike in all 8 rows.

## Results (step 8,000)

| k, drift | Forms: `jones=all`; `edge` | Flux per rim sink | Veins on the arcs 20 to 90, `jones=all`, seed 1 |
| -------- | -------------------------- | ----------------- | ----------------------------------------------- |
| 1, 1.5   | sheet 2; tubes 2           | 0.033–0.042       | 5, 4, 0, 0, 0                                   |
| 2, 0.75  | sheet 2; tubes 2           | 0.069–0.079       | 5, 11, 5, 1, 0                                  |
| 2, 1.5   | sheet 2; tubes 2           | 0.051–0.059       | 4, 5, 6, 1, 0                                   |
| 4, 0.375 | sheet 2; sheet 2           | 0.145–0.153       | 2, 10, 5, 2, 0                                  |
| 4, 1.5   | sheet 2; sheet 2           | 0.090–0.097       | 5, 13, 17, 5, 1                                 |

- The flux per rim sink is the total of the sinks over their count. The rim of the colony holds 420 to 700 sinks, the
  still sheet 246, so even k = 4 gives a third to a half of 0.26.
- `jones=all`: a half disc with radial veins from the mouth that end before the rim; agents on 17 to 27 % of the old
  ground. `jones=edge`: a net of tubes with holes of bare ground; at k = 4 a tree of tubes with loops. No V at 45°.
- The veins fall in number toward the rim (above: 13, 17, 5, 1 on the arcs 40 to 90). Those of the still sheet rise
  (8, 8, 12, 24 on the arcs 20 to 75). In 13 of 20 runs no vein lies 400 to 1,600 steps behind the rim.
- The still sheet (k = 4) forks on the arcs 60 and 75 between steps 4,000 and 8,000. The front moves 0.008 to 0.015
  cells per step, 30 to 60 cells in that time.

## Answer

No crown in 20 runs. With 8 edges the veins follow no direction of the grid, but the colony lacks three things of the
still sheet: the flux at the rim (its rim is 1.7 to 2.8 times longer), a sheet without holes and with a contrast of D
(`jones=all` keeps a full body and a high D everywhere; `jones=edge` leaves bare ground), and the time (the forks take
4,000 steps, in which the rim moves on).

## Decision

The study stays in the prototype; no rule changes.

## Not measured

k above 4 (about 11 for 0.26 per sink at 700 sinks), more seeds, steps after 8,000, `shareOn=supply`, the base 0.002,
the engine.
