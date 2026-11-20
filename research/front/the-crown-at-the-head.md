# The crown at the head of a tube: what the rules make, and what they lack

This page belongs to [ADR 0076](../../docs/adr/0076-the-crown-at-the-head-of-a-tube.md), part E2f of stage 4. It
tells the story on one page; [E2f-NOTES.md](E2f-NOTES.md) has the commands, the folders and every number. All runs are
on the CPU prototype (`sim.ts`) with the rule set of step 9 (README.md), the drift `take` (ADR 0074, built in the
engine by ADR 0075), the start of the app and the test of the tube of a sink (ADR 0072, ADR 0073).

**In short.** With the rules as they are, no crown forms: drift 0 grows a tree, drift 1.25 to 5 a sheet, in 50 of 50
runs. The sheet has a thick band at the rim, but behind it a thin sheet keeps a tube body on most of the ground, and
the flux spreads so thin that no vein forms near the rim. Two things in the rules cause it, and both can be measured:
Jones' births refill every cell behind the front to about one agent in eight, and the trail of that thin sheet makes
a full tube body. PROPOSAL-SHORT

## What a crown, a fan and a tree are

- **A crown** (the owner's word "Kamm", from his photos and videos of 2026-11-18; the handover of stage 4 in
  `TODO.md`): a tube grows with a whole sheet of plasm at its head, wider than the tube, with a lobed rim. Veins run in
  the sheet toward the rim and fork there, finer and finer. The sheet moves on and leaves the veins behind; the strong
  ones become the tube, the fine ones go. The sources agree. A front is first a sheet without structure; veins appear
  in it as it moves on, those along the flow get stronger, the others go, and the thin layer between them thins away
  (Le Verge-Serandour and Alim 2023, Sec. 4.1 and 5.1). Just behind the front many veins lie side by side, and farther
  back they join to a few and then to one main vein (Schenz 2019, Sec. 3.1.4). The plasmodium is thickest close to the
  front (Kuroda et al. 2015). The model of de Almeida 2021 grows a tree with fan-shaped fronts from one food.
- **A fan**: the review calls every growing front a fan, a thin sheet that swells and shrinks with the contractions of
  the network behind it (Sec. 2.2). ADR 0065 (decision 6) uses the word for the form of drift 5: the agents leave the
  back, and the colony moves as one fan. On ground poor in nutrients the organism migrates fast and keeps main branches
  (the review, Sec. 4.2.1).
- **A tree**: under starvation or with repellents the plasmodium grows as trees of branches, on a rich medium as a mesh
  with a sheet at the front (Takamatsu et al. 2009). ADR 0065 uses it for drift 0: tubes with small heads that branch.

## The layout: a neck

A box of 260 × 240 cells whose first 40 rows are wall but for a channel 14 cells wide, with the food at its closed end
(`layouts.ts` `neck()`). The colony grows a tube through the channel and then meets open ground, where its head has
room to spread. The lane of 80 cells is too narrow: the colony fills it (ADR 0074). In an open dish a colony grows as
one disc and has no tube.

## The measure

The measure reads the model's fields (`measure.ts` `crownProfile()`, `crown-table.ts`), against the age of the ground:
the steps since the front reached a cell, from its front stamp. The cells that the front reached at one time form a
line, the outline of the front then; at 0.010 to 0.020 cells per step, 1,200 steps are 12 to 24 cells behind the rim.

- **Thick plasm**: an agent on at least 40 % of the cells of the 5 × 5 square around a cell. An agent is a piece of
  plasm, so the share of cells with an agent is the thickness. The trail cannot tell it: an agent drops trail only when
  it moves, and a thin sheet leaves as much trail as a thick one.
- **A vein**: a ridge of the flow memory D: D at least 1.5 times D 4 cells away on both sides, on a cell with a tube
  body on 5 of its 3 × 3 cells. So a fine vein in a thin sheet counts as a thick tube does.
- The measure was checked on pictures that draw it cell by cell (`measure-<step>.png`): the lines are the old rims, the
  thick band lies at the rim, the veins are the ones the look shows. Two faults were found this way and fixed: the
  distance from the rim runs along the sides of a tree's arms, and a lone body cell in the thin fringe ahead of the rim
  counted as a vein.

