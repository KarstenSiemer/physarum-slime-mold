# 0083: More flux for the veins of the growing colony

- Status: accepted. A study of an agent under the owner's delegation of 2026-11-12; the coordinator asked for it.
- Date: 2026-11-20
- Extends [ADR 0082](0082-the-growing-colony-with-a-flow-over-8-neighbours.md) (not measured there: k above 4, the
  base 0.002).
- Extended by ADR 0084 (2026-11-20): a fed sink and a sheet that thins after a time, to step 16,000; no split.
- Extended by [ADR 0086](0086-three-levers-of-the-crown-as-settings.md) (2026-11-21): the base conductance and k as
  settings of the engine.
- The scripts: `research/front/e2m.sh` (runs, montages), `crowns.ts` (`base=` sets the base conductance), `e2m.ts`
  (the measures). The raw records are in the archive under `logs/engine/crown-0083/`; notes: `E2m-NOTES.md`.

## The question and the runs

Does the growing colony with 8 edges (ADR 0082) form a crown with more flux (k = 8 and 16, `norm=2k paid=20k`), or
with the base conductance 0.002 instead of 0.02 (k = 2 and 4, a diagnostic)? The neck and the rule set of E2f,
`stencil=8`, equal shares, drift 1.5, step 8,000, seeds 1 and 2, `jones=all` and `jones=edge`: 16 runs.

| Case        | Forms: `all`; `edge` | Flux per rim sink | Veins on the arcs 20 to 90, `all`; `edge` (seed 1) | First veins behind the rim |
| ----------- | -------------------- | ----------------- | -------------------------------------------------- | -------------------------- |
| k = 8       | sheet 2; sheet 2     | 0.158–0.167       | 2, 2, 13, 16, 7; 2, 5, 9, 17, 15                   | 25, 25; 18, 19             |
| k = 16      | sheet 2; sheet 2     | 0.310–0.329       | 0, 2, 2, 2, 2; 0, 2, 2, 2, 3                       | 15, 11; 9, 3               |
| base, k = 2 | sheet 2; tubes 2     | 0.050–0.058       | 4, 5, 9, 12, 1; 3, 8, 8, 8, 9                      | 19, 21; 7, 11              |
| base, k = 4 | sheet 2; sheet 2     | 0.084–0.095       | 8, 10, 13, 11, 4; 6, 7, 8, 14, 10                  | 24, 23; 17, 16             |

- "First veins behind the rim": the 10th percentile of the distance (cells) of the vein cells below the neck to the
  ground that the front has not reached, seeds 1 and 2. No colony touches a wall.
- k = 16 passes the 0.26 per rim sink at which the still sheet forks, but D is high on the whole half disc: one
  thick sheet, 2 vein parts per arc. k = 8: a fan of radial veins (`all`), a tree of tubes with holes (`edge`).
- The base 0.002 gives a contrast of D at a third of that flux: 5 to 6 main veins from the mouth that fork toward the
  rim, a sheet low in D between them: the vein pattern of a crown. With `jones=edge` the gaps become holes.

## The literature

Three searches found no number for the ratio of the shuttle flow to the net flow in a tube. Alim 2018 (arXiv
1801.02464) gives a shuttle flow up to 1 mm/s and a network that keeps its volume over tens of periods, so the net flow
is small against it; Matsumoto et al. 2008 (Biophys J 94:2492) find the net transport from an asymmetry of the flow,
without a number. The literature supports a k well above 1, but gives no value.

## Answer and decision

No crown in 16 runs. More flux alone thickens the whole sheet. The base 0.002 gives the veins of a crown, but the colony
stays one half disc that grows all along one smooth rim: no head moves on and leaves veins behind. A front cut off from
its supply that stops, and a sheet that thins behind the front, are missing (ADR 0084 tries both). The study stays in
the prototype; no rule changes. The base 0.002 is a diagnostic, not a value of the model.

## Not measured

More seeds, k between 4 and 8 at the base 0.02, `shareOn=supply`, the engine.
