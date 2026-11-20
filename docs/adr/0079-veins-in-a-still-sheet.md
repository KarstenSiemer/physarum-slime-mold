# 0079: Veins in a still sheet: the rule of the tubes without the growth

- Status: accepted. The owner decided on 2026-11-20 that the crown research goes on ("Geb mal nicht so schnell auf"),
  after three small tries without a crown (ADR 0076 to 0078). The study and its measure are an agent's, under the
  owner's delegation of 2026-11-12.
- Date: 2026-11-20
- Extends [ADR 0078](0078-a-conductance-that-follows-the-thickness-of-the-plasm.md) and
  [ADR 0076](0076-the-crown-at-the-head-of-a-tube.md) (finding 4: the flux at the rim is too thin for a vein).
- The script: `research/front/still.ts`; the raw records are in the archive under `logs/engine/still-0079/`.
- Extended by [ADR 0080](0080-the-flux-of-a-cell-and-the-veins-at-45-degrees.md).

## Context

The tries mixed the growth, the agents and the flow. Nobody knew whether the rule of the tubes alone can grow the
veins of a crown: veins from the head of a tube that run toward the rim and fork there.

## The setup (prototype only)

- No agents, no births, no growth. A fixed body, full on every cell: the channel of the neck (14 cells wide) and a half
  disc of radius 80 cells at its mouth, with open ground around it. The trail holds the body; `Sim.flowStep()` runs the
  flow pass alone. The rule of the tubes is that of `sim.ts`, unchanged.
- The food is the source. The sinks are the 246 cells of the outer ring of the half disc (79 to 80 cells from its
  centre, one cell per cell of arc in every direction). They take the total of E2f (norm 2 times the flow strength 8)
  times k = 1, 2, 4 and 8, with equal shares or with `shareOn=supply`. The base conductance of a tube cell is 0.02, and
  0.002 as a diagnostic. D starts at 0.2 with a seeded noise of 1 %. Seeds 1 and 2, 16,000 steps: 32 runs.
- The hooks in `sim.ts` (`stillSinks`, `base`, `flowStep()`) are off by default. The record of E2f `c2`, drift 1.5,
  seed 1, comes out byte for byte (but for the field `shareOn` that ADR 0077 added).
- The measure: the veins of E2f (`ridgeCells()`), counted as parts on the arcs at radius 20, 40, 60 and 75; their
  direction toward the rim is |cos| of `veinTowardRim()`, with the radius as the stamp.

## Results (step 16,000, seed 1; seed 2 lies within 2 parts on every arc)

Parts of veins on the arcs at radius 20, 40, 60 and 75:

| k (flux per sink) | Base 0.02, equal | Base 0.02, supply | Base 0.002, equal | Base 0.002, supply |
| ----------------- | ---------------- | ----------------- | ----------------- | ------------------ |
| 1 (0.065)         | 2, 2, 2, 2       | 2, 2, 2, 2        | 2, 2, 6, 13       | 2, 2, 2, 2         |
| 2 (0.13)          | 4, 7, 8, 17      | 4, 4, 4, 4        | 4, 6, 10, 22      | 4, 4, 4, 4         |
| 4 (0.26)          | 4, 12, 18, 23    | 4, 4, 4, 10       | 4, 10, 16, 26     | 4, 4, 4, 10        |
| 8 (0.52)          | 0, 4, 9, 26      | 0, 4, 4, 18       | 0, 4, 12, 29      | 0, 4, 4, 18        |

- A vein wider than about 8 cells counts as 2 parts, its two edges (the test looks 4 cells to each side). So "4" at
  radius 20 is the V of two wide veins. At k = 8 the middle of the half disc is full (D near 1) and holds no ridge.
- The veins that fork run toward the rim: |cos| 0.98 at radius 20, 0.72 to 0.86 at radius 75.
- With `shareOn=supply` the sinks at the ends of the V take most of the flux: the top 10 % of the sinks take 55 to
  82 % of it at the base 0.02, and 95 to 98 % at the base 0.002 (k = 1 to 4).
- D settles: it changes by 0.3 to 1.3 % in 500 steps at step 16,000. At step 8,000 the counts are the same, but for
  radius 40 (4 instead of 7 to 12: the forks still grow inward).
- In all 32 runs the two main veins run from the corners of the mouth along the diagonals of the grid (±45°).

## Answers

1. Yes. With equal shares, veins run from the mouth toward the rim and fork there, finer and finer: at k = 2 and the
   base 0.02, 4, 7, 8 and 17 parts (seed 2: 4, 7, 9 and 19). Montage: `research/front/out/e2i/montage/d-16000-s1.png`
   (rows k = 1, 2, 4, 8; columns base 0.02 equal, supply, base 0.002 equal, supply; git ignores it).
2. From k = 2 on, 0.13 per sink, with the base 0.02. At the flux of E2f (k = 1, 0.065 per sink) only the V forms; with
   the base 0.002 it forks (2, 2, 6, 13). So at the flux of E2f the base conductance is the obstacle, as ADR 0076
   reckoned (a vein grows only above D = 0.025), and twice the flux removes it.
3. With `shareOn=supply` no run forks: D makes the V and starves the rest. A sink that stands high takes more, so its
   vein gets more flux and stands higher still; nothing makes the flux split. The fork needs a sink that keeps its
   share wherever it lies on the rim: then every part of the rim must be fed, and the flux must split toward it.

## Decision

The study stays in the prototype, and its hooks are off by default. No rule changes, and every record stays.

## Consequences and open points

- A crown needs the take spread along the whole rim and twice the flux of E2f at the rim; the colony of E2f had 0.063
  to 0.080 per body cell at its head.
- Not measured: the time that the veins need (thousands of steps here) against the speed of the front; another
  radius, noise or channel; the engine.
- Open: whether the diagonal V comes from the grid (Q sums the flux over the 4 edges, so it reads a diagonal flow up
  to 1.4 times higher). The coordinator studies it apart.
