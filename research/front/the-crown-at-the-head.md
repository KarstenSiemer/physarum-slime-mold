# The crown at the head of a tube: what the rules make, and what they lack

This page belongs to [ADR 0076](../../docs/adr/0076-the-crown-at-the-head-of-a-tube.md), part E2f of stage 4. It
tells the story on one page; [E2f-NOTES.md](E2f-NOTES.md) has the commands, the folders and every number. All runs are
on the CPU prototype (`sim.ts`) with the rule set of step 9 (README.md), the drift `take` (ADR 0074, built in the
engine by ADR 0075), the start of the app and the test of the tube of a sink (ADR 0072, ADR 0073).

**In short.** With the rules as they are, no crown forms: drift 0 grows a tree, drift 1.25 to 5 a sheet, in 50 of 50
runs. The sheet has a thick band at the rim, but behind it a thin sheet keeps a tube body on most of the ground, and
the flux spreads so thin that no vein forms near the rim. Two things in the rules cause it, and both can be measured:
Jones' births refill every cell behind the front to about one agent in eight, and the trail of that thin sheet makes
a full tube body. A rule that lets Jones' births come only near the edge of the territory (`jones=edge`) empties the
ground behind the head and leaves tubes on bare ground, and it keeps the Y-maze and the dish with slime everywhere.
But it makes no crown either: the veins near the head run along the rim, not toward it, in 50 of 50 runs. No rule
tried here reaches a crown; the owner chooses whether `jones=edge` goes on as a step toward it.

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
  counted as a vein. A third came from the numbers: veins near the head that run along the rim counted as veins that
  run toward it, so the measure now reads their direction.
- **Toward the rim**: for each vein cell, |cos| of the angle between the vein (the axis of least curvature of D) and the
  move of the front there (the gradient of the front stamps). 1 is a vein toward the rim, 0 one along it, 0.64 the mean
  at random.

The forms, read at step 8,000 (`form()` of `crown-table.ts`). The limits lie between the groups that the pictures
show: a tree's widest young line holds 7 to 31 cells of thick plasm, any other 75 to 384; a thin sheet behind the head
holds agents on 10 to 16 % of the cells, bare ground on 3 to 6 %.

| Form  | The head                                    | Behind the head (ground 1,600 to 6,400 steps old)                      |
| ----- | ------------------------------------------- | ---------------------------------------------------------------------- |
| tree  | at most 60 cells of thick plasm on a line   | (the arms)                                                             |
| sheet | thick plasm on half of a young band or more | agents on 8 % of the cells or more: a thin sheet with a tube body      |
| fan   | a sheet                                     | fewer agents, under 5 cells of vein on the line of 2,400 steps         |
| crown | a sheet                                     | fewer agents, veins, more at 1,200 than at 4,800, toward the rim ≥ 0.7 |
| tubes | a sheet                                     | fewer agents, veins, but not more of them near the head toward the rim |

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
   agent in eight (the measure: 10 to 16 % behind the head), and the thin sheet never thins. The organism grows where
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

Each try changes one thing and keeps the rest of the rule set (4 seeds, drift 1.5, step 8,000, unless named):

- **More flux for the rule of the tubes** (`norm=2k paid=20k drift=1.5/k`: the same births and, to first order, the
  same pull): k = 2 gives a fan of 5 to 8 veins from the mouth, which end 20 to 30 cells behind the rim, and the thin
  sheet stays. At k = 4 and 8, D rises everywhere, the pull of the drift falls with the pressure, and the colony grows
  along the wall as the tree does.
- **A tube body that follows the agents** (`bodyOn=agents`, full at an agent on 40 % of the 3 × 3 cells): a compact fan
  with radial veins near the mouth; the thin sheet stays, now with agents on 15 to 30 % of its cells.
- **Jones' births only at the front.** `jones=fresh` (within 6 cells of ground without slime) empties the ground
  behind the head, but on slime there is no such ground: in the dish with slime everywhere the colony covers half of
  the dish 1.43 times later than without slime (p 0.00016). `jones=edge` takes the edge of the territory instead, as
  the sinks do since decision 8 of ADR 0065, so the slime does not decide where the colony grows.

**`jones=edge`, the five drifts, 10 seeds each, step 8,000** (`out/e2f/p2`; the rules as they are in brackets):

| Drift | Forms          | Agents        | Agents behind | Vein cells on the line of 2,400 | Veins at 1,200 : 2,400 : 4,800 | Toward the rim, near the head |
| ----- | -------------- | ------------- | ------------- | ------------------------------- | ------------------------------ | ----------------------------- |
| 0     | tree 10        | 759 (787)     | 25 % (26 %)   | 8 (12)                          | 2 : 2 : 2                      | 0.87, the arms                |
| 1.25  | tubes 10       | 1,490 (2,770) | 4 % (15 %)    | 14 (1)                          | 10 : 6 : 5                     | 0.24 (0.22–0.30)              |
| 1.5   | tubes 10       | 1,549 (2,910) | 4 % (15 %)    | 16 (1)                          | 8 : 5 : 4                      | 0.24 (0.19–0.29)              |
| 3     | tubes 9, fan 1 | 1,831 (3,502) | 4 % (12 %)    | 15 (1)                          | 4.5 : 4.5 : 5                  | 0.29 (0.18–0.33)              |
| 5     | tubes 10       | 1,864 (3,831) | 3 % (11 %)    | 27 (0)                          | 4 : 6 : 5                      | 0.31 (0.18–0.57)              |

