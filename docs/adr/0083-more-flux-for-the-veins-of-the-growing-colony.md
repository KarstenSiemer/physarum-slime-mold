# 0083: More flux for the veins of the growing colony

- Status: accepted. A study of an agent under the owner's delegation of 2026-11-12; the coordinator asked for it.
- Date: 2026-11-20
- Extends [ADR 0082](0082-the-growing-colony-with-a-flow-over-8-neighbours.md) (not measured there: k above 4, the
  base 0.002).
- The scripts: `research/front/e2m.sh` (the runs and the montages), `research/front/crowns.ts` (a run; `base=` sets
  the base conductance), `research/front/e2m.ts` (the measures of `e2l.ts`, and how far behind the rim the veins
  stand). The raw records are in the archive under `logs/engine/crown-0083/`; the notes are
  `research/front/E2m-NOTES.md`.

## The question

Does the growing colony with 8 edges (ADR 0082) form a crown with more flux (k = 8 and 16, `norm=2k paid=20k`), or
with a lower base conductance of a tube cell (0.002 instead of 0.02, at k = 2 and 4, a diagnostic)?

## The runs

The neck and the rule set of E2f (ADR 0076), `stencil=8`, equal shares, the drift 1.5 (not scaled), step 8,000, seeds
1 and 2, `jones=all` and `jones=edge`: 16 runs.

## Results (step 8,000)

| Case        | Forms: `all`; `edge` | Flux per rim sink | Veins on the arcs 20 to 90, `all`; `edge` (seed 1) | First veins behind the rim |
| ----------- | -------------------- | ----------------- | -------------------------------------------------- | -------------------------- |
| k = 8       | sheet 2; sheet 2     | 0.158–0.167       | 2, 2, 13, 16, 7; 2, 5, 9, 17, 15                   | 25, 25; 18, 19             |
| k = 16      | sheet 2; sheet 2     | 0.310–0.329       | 0, 2, 2, 2, 2; 0, 2, 2, 2, 3                       | 15, 11; 9, 3               |
| base, k = 2 | sheet 2; tubes 2     | 0.050–0.058       | 4, 5, 9, 12, 1; 3, 8, 8, 8, 9                      | 19, 21; 7, 11              |
| base, k = 4 | sheet 2; sheet 2     | 0.084–0.095       | 8, 10, 13, 11, 4; 6, 7, 8, 14, 10                  | 24, 23; 17, 16             |

- "First veins behind the rim": the 10th percentile of the distance in cells of the vein cells below the neck to the
  ground that the front has not reached, seeds 1 and 2. The body reaches 122 to 156 cells from the food; no colony
  touches a wall.
- k = 16 reaches 0.31 to 0.33 per rim sink, more than the 0.26 at which the still sheet forks, but D is high on the
  whole half disc: one thick sheet with a few short slits at the rim, 2 vein parts per arc. k = 8: with `jones=all` a
  fan of many radial veins up to near the rim; with `jones=edge` a tree of tubes with holes that forks toward the rim.
- The base 0.002 gives a contrast of D at a third of that flux: 5 to 6 main veins from the mouth that fork toward the
  rim, with a sheet low in D between them. That is the vein pattern of a crown. With `jones=edge` the gaps become holes.
- The veins rise in number toward the rim with `jones=edge` at k = 8 and with the base 0.002, as on the still sheet.

## The literature

Three searches found no source that gives the ratio of the shuttle flow to the net flow in a tube as a number. Alim
2018 (arXiv 1801.02464) gives the shuttle flow as up to 1 mm/s in tubes of radius 50 µm (after Kamiya 1950) and says
that the network keeps its volume over tens of periods (after Iima and Nakagaki 2012, and Alim et al. 2013), so the
net flow is small against it. Matsumoto et al. 2008 (Biophys J 94:2492) find the net transport forward from an
asymmetry of the flow forward and back, without a number. The literature supports a k well above 1, but no value.

## Answer

No crown in 16 runs. More flux alone thickens the whole sheet (k = 16). A lower base conductance gives the veins of a
crown (a fan of main veins that fork toward the rim, a sheet low in D between them), but the colony stays one half
disc that grows all along its rim: the rim is one smooth arc, and no head moves on and leaves veins behind. Two parts
of the organism are missing: a front cut off from its supply stops, and the thin sheet behind the front thins away
after a time. ADR 0084 tries both.

## Decision

The study stays in the prototype; no rule changes. The base 0.002 is a diagnostic, not a value of the model.

## Not measured

More seeds, steps after 8,000, k between 4 and 8 at the base 0.02, `shareOn=supply`, the engine.
