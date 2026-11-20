# 0081: A flow over 8 neighbours

- Status: accepted. A study of an agent under the owner's delegation of 2026-11-12; the coordinator asked for it.
- Date: 2026-11-20
- Extends [ADR 0080](0080-the-flux-of-a-cell-and-the-veins-at-45-degrees.md) (next candidate: a flow over 8 neighbours).
- The scripts: `research/front/sim.ts` (`stencil`), `still.ts`, `flux-angle.ts`, `stencil-time.ts`. The raw records are
  in the archive under `logs/engine/still-0081/`.
- Extended by [ADR 0082](0082-the-growing-colony-with-a-flow-over-8-neighbours.md).

## The option

`stencil=8` (default 4): the solve of the pressure, the fluxes and the flux Q of a cell also use the 4 diagonal
neighbours. A diagonal edge exists only where both cells beside it are open, so it passes no corner of a wall. An axis
edge has the weight √2 − 1 (0.414), a diagonal edge 1 − 1/√2 (0.293); Q is half the sum of the sizes of the 8 fluxes.
The reason for the weights: their ratio 1/√2 makes a broad flow read the same at 0° and 45°, and a vein of one cell read
its flux and conduct the same along an axis and along a diagonal; axis + 2 · diag = 1 keeps the conductance of a sheet.
The weights of the isotropic 9-point Laplacian (2/3, 1/6) read a broad flow 1.18 times higher off the axes and let a
thin diagonal vein conduct 0.35 times as well.

## Results

`flux-angle.ts`, at 0°, 22.5° and 45° (the thin vein: a 4-connected line with 4 edges, an 8-connected line with 8):

| Form   | Broad flow reads | Thin vein reads | Thin vein conducts |
| ------ | ---------------- | --------------- | ------------------ |
| 4 sum  | 1, 1.31, 1.41    | 1, 1, 1         | 1, 0.76, 0.71      |
| 4 norm | 1, 1, 1          | 1, 0.83, 0.71   | 1, 0.76, 0.71      |
| 8      | 1, 1.08, 1       | 1, 1, 1         | 1, 0.92, 1         |

The still sheet of ADR 0079 (equal shares, base 0.02, step 16,000; seeds 1 and 2 give the same counts, the shares
within 0.002); the columns of 4 edges are those of ADR 0080, seed 1:

| k   | Parts on the arcs 20, 40, 60, 75: 4 sum | 8            | Veins on a diagonal / an axis: 4 sum | 8           |
| --- | --------------------------------------- | ------------ | ------------------------------------ | ----------- |
| 1   | 2, 2, 2, 2                              | 4, 4, 4, 0   | 0.88 / 0.00                          | 0.02 / 0.02 |
| 2   | 4, 7, 8, 17                             | 4, 4, 4, 8   | 0.29 / 0.09                          | 0.04 / 0.04 |
| 4   | 4, 12, 18, 23                           | 8, 8, 12, 24 | 0.14 / 0.13                          | 0.09 / 0.09 |

- With 8 edges, four straight rays leave the mouth at k = 1 and 2, by eye at about 20° and 65° from the axis of the
  channel; the measure of the angle at the mouth reads 4° (k = 1), 69° (k = 2) and 83° (k = 4), as it picks one ray.
- `stencil=4` gives the rows of ADR 0080 exactly (k = 2, seed 1). The app's solver follows the exact solve as closely
  with 8 edges as with 4 (|ΔQ| / Q 1.9 · 10⁻⁴ against 2.1 · 10⁻⁴ after 1,000 steps).
- A step: 10.4 ms with 4 edges, 17.4 ms with 8 (1.68 times; CPU, one thread, k = 2, median of 5 blocks of 500 steps,
  other work on the machine).

## Answers

1. Yes, by these measures: the veins prefer no direction of the grid (0.02 to 0.09 of the vein cells on the diagonals
   and as many on the axes, 0.17 each at random); no V at 45°, no lines along the axes or the wall.
2. At k = 4 yes: a tree that forks toward the rim (8, 8, 12, 24 parts, |cos| toward the rim 0.99 to 0.72). At k = 2
   no: four rays (4, 4, 4, 8), where the 4 edges forked (4, 7, 8, 17). So part of the forks of ADR 0079 came from the
   grid; without it the forks need about 4 times the flux of E2f at the rim.
3. 1.68 times the time of a step on the CPU. The engine is not measured.

## Decision

The study stays in the prototype; `stencil` is 4 by default. No rule changes.

## Proposal for the owner

Bring the 8 edges into the engine (`flow.wgsl`, `flow.frag`, `flow-reference.ts`, the tests and the wrong rules): the
veins then follow the flow and not the grid. It changes the bytes of every scene with the flow, so the scenes need
their campaigns again, and the time of the flow pass on both backends must be measured first.

## Not measured

k = 8, the base 0.002, `shareOn=supply`, other seeds; the growth and the agents (E2f) with 8 edges; the weights 2/3
and 1/6 in a run; the time on a quiet machine; the engine.
