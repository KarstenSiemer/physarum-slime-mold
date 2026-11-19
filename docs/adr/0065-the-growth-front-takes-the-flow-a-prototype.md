# 0065: The growth front takes the flow: what the prototype on the CPU found

- Status: accepted. The prototype and its rules are choices of an agent under the owner's delegation of 2026-11-12.
  The owner decided the conflict of decision 5 and the look of decision 6 on 2026-11-19.
- Date: 2026-11-19
- Extends [ADR 0052](0052-the-sources-on-slime-mazes-and-the-growth-front.md) (stage 4 of the plan),
  [ADR 0056](0056-the-avoidance-of-slime-waits-for-the-growth-front.md) (the targets of the Y-maze) and
  [ADR 0060](0060-the-growth-front-in-the-picture.md) (the veins must come from the model).
- In short: [`research/front/README.md`](../../research/front/README.md) tells the story on one page and has the
  commands. [`research/front/how-the-crown-forms.md`](../../research/front/how-the-crown-forms.md) tells how the
  agents and the new rules make a crown, and which behaviour of the organism each rule copies.

## Context

Stage 4 of the plan of 2026-11-16 makes the growth front a sink of the flow, so that the model grows a crown at the
head of a tube and avoids its own slime (`TODO.md`). The owner decided: the front is a sink only while it grows, and
only a birth onto fresh ground (without slime) counts; one slime for all strains; the picture draws no structure that
the model does not hold. The targets: the Y-maze of Reid et al. 2012 (39 of 40 for the blank arm, no preference with
slime on both arms, the same time on slime everywhere), a crown with veins along the flow, the delay of the main vein,
Murray's exponent and the speed of the front (`docs/fidelity.md`, rows 6, 23 and 24). The plan asked for a prototype
on the CPU first.

## What the prototype found

`research/front/sim.ts` runs the rules of the scenes with growth and the flow on the CPU for one strain. With the
rules of the app it gives the app's Y-maze: 60 to 65 steps and no preference.

1. **A sink alone cannot make a crown.** Agents walk ahead at one cell per step, Jones' rule gives births only where
   few agents are, and agents follow the trail back into the tube.
2. **Births onto fresh ground are almost none.** The trail of the front puts slime on the ground before a child
   comes. The front must be read as the rim of the colony near ground without slime.
3. **The plasm must move with the flow.** With a sensor that reads the pressure, the plasm streams to the sinks, and
   a sheet with veins spreads at the head of a tube.
4. **The front needs its own speed, and the speed must follow the plasm.** A territory that grows only where agents
   push it gives the organism's speed and the choice of the Y-maze. A fixed speed per cell gives no choice.
5. **The app's solver suffices**: 16 iterations from the last step give the same Y-maze as a solver to a tolerance.

The README has the table: 40 : 0 with slime on one arm, no preference with slime on both arms or none, the first
food after 3,332 to 3,479 steps (the organism: 2,400 to 7,200).

## Decision

1. **The rules for the engine** (the rule set of the README): a territory per strain that agents push open with the
   chance 0.004 per agent and step; the agents of the rim with room beside them, within 6 cells of ground without
   slime, are the sinks; together they take 2 times the flow strength, shared by an exponential mean over 100 steps;
   the covered foods pay it, and without one every tube cell of the strain pays an equal share; every 20 of flux that
   the front takes is one birth there; the flow adapts while the front takes flux; a sensor reads minus a weight
   times the pressure of its strain, the drift (decision 6). The rule of the tubes stays as it is.
2. **The front of the owner's rule is the rim near ground without slime** (finding 2). A covered dead end has no room
   and no ground without slime, so it has no sink, as the owner wanted.
3. **The prototype stays research code** in `research/front/`, a topic of its own: `research/flow/prototype` keeps
   the code of ADR 0029.
4. **No GPU pass is written** before the owner has seen the pictures and the table (the plan of stage 4).
5. **The owner's decision of 2026-11-19: slime is a weak sink.** The owner's rule (only fresh ground is a sink) and
   the third target of the Y-maze conflict. With slime as no sink, a colony on slime on both arms has no drift there
   and is 1.87 times slower. A sink of weight 0.025 on slime, shared with the fresh rims, gives 1.27 times and keeps
   the dead ends without a sink (decision 2). The agent recommended the weight, and the owner took it. A child still
   comes only on fresh ground: a rim on slime takes flux, but that flux pays no birth.
6. **The owner's decision of 2026-11-19: the panel offers every form.** The weight of the drift sets the form: 0
   gives a tree of tubes with small heads, 1.25 to 1.5 a tube with a crown, 5 a fan that migrates. The owner asked
   to make the form selectable in the panel ("über die UI auswählbar") and to build all forms in. So the drift
   becomes a setting with a help text, and each scene sets its value. The agent picks the default of a scene from
   the Y-maze of each form (the README) and from the targets of the scene. The pictures are attached to the pull
   request.

## Consequences

- No scene changes: the app has none of these rules yet. `docs/fidelity.md` changes with the engine.
- The engine needs per strain a territory (1 B per cell), a field of the sinks (4 B) and the distance to ground
  without slime. The growth pass `win` binds 8 storage buffers already: the territory must ride in a buffer it has.
- Every scene with growth and the flow will change its bytes and its times: its front will be about ten times
  slower, as the organism is.
- The drift is a number of the agents pass and a setting of the panel, with a help text in `src/model/params.ts`
  that says which targets hold for each form. A scene without the rules of stage 4 keeps its bytes.

## Open points

- Murray's exponent is not measured: too few junctions in the pictures.
- In an open dish the front is an octagon and the veins prefer the axes of the grid.
- The numbers 0.004, 5, 6, 2 and 20 are choices made on these runs; nobody measured how much each one moves a result.
- Not run: Tokyo, the mazes and the start scenes with these rules. They need the engine.
- The default of the drift for each scene with growth and the flow waits for the measures of the scenes on the
  engine.
