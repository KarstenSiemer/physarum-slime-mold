# 0076: The crown at the head of a tube: what the rules make, and what they lack

- Status: proposed. The coordinator set the task on 2026-11-20: part E2f of stage 4, research on the prototype only.
  The layout, the measure and the tries are an agent's, under the owner's delegation of 2026-11-12. The choices below
  are the owner's: they change what the weights of decision 6 of ADR 0065 give, the look, and the births of a full
  dish (README step 7 of `research/front/`).
- Date: 2026-11-20
- Extended by ADR 0077
- Decided by the owner on 2026-11-20: option 3, first as a small try (ADR 0077)
- Extends [ADR 0065](0065-the-growth-front-takes-the-flow-a-prototype.md) (decision 6, the forms of the drift; decision
  7, the births) and [ADR 0074](0074-a-drift-that-does-not-read-the-level-of-the-ground.md) (the drift `take`, built
  by [ADR 0075](0075-the-drift-take-in-the-engine.md)), and [ADR 0060](0060-the-growth-front-in-the-picture.md)
  (decision 14: the veins must come from the crown at the head of a tube).
- In short: [`research/front/the-crown-at-the-head.md`](../../research/front/the-crown-at-the-head.md) tells the story
  on one page; [`research/front/E2f-NOTES.md`](../../research/front/E2f-NOTES.md) has the commands, the folders and
  every number. The raw records are in the archive under `logs/engine/crown-0076/`.

## Context

The owner wants real crowns at the heads of tubes: a sheet of plasm at the head, wider than the tube, with veins that
run toward the rim and fork there (ADR 0060, decision 14; the handover of stage 4 in `TODO.md`). Decision 6 of ADR
0065 says drift 0 gives a tree, 1.25 to 1.5 a crown and 5 a fan, and the panel offers these forms. ADR 0074 found
that the crown measured then probably came from the old drift `all`, and the owner chose `take`. No measure told a
crown from a fan: in the lane of 80 cells the colony fills the whole width in every form.

## Findings

1. **A layout with room for a crown**: a box of 260 × 240 cells whose first 40 rows are wall but for a channel 14
   cells wide, the food at its closed end (`layouts.ts` `neck()`). The colony grows a tube through the channel and
   then meets open ground.
2. **A measure from the model's fields** (`measure.ts` `crownProfile()`, `towardRimByBand()`; `crown-table.ts`
   `form()`), against the age of the ground (its front stamp): thick plasm is an agent on 40 % of the 5 × 5 cells (the
   trail cannot tell a thick sheet from a thin one: an agent drops trail only when it moves); a vein is a ridge of D;
   for each vein, |cos| of its angle to the move of the front. Checked on pictures that draw the measure cell by cell;
   three faults were found that way and fixed (the story lists them).
3. **The rules as they are make no crown and no fan** (the five drifts with `take`, 10 seeds each, step 8,000): drift
   0 a tree in 10 of 10 runs; drift 1.25, 1.5, 3 and 5 a sheet in 10 of 10 each. The sheet has a band of thick plasm
   at the rim, behind it a thin sheet with agents on 10 to 16 % of the cells and a tube body on about nine of ten
   cells, and two veins from the mouth; no vein within about 30 cells of the rim. The weight only sets how wide the
   sheet is (184 to 354 cells of thick plasm on a young line). Drift 0.25 still gives a tree, 0.5 a sheet (4 seeds).
4. **What the rules lack**: Jones' births refill every cell behind the front to about one agent in eight (a moving
   agent with 1 to 10 agents in its 9 × 9 block gets a child every third step); the trail of that thin sheet makes a
   full tube body, so it conducts as a thick sheet does; and the flux of the head is too thin for a vein (0.063 to
   0.080 per body cell; D 0.067 to 0.074 against the base conductance 0.02 of a tube cell).
5. **Tries** (4 seeds): twice the flux for the rule of the tubes gives a fan of 5 to 8 veins from the mouth that ends
   20 to 30 cells behind the rim, and the thin sheet stays; 4 and 8 times the flux weaken the pull of the drift and
   give a tree. A tube body that follows the share of agents gives radial veins near the mouth, and the thin sheet
   stays. Jones' births only near ground without slime (`jones=fresh`) empty the ground behind the head, but slow a
   colony on slime everywhere 1.43 times (p 0.00016) in the dish.
