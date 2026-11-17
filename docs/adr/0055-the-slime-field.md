# 0055: The slime field: where the colony was, for how long, and how the app shows it

- Status: accepted (decisions of the coordinator of 2026-11-17, under the owner's delegation of 2026-11-12; "one slime
  for all strains" is the owner's decision of 2026-11-16, ADR 0052)
- Date: 2026-11-17
- Extends [ADR 0052](0052-the-sources-on-slime-mazes-and-the-growth-front.md): the first part of stage 2 of its plan.
- Changes [ADR 0054](0054-a-starved-tube-leaves-starved-ground.md), decision 4: the time of the mark of starved ground
  is a setting now.
- In short: the facts are in
  [`docs/knowledge-base/slime-mazes-and-the-front.md`](../knowledge-base/slime-mazes-and-the-front.md), "Slime", and
  the rule is in `docs/model.md`.

## Context

Stage 2 of the plan of 2026-11-16 is the slime field (`TODO.md`, "Slime, dead ends and the growth front"). The plan
left these points to the design:

- Do the slime and the mark of starved ground live in one field or in two?
- What is the default of the life time of the slime, and how does that setting reach the mark of starved ground?
- Does the flow memory recover in 18 h again, and do the Tokyo scenes go back to a flow strength of 1.4?
- Does the slime get a rule for the moves of the agents?

Two papers were read in full on 2026-11-17, for this record. The knowledge-base file has their facts.

- **Reid et al. 2012.** The Y-maze has arms of 4 cm, and the arm whose food the plasmodium touches first is the
  chosen arm. On agar with slime everywhere the plasmodia moved as fast as on blank agar. The slime of the U-shaped
  trap was up to 2 days old at the start of a run, and a run lasted up to 5 days.
- **Briard et al. 2020.** The plasmodia of this paper did not answer the slime. The ground was rinsed first, to
  remove the slime. What stayed in the ground repelled when a starved or stressed plasmodium had left it, and
  attracted when a well-fed one had. Three strains showed no difference between their own ground and that of another
  strain.

Measured before (ADR 0053 and ADR 0054):

- A lower weight in the pick of a birth does not keep a colony out of a dead end, and a wall for births that a tube
  body lifts does not either: agents walk onto the ground, their trail gives the cells a tube body, and children
  follow.
- The mark of starved ground does keep it out. The mark is a flow memory at its floor. It closes the ground for
  births, it stays while agents walk over it, and an agent on it dies with 1 to 2 % per step.

**Words.** **Slime** is the layer that a plasmodium leaves on its ground. A cell **holds plasm** while the trail of a
strain there is at or above the low level of that strain (below). The **stamp** of a cell is the step at which it
last held plasm. **Blank ground** has no slime; the plan of ADR 0052 calls it fresh ground, but the flow uses that
name for ground with a flow memory of 0.2 (ADR 0053), so this record uses the word of Reid et al.

## Options

1. One field. The slime takes the mark of starved ground over, and the flow memory recovers in 18 h again.
2. Two fields. The slime is new, the mark stays in the flow memory, and each has a time of its own.
3. Two fields, and one setting gives both their time.

## Decision

1. **Stage 2 has two pull requests.** This record is the first: the slime field, its life time, its brush and its
   picture. No rule reads the slime yet, so no run changes. The second is the rule of avoidance with its
   measurement in a Y-maze (ADR 0056). Reason: the owner sees the slime with the first, and stage 4 needs the field.
   The rule needs a measurement before its design is safe ("What the second pull request must measure first",
   below). Two pull requests also stay small enough to read.
2. **Two fields, and one setting for their time (option 3).** Three reasons:
   - The organism has two things. The slime is one. The substance that stays in rinsed ground is the other (Briard
     et al. 2020). The mark of starved ground fits the second: ground that a starved tube left is closed, and ground
     that a fed tube left is taken again at once.
   - The mark of starved ground does two jobs that need the flow memory. It stays under a tube body, and it starves
     the agents that walk onto it. A field that only says "the colony was here" does neither (ADR 0053, the rule
     `left`).
   - The slime is one field for all strains (the owner, 2026-11-16). The flow memory is a field of each strain.
3. **The slime field.** One field for all strains. It holds the stamp of each cell, or none.
   - A cell holds plasm in a step when the trail of at least one strain, after the diffusion of that step, is at or
     above the low level of that strain: T_s ≥ 0.2 · u_s. This is the level from which the tube body grows
     (`docs/model.md`, 8.1; `trailLevels()` in `src/engine/flow.ts`). The test is the same with the flow and
     without it.
   - A cell that holds plasm in a step gets the number of that step as its stamp. Every other cell keeps its stamp.
     A wall and a cell outside the arena never get one.
   - A cell **has slime** at step t while it has a stamp S and t − S < L. L is the life time in steps.
   - The pass runs after the diffusion of a step, in every step while L > 0. A reset clears every stamp.
   - Reason for a stamp in place of an amount that decays: a stamp is exact on both backends, it needs no write
     where nothing happens, and a change of the life time acts on all slime at once. The age of the slime is also
     what the picture needs, and what stage 3 plans for the front.
   - Reason for the trail level: the model already says with it where a plasmodium is. The tube body follows the
     same level, but it exists only with the flow, and the slime must not need the flow.
4. **The life time is the setting Slime life time**, in hours of model time: 0 to 240, default 144 (6 days). An hour
   is 1,800 steps (ADR 0029, decision 10), also without the flow. At 0 the model has no slime, and the pass does
   not run. Reason for 144: it is the time that ADR 0054 took for the mark of starved ground, from the longest
   avoidance of slime that a source reports. The trap of Reid et al. 2012 supports a time of days. No source
   measured the life time.
5. **The same setting gives the mark of starved ground its time.** With the flow, the flow memory of ground without
   a tube grows by the share `FLOW.recover` · (144 / Slime life time) per step. At 144 this is `FLOW.recover`, bit
   for bit, so every scene keeps its bytes. At 18 it is the share of ADR 0029, decision 19, 0.00023. At 0 the mark
   keeps the share of ADR 0054. Reason: ADR 0054 left the setting to this stage. The time says how long a colony stays away
   from ground that it left. The picture of the slime and the closed ground then fade together.
6. **The flow memory keeps one recovery time, and the Tokyo scenes keep a flow strength of 2.8.** Reason: the mark
   stays in the flow memory (decision 2). A second, shorter time for ground above the level 0.01 (option 6 of
   ADR 0054) changes the rule of the tubes and the bytes of the eight scenes with the flow. It is an open point for
   the second pull request, which has the campaign for it.
7. **A brush paints slime.** Reason: the experiments of Reid et al. 2012 coat the agar with slime, and a scene is a
   list of strokes.
   - The tool Slime gives the open cells of its stroke the stamp of the current step, with the hard edge of food.
     Painted slime ages as the slime of the colony does: one field holds both.
   - Erase clears the stamp of its cells, also a stamp of the colony. A wall does the same: a wall replaces what a
     cell holds, as it does with food and light. So no wall holds a stamp. Clear clears every stamp, as an erase of
     the whole grid does.
   - A reset clears every stamp (decision 3). The engine then paints the strokes of the list again that write or
     clear a stamp, in their order, with the stamp of the current step: 0 after a reset. It does the same when a
     switch of the model gives the model its field again. The field is then the one that the strokes painted, cell
     for cell: after the last stroke that covers a cell, no stroke makes the cell a wall or opens it.
   - The tool is there while the model has slime: in the extended model, with a life time above 0.
8. **The app draws the slime** as a pale layer where a cell has slime. The layer tints the ground. The food, the
   trail, the tubes, the light, the walls and the electrodes lie on it. Its strength falls in a straight line with
   the age of the slime, from full at the age 0 to nothing at the life time. Every style draws it, and the scent
   view does not. The setting Show slime of the view turns it off; it changes no run. Reason for the ground: the
   slime lies on the agar and below the plasmodium, and the picture must still show where the colony is now.
9. **Memory**: the stamp is 4 B per cell, on both backends. The fit of the grid counts them in the extended model,
   with slime or without it, so that the setting does not change the grid.
10. **Links and the Jones model.** A link without the setting has a life time of 0: it has no slime, and it runs as
    it was made, as in ADR 0050. The Jones model has no slime: a switch to it frees the field with its stamps, and
    a switch back starts with the painted slime only (decision 7).
11. **Not in this record**: a rule that reads the slime (the avoidance, the moves), the scene Y-maze, and the
    U-shaped trap. The owner's wish that the slime is "perfused" stays an open question (ADR 0052).

## What the second pull request must measure first

These lines are inferences of the coordinator from the rules and from the papers. Nothing here is measured.

- **A weight in the pick acts in a thin layer only.** The plan gives a cell with slime a weight of 0.025 in the pick
  of a birth, and no effect when every free neighbour has slime. So the weight acts only on a parent that has blank
  and slimed neighbours at once: a layer of one cell where blank ground meets slime. Agents walk across that layer,
  and behind it every free neighbour has slime. ADR 0053 measured this for the dead ends.
- **The choice of the organism is a choice of the whole front.** The plasmodium moves its plasm to the part of the
  front that goes on. In the model only the flow joins the far parts of a colony. Stage 4 makes a birth onto blank
  ground a sink of the flow. A front on slime then gets no flux while another front grows on blank ground, and the
  rule of the tubes starves it. With slime everywhere no front is a sink, no tube adapts, and the colony grows as on
  blank ground: that would give "no preference" and "the same speed" of Reid et al. 2012.
- **So the Y-maze comes first.** The second pull request builds the Y-maze as a test of research, measures the
  planned weight there with 40 seeds, and reports how much of the losing arm the colony fills. If the weight alone
  does not reach 39 of 40, the target of the Y-maze moves to stage 4, and the record says so.
