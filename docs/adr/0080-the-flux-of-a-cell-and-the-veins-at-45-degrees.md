# 0080: The flux of a cell and the veins at 45°

- Status: accepted. A study of an agent under the owner's delegation of 2026-11-12; the coordinator asked for it.
- Date: 2026-11-20
- Extends [ADR 0079](0079-veins-in-a-still-sheet.md) (open point: the diagonal V).
- The scripts: `research/front/still.ts` (`fluxOn`), `research/front/flux-angle.ts`; `cellFlux()` in
  `research/front/sim.ts`. The raw records are in the archive under `logs/engine/still-0080/`.

## Context

In all 32 runs of ADR 0079 the two main veins leave the mouth at ±45°. The flux Q of a cell is half the sum of the sizes
of the fluxes over its 4 edges: in the prototype and in the engine (`flow.wgsl` lines 365 to 369, `flow.frag` lines
211 to 215, `flow-reference.ts` line 92). A uniform flow F at the angle θ to the grid then reads F · (|cos θ| + |sin θ|):
1.31 · F at 22.5°, 1.41 · F at 45° (the test). The rule of the tubes grows D with Q, and the veins of the organism follow
no grid.

## The option

`fluxOn=norm` (off by default): Q = √(ax² + ay²), with ax and ay the means of the sizes of the fluxes in x and in y; the
measure as it is equals ax + ay. A uniform flow reads F at every angle; a sink, where the flow comes in from both sides,
still reads its throughput (the mean signed flux would read 0). Its limit: a vein one cell wide along a diagonal steps
east and south in turn and reads 0.71 times its flux, where the sum reads it at 1. With 4 edges no measure reads both a
broad flow and a thin vein alike at every angle.

## Results (the still sheet of ADR 0079: equal shares, base 0.02, step 16,000, seeds 1 / 2)

On the sheet with D the same everywhere (`flux-angle.ts`), the sum reads the flow on the arcs 1.26 to 1.28 times higher
at 22.5° and 1.37 to 1.45 times at 45° than at 0°; the norm 1.00 to 1.09 times. With the exponent 1.8 of f(Q) the sum
gives a diagonal cell about 1.8 times the target D. The runs with `fluxOn=sum` give the rows of ADR 0079 exactly (k = 1,
2, 4, both seeds).

| k   | Parts on the arcs 20, 40, 60, 75: sum | norm                          | Veins on a diagonal / an axis: sum | norm                     | Angle at the mouth: sum | norm            |
| --- | ------------------------------------- | ----------------------------- | ---------------------------------- | ------------------------ | ----------------------- | --------------- |
| 1   | 2, 2, 2, 2 (both)                     | 3, 3, 0, 0 / 3, 2, 0, 0       | 0.88 / 0.00 (both)                 | 0.05 / 0.17; 0.05 / 0.07 | 45, 45 (both)           | 23, 26 / 23, 22 |
| 2   | 4, 7, 8, 17 / 4, 7, 9, 19             | 7, 6, 7, 4 / 8, 9, 10, 7      | 0.29 / 0.09; 0.28 / 0.09           | 0.39 / 0.39; 0.30 / 0.30 | 44, 44 (both)           | 43, 7 / 9, 3    |
| 4   | 4, 12, 18, 23 (both)                  | 7, 11, 13, 27 / 7, 11, 12, 27 | 0.14 / 0.13 (both)                 | 0.23 / 0.27; 0.22 / 0.25 | 48, 48 (both)           | 52, 52 / 7, 52  |

- The shares count the vein cells whose axis lies within 7.5° of a diagonal or of an axis (0.17 each at random); the
  axis comes from the structure tensor of D (`veinAxis()`, within 0.2° on straight test veins). The angle at the mouth
  is that of the main vein between the radii 15 and 35, in degrees from the axis of the channel, left and right; with the
  norm at k = 2 and 4 the main vein is on some sides a vertical line in the middle (3° to 9°).
- With the norm at k = 1, D has not settled (1.9 % in 500 steps, the sum 0.3 %).

## Answers

1. The sum seeds the V: it reads the flow on the diagonals up to 1.45 times higher, and at k = 1 the V lies on them
   (0.88 of the vein cells). With the norm that share falls to 0.05 and the main veins leave at 22° to 26° from the axis. But
   the norm does not free the veins from the grid: at k = 2 a straight V at 45° comes back, and veins along the axes
   join it (vertical lines in the middle, lines along the wall: 0.30 to 0.39 of the cells on each).
2. No. With the norm the veins run as straight rays from the mouth to the rim, and fine vertical lines fill the middle.
   At k = 2 the count no longer grows toward the rim (7, 6, 7, 4 against 4, 7, 8, 17).
3. The grid of 4 edges itself: the norm reads a thin diagonal vein at 0.71, so thin veins favour the axes, and a broad
   flow at 45° still steps east and south. Next candidates: a flow over 8 neighbours (diagonal edges), and the straight
   wall of the half disc, along which veins lie in every norm run.

## Decision

The study stays in the prototype; `fluxOn` is off by default. No rule changes. Off, the option changes no row of the
still runs of ADR 0079 (k = 1, 2, 4, both seeds; the records add the field `fluxOn` and the new measures).

## Proposal for the owner

The norm in the engine (`flow.wgsl`, `flow.frag`, `flow-reference.ts`, the tests and the wrong rules) would change the
bytes of every scene with the flow. The agent does not propose it alone: it removes the bias of a broad flow but adds
one for thin veins. A flow over 8 neighbours should be tried in the prototype first.

## Not measured

The norm with the growth and the agents (E2f), with `shareOn=supply`, at k = 8, with the base 0.002, and other seeds.