From drift 1.25 on, the head is a band of thick plasm at the rim, about 10 cells deep, and behind it tubes run from the
mouth to the band over bare ground. The band holds a vein that runs along the rim: the few tubes feed the band at a
few places, and every sink along the rim takes the same share, so the flux runs along the band to the sinks. That is
what the direction shows (0.24 to 0.31, below the 0.64 of chance), and it is not a crown: in the organism the veins
run toward the rim and fork there. The flux through a body cell of the head is 0.12 to 0.19, twice as much as without
the rule, and D there 0.087 to 0.094.

**The targets of ADR 0065 with `jones=edge`, drift 1.5**, against `take` on the same seeds (ADR 0074; `compare.ts`):

- The Y-maze, 40 seeds each (`ymaze.ts`): slime on one arm 40 : 0 (the organism 39 : 1); on both arms 25 : 15 (before
  18 : 22, Fisher's p 0.18); without slime 13 : 27 (before 15 : 24 and 1 split, p 0.64; against no preference the
  binomial p is 0.038); slime everywhere 20 : 19 and 1 split. The first food without slime after 3,539 steps, 1.03
  times later than before (p 0.079); with slime on both arms 1.06 times later than without slime (before 1.05), with
  slime everywhere 1.01 times (p 0.57).
- The dish of 160 cells, 10 seeds, 20,000 steps (`dish.ts`): half of it covered after 6,389 steps without slime, 1.09
  times later than before (p 0.00088), and as fast with slime everywhere (0.98 times, p 0.94). The full dish gives no
  birth in the last 5,000 steps (before 6,697 and 7,221; p 0.00016) and keeps 261 agents without slime and 201 with
  slime at step 20,000 (0.42 and 0.31 times as many): with the territory full there is no edge, so no Jones' birth,
  and no room at the rim, so no sink and no paid birth. The colony lives on as its tubes (the least 127 agents),
  because a dead agent comes back on a vein. That touches the reason of decision 7 of ADR 0065 (a colony on slime must
  still give birth); a colony on slime that still has room grows at its edge as before.

**What still lacks for a crown**, with what the runs show:

- **The rim grows as one band.** Every sink takes an equal share of the flux, wherever it lies on the rim, and the
  front moves where agents lie. So the whole rim advances at one speed (a smooth arc in every picture), and nothing
  lets the part in front of a tube outgrow the parts between the tubes. In the organism a front splits and one of the
  two stops (Kuroda et al. 2015, p. 3736), some fans are pulled back while others stay (the review, Sec. 2.2), and a
  front cut off from its supply stops after about 20 min (Schenz 2019, Sec. 2.2.3). A crown is the part of the front
  that a tube feeds. Not tried here: a sink whose share follows the supply that reaches it, for example the pressure
  at its cell.
- **The flux in the head is still thin** (0.12 to 0.19 per body cell, D 0.087 to 0.094): a vein grows only where D
  stands well above the base conductance 0.02, and the tries with more flux (k = 2 to 8) changed the pull of the drift
  before they made veins toward the rim.

## Pictures for the owner

In `out/e2f/montage/` (git ignores it), each picture of 260 × 240 cells cut to its upper 160 rows, at step 8,000:

- `forms-look-8000-s1.png` and `-s2.png`: the look of seeds 1 and 2; columns drift 0, 1.25, 1.5, 3 and 5; top row the
  rules as they are, bottom row `jones=edge`. `forms-measure-8000-s1.png` and `-s2.png`: the same runs as the measure
  draws them (thick plasm bright yellow, tube body dark yellow, veins white, the lines of 100 to 4,800 steps blue).
- `close-8000-s1.png`: the head close up, drift 0, 1.5 and 5; top the rules as they are, bottom `jones=edge`.
- The tries: `k-look-8000-s1.png` (more flux, k = 1, 2, 4, 8; look above, measure below), `body-agents-8000-s1.png`
  (`bodyOn=agents`), `jones-fresh-8000-s1.png` (`jones=fresh` alone, with `bodyOn=agents`, with k = 2, with both) and
  `low-drifts-8000-s1.png` (drift 0.25, 0.5, 0.75 and 1; k = 1 above, k = 2 below).

## What is not measured

- A sink whose share follows the supply that reaches it: the next rule to try, not built.
- `jones=edge` in the engine, in the scenes of the app (Tokyo, the mazes, the start scene with three strains), with two
  strains on one slime, and its look in the running app.
- The dish and the Y-maze at drifts other than 1.5 with `jones=edge`; the lane of 80 × 300 cells; the speed of the
  front with it.
- The tries `k`, `bodyOn=agents` and the low drifts ran 4 seeds each, and the records of `k`, `bodyOn=agents` and the
  low drifts kept the ridge test without the rule of 5 body cells (their forms do not depend on it).
- The forms after step 8,000: the old ground of `jones=edge` still thins at step 8,000 (a body on 52 to 58 % of it).
- Murray's exponent, the delay of the main vein against the 1,500 steps of the organism, a lobed rim.
