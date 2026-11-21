# 0084: A front that splits into crowns that move on

- Status: accepted. A study of an agent under the owner's delegation of 2026-11-12; the coordinator asked for it.
- Date: 2026-11-20
- Extends [ADR 0083](0083-more-flux-for-the-veins-of-the-growing-colony.md) (not measured there: steps after 8,000).
- Extended by [ADR 0085](0085-the-crown-so-far.md) (2026-11-21): the crown research pauses, with the case `none` as
  the best form so far; the state with pictures.
- The scripts: `research/front/e2n.sh` (runs, montages), `e2n.ts` (the measures). The raw records are in the archive
  under `logs/engine/crown-0084/`.

## The question

The colony of ADR 0083 (base 0.002, k = 2) has the veins of a crown but grows as one half disc. In the organism a
front cut off from its supply stops (Schenz 2019, Sec. 2.2.3; Kuroda et al. 2015, p. 3736), and the thin sheet behind
the front thins away (Le Verge-Serandour and Alim 2023, Sec. 4.1). With both, does the rim split into crowns?

## The two options (off by default)

1. `sinkOn=fed`: a rim cell is a sink only if its D is at least base / (1.8 − 1) = 1.25 times the base, the level
   above which the rule of the tubes makes a vein grow (ADR 0076, finding 4). A rim without one fed cell takes all
   its cells as before: the food feeds the whole colony, so its flux must reach the rim. No new number.
2. `jones=young`: Jones' births only on ground that the front reached less than 1,500 steps before (its front stamp):
   the delay of the organism from the front to the main vein (about 50 min, Schenz 2019, at about 2 s per step). The
   prototype's median of 400 to 1,900 steps (ADR 0065) spans a factor of 5 between runs.

## The runs

The neck and the rule set of E2f, `stencil=8`, base 0.002, k = 2, equal shares, drift 1.5, seeds 1 and 2, step 16,000,
in a box of 520 × 340 cells: in the box of E2m the colony would reach the walls. No colony touches a wall (reach 201
to 211). One run with both options off in the box of E2m gives the record of E2m again.

| Step 16,000, seeds 1; 2 | Forms        | Agents       | Off-vein agents 10–20; 20–40 cells | First veins behind the rim |
| ----------------------- | ------------ | ------------ | ---------------------------------- | -------------------------- |
| neither; `fed`          | sheet; sheet | 7,328; 7,235 | 0.18, 0.17; 0.07, 0.06             | 23; 22                     |
| `young`                 | tubes; tubes | 4,756; 4,842 | 0.06, 0.05; 0.03, 0.02             | 7; 9                       |
| both                    | tubes; tubes | 4,689; 4,842 | 0.05, 0.05; 0.02, 0.02             | 7; 9                       |

- Heads (rim parts of 13 cells or more that the front reached in the last 1,000 steps): at steps 8,000 and 16,000 the
  whole rim of every run (387 to 752 cells) advances. One head, no standing part.
- `sinkOn=fed` changes nothing: every rim cell is fed at every record, the fallback never runs, and its runs equal
  those without it. A cell that the front reaches holds the fresh D of 0.2, 80 times the level, and the rule of the
  tubes needs about 1,500 steps to bring it below. The option can stop a part of the rim that stands, not make one.
- `jones=young`: a third of the sheet behind the rim, 0.65 times the agents, the same reach. A crescent: a band of
  sheet at the rim about 10 cells deep with veins toward the rim, fed by 1 to 3 thick tubes, bare ground behind.

## Answer and decision

The rim does not split in 8 of 8 runs. `jones=young` gives the closest form yet to a crown that moves on and leaves
tubes behind, but as one arc without lobes. A split needs a cause that makes one part of the rim fall behind first. The
study stays in the prototype; no rule changes.

## Not measured

More seeds, other ages than 1,500, the delay of the main vein in these runs, lobes under 13 cells, the engine.