The forms, read at step 8,000 (`form()` of `crown-table.ts`; the limits lie between the groups that the pictures show):

| Form  | The head                                    | Behind the head (ground 1,600 to 6,400 steps old)                   |
| ----- | ------------------------------------------- | ------------------------------------------------------------------- |
| tree  | at most 60 cells of thick plasm on a line   | (the arms)                                                          |
| sheet | thick plasm on half of a young band or more | agents on 8 % of the ground or more: a thin sheet with a tube body  |
| fan   | the same                                    | fewer agents, and under 5 cells of vein on the line of 2,400 steps  |
| crown | the same                                    | fewer agents, veins on that line, more veins at 1,200 than at 4,800 |
| tubes | the same                                    | fewer agents and veins, but not more veins near the head            |

## What the rules make now

Five weights of the drift, 10 seeds each, step 8,000 (`out/e2f/c2`), median (least to most):

| Drift | Forms    | Agents        | Thick plasm on a young line | Agents behind | Body on the line of 2,400 | Veins at 1,200 : 2,400 : 4,800 |
| ----- | -------- | ------------- | --------------------------- | ------------- | ------------------------- | ------------------------------ |
| 0     | tree 10  | 787 (618–868) | 22 cells (7–26)             | 26 %          | 24 of 32 cells            | 2 : 2 : 1.5                    |
| 1.25  | sheet 10 | 2,770         | 184 cells (174–229)         | 15 %          | 170 of 184 cells          | 0 : 0.5 : 2                    |
| 1.5   | sheet 10 | 2,910         | 213 cells (196–237)         | 15 %          | 171 of 198 cells          | 0 : 1 : 2                      |
| 3     | sheet 10 | 3,502         | 296 cells (265–330)         | 12 %          | 229 of 255 cells          | 0 : 1 : 2                      |
| 5     | sheet 10 | 3,831         | 354 cells (330–384)         | 11 %          | 272 of 295 cells          | 0 : 0 : 2                      |

Drift 0 grows a T of arms along the wall, 8 to 15 cells wide, with blunt ends. From drift 1.25 on, the head spreads
from the mouth of the channel as a half disc: a band of thick plasm about 10 cells deep at the rim (agents on 61 to
68 % of its cells), behind it a thin sheet, and two veins as a V from the mouth. The weight sets only how wide the
sheet is and how many agents it holds. Between 0.25 and 0.5 the form jumps from the tree to the sheet (4 seeds each);
no tree of small crowns lies between.

## What the rules lack

1. **Jones' births refill the ground behind the front.** A moving agent with 1 to 10 agents in its 9 × 9 block gets a
   child every third step, wherever D is at least 0.01. So every cell that the colony reached fills up to about one
   agent in eight (the measure: 11 to 15 % behind the head), and the thin sheet never thins. The organism grows where
   the flow brings its mass, at the front; behind it the thin layer thins away.
2. **A thin sheet holds a full tube body.** The body follows the trail, and one deposit makes it full. So the thin
   sheet behind the head conducts as a thick one does: it holds a tube body on about nine of ten cells of the line of
   2,400 steps, and the flux spreads over it.
3. **The flux in the head is too thin for a vein.** The sinks take 2 times the flow strength together, spread over a
   rim of 200 to 350 cells: the flux through a body cell of the head is 0.063 to 0.080. The rule of the tubes pulls D
   toward 0.01 there; at step 8,000 D has fallen from its fresh 0.2 to 0.067 to 0.074. The base conductance 0.02 of a
   tube cell then makes up a large part of the conductance, so a cell with more D than its neighbours gets little more
   flux: a vein grows at about rate · (1.8 · D / (D + 0.02) − 1), which is below 0 under D = 0.025. Veins form only
   within about 30 cells of the mouth of the channel, where the flux is denser.

## Tries and the proposal

PROPOSAL-SECTION

## Pictures for the owner

PICTURES-SECTION

## What is not measured

NOT-MEASURED-SECTION