6. **Jones' births only within 6 cells of the edge of the territory (`jones=edge`)**, the five drifts, 10 seeds each:
   drift 0 a tree (10 of 10); from 1.25 on a band of thick plasm at the rim with tubes on bare ground behind it (39 of
   40; 1 counts as a fan), with agents on 3 to 4 % of the old ground against 11 to 15 %. The veins near the head run
   along the rim: |cos| 0.24 to 0.31 (0.64 at random). No run is a crown. Against `take` on the same seeds, drift 1.5
   (`compare.ts`): the Y-maze (40 seeds each) gives 40 : 0 with slime on one arm, 25 : 15 on both arms (before 18 : 22,
   Fisher's p 0.18), 13 : 27 without slime (before 15 : 24, p 0.64; binomial p 0.038), 20 : 19 with slime everywhere,
   and the first food 1.01 to 1.05 times later (p 0.0012 to 0.33). The dish covers half of itself 1.09 times later
   (p 0.00088), on slime everywhere as fast as without (0.98 times, p 0.94); the full dish gives no birth in the last
   5,000 steps (before 6,697 and 7,221, p 0.00016) and keeps 0.42 and 0.31 times the agents (261 and 201).
7. **Why still no crown**: every sink takes an equal share, wherever it lies on the rim, so the rim advances as one
   band and the flux from the few tubes runs along the band to the sinks. In the organism a front splits and one part
   stops (Kuroda et al. 2015, p. 3736), some fans are pulled back (Le Verge-Serandour and Alim 2023, Sec. 2.2), and a
   front cut off from its supply stops (Schenz 2019, Sec. 2.2.3): a crown is the part of the front that a tube feeds.

## Options

1. **Keep the rules.** The forms of decision 6 with `take` are a tree (drift 0) and a sheet (1.25 to 5); no crown, no
   fan. The help text of the drift must then say so.
2. **`jones=edge`** (the agent's proposal as a step, not as the crown): the ground behind the head empties into tubes
   on bare ground, as the thin layer between the veins of the organism thins away; it keeps the Y-maze and the dish on
   slime, and needs no new number (`reach` = 6, as the sinks). It changes the look at every drift above 0 (a band and
   tubes, no sheet), slows the dish 1.09 times, and a full dish gives no birth (it keeps its tubes): that touches the
   reason of decision 7 (a colony on slime must still give birth). On slime the colony still grows at its edge.
3. **Look further first**: a sink whose share follows the supply that reaches it (not built), so that the part of the
   rim in front of a tube outgrows the rest. With or without option 2.

## Decision

Proposed, for the owner: option 2 as research code now, and option 3 as the next step toward the crown. Reasons: the
measure shows that the thin sheet behind the head is the first thing that keeps the model from the organism, and
`jones=edge` removes it with no new number and keeps the targets of ADR 0065 except the births of a full dish; but no
rule tried here makes the veins run toward the rim, so the crown of decision 14 is not reached. Until the owner
chooses, no scene and no engine file changes.

## Consequences

- `research/front/sim.ts` has the options `jones` ('all', 'fresh', 'edge') and `bodyOn` ('trail', 'agents'), all off
  by default: every record before stays as it was.
- The forms of decision 6 do not hold with `take`: the panel's crown (1.25 to 1.5) and fan (5) are sheets in the neck.
  The help text of the drift waits for the owner's choice.
- With option 2 the engine needs, in the growth pass, whether open ground outside the territory lies within `reach`
  of a parent: the square that the sinks already read (`fresh=box`, ADR 0067).

## Open points

- The choice of the owner (options 1 to 3), and with it what the panel says the weights of the drift give.
- Option 3 is not built or measured. Not measured with option 2: the engine, the scenes of the app, two strains on
  one slime, the lane, other drifts in the Y-maze and the dish, the forms after step 8,000.
