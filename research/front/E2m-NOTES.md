# Part E2m of stage 4: notes on more flux for the veins of the growing colony (2026-11-20)

The question of the coordinator: does the growing colony with 8 edges (ADR 0082) form a crown with more flux (k = 8
and 16, `norm=2k paid=20k`) or with a lower base conductance (0.002 at k = 2 and 4, a diagnostic)? Prototype only.
ADR 0083 is not written yet: PR #131 (ADR 0081, ADR 0082) was open at the end of this part. These notes hold the state.

## The runs

The neck and the rule set of E2f, `stencil=8`, equal shares, drift 1.5, step 8,000, seeds 1 and 2, `jones=all` and
`jones=edge`: 16 runs, `bash research/front/e2m.sh run` (6 cores, 202 to 243 s a run). `crowns.ts` takes `base=`.
The measures, the pictures of D and the montages: `bash research/front/e2m.sh measure` (`e2m.ts`: the measures of
`e2l.ts`, and how far behind the rim the veins stand). The runs and the records lie in `research/front/out/e2m/` of the
worktree (git ignores it); the montages are copied to `research/front/out/e2m/montage/` of the main checkout. The raw
records are not in the archive yet.

## Results (step 8,000)

| Case        | Forms all; edge  | Agents all; edge (s1) | Flux per rim sink | Veins on the arcs 20, 40, 60, 75, 90: all; edge (s1) | First veins behind the rim |
| ----------- | ---------------- | --------------------- | ----------------- | ---------------------------------------------------- | -------------------------- |
| k = 8       | sheet 2; sheet 2 | 8,133; 6,626          | 0.158–0.167       | 2, 2, 13, 16, 7; 2, 5, 9, 17, 15                     | 25, 25; 18, 19             |
| k = 16      | sheet 2; sheet 2 | 10,614; 10,343        | 0.310–0.329       | 0, 2, 2, 2, 2; 0, 2, 2, 2, 3                         | 15, 11; 9, 3               |
| base, k = 2 | sheet 2; tubes 2 | 4,099; 2,570          | 0.050–0.058       | 4, 5, 9, 12, 1; 3, 8, 8, 8, 9                        | 19, 21; 7, 11              |
| base, k = 4 | sheet 2; sheet 2 | 6,478; 4,039          | 0.084–0.095       | 8, 10, 13, 11, 4; 6, 7, 8, 14, 10                    | 24, 23; 17, 16             |

- "First veins behind the rim": the 10th percentile of the distance (cells, 8 neighbours) of the vein cells below the
  neck to the ground that the front has not reached, seeds 1 and 2. The reach of the body is 122 to 156 cells from the
  food; no colony touches a wall.
- No crown in 16 runs. k = 16 reaches 0.31 to 0.33 per rim sink, but D is high on the whole half disc: one thick sheet,
  a few short slits at the rim, 2 vein parts per arc. k = 8: `jones=all` a fan of many radial veins up to near the rim;
  `jones=edge` a tree of tubes with holes that forks toward the rim. The base 0.002 gives a contrast of D at a third of
  the flux: 5 to 6 main veins from the mouth that fork toward the rim, the sheet between them thin and dark in D.
- The veins rise toward the rim with `jones=edge` at k = 8 and with the base 0.002, as on the still sheet; the whole
  half disc is still one sheet that grows at its rim, with no head that moves on and leaves the veins behind.

## The literature (3 searches)

No source read gives the ratio of the shuttle flow to the net flow in a tube as a number. Alim 2018 (arXiv 1801.02464)
gives the shuttle flow up to 1 mm/s in tubes of radius 50 µm (after Kamiya 1950) and says that the network keeps its
volume over tens of periods (after Iima and Nakagaki 2012 and Alim et al. 2013), so the net flow is small against it.
Matsumoto et al. 2008 (Biophys J 94:2492) find the net forward transport from an asymmetry of the forward and backward
flow, without a number. So the literature supports k well above 1, but no value of k.
