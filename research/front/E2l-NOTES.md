# Part E2l of stage 4: notes on the growing colony with a flow over 8 neighbours (2026-11-20)

The question of the coordinator: does the growing colony form a crown when its flow has 8 edges (`stencil=8`, ADR 0081)
and its rim gets the flux at which the still sheet forks? Prototype only. ADR 0082 records the result; these notes
hold the state.

## The runs

The neck and the rule set of E2f (`E2f-NOTES.md`), `stencil=8`, equal shares, step 8,000, seeds 1 and 2:
`norm=2k paid=20k` for k = 1, 2 and 4, the drift scaled (`1.5/k`) and not (`1.5`), `jones=all` and `jones=edge`: 20 runs,
and one with `stencil=4` (k = 2, drift 0.75, `jones=all`, seed 1). The job list is `research/front/out/e2l/c1.jobs` (21
jobs, 15 minutes on 6 cores, a run 3.7 minutes). The records, the saved fields and the pictures lie in
`research/front/out/e2l/` of the main checkout (git ignores it); the records are in the archive under
`logs/engine/crown-0082/`. The measures:
`node --import ./research/flow/register.mjs research/front/e2l.ts measure=research/front/out/e2l/c1` (one line per run,
written to `c1-8000.jsonl`), `pics=` for the pictures of D, the montages with `crown-montage.sh`.

## Results (step 8,000)

| Case (k, drift) | Forms all; edge  | Agents all; edge (s1) | Flux per rim sink | Veins on the arcs 20, 40, 60, 75, 90: all; edge (s1) |
| --------------- | ---------------- | --------------------- | ----------------- | ---------------------------------------------------- |
| 1, 1.5          | sheet 2; tubes 2 | 3,199; 1,424          | 0.033–0.042       | 5, 4, 0, 0, 0; 5, 2, 4, 3, 1                         |
| 2, 0.75         | sheet 2; tubes 2 | 3,447; 1,900          | 0.069–0.079       | 5, 11, 5, 1, 0; 5, 5, 6, 8, 0                        |
| 2, 1.5          | sheet 2; tubes 2 | 4,882; 2,286          | 0.051–0.059       | 4, 5, 6, 1, 0; 3, 6, 9, 5, 0                         |
| 4, 0.375        | sheet 2; sheet 2 | 3,326; 2,652          | 0.145–0.153       | 2, 10, 5, 2, 0; 3, 8, 13, 2, 0                       |
| 4, 1.5          | sheet 2; sheet 2 | 6,738; 3,493          | 0.090–0.097       | 5, 13, 17, 5, 1; 3, 10, 12, 10, 4                    |

- No crown in 20 runs. `jones=all`: a half disc with radial veins from the mouth that end before the rim; agents on 17
  to 27 % of the old ground. `jones=edge`: a net of tubes with holes of bare ground (k = 1, 2: agents on 3 to 7 % of the
  old ground); at k = 4 a tree of tubes from the mouth with loops, agents on 13 to 20 %. No V at 45°.
- The flux per rim sink stays at 0.03 to 0.15, below the 0.26 at which the still sheet forks: the rim of the colony
  holds 420 to 700 sinks, the still sheet 246.
- The veins fall toward the rim (k = 4, drift 1.5: 13, 17, 5, 1 parts on the arcs 40 to 90), where those of the still
  sheet rise (8, 8, 12, 24 on the arcs 20 to 75). Few veins lie 400 to 1,600 steps behind the rim (no |cos| in 13 runs).
- The time: the still sheet (8 edges, k = 4) forks on the arcs 60 and 75 between steps 4,000 and 8,000 (6, then 16 parts
  on the arc 60); the front moves 0.008 to 0.015 cells per step, 30 to 60 cells in those 4,000 steps.
- The check: `stencil=4` gives the record of E2f's try k = 2 (seed 1) again: all 8 rows alike in the agents, the reach,
  and per band the ground, agents, thick plasm, body, D and Q.
- Montages: `out/e2l/montage/look-8000.png` and `d-8000.png`; rows k = 1 (drift 1.5), 2 (0.75), 2 (1.5), 4 (0.375),
  4 (1.5); columns `jones=all` seeds 1 and 2, `jones=edge` seeds 1 and 2.
