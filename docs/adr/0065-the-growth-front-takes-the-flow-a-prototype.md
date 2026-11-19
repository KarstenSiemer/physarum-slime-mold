# 0065: The growth front takes the flow: what the prototype on the CPU found

- Status: accepted. The prototype and its rules are choices of an agent under the owner's delegation of 2026-11-12.
  The owner decided the conflict of decision 5, the look of decision 6 and the births of decision 7 on 2026-11-19.
  Decision 8 is an agent's choice of the same day.
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
6. **On slime the speed comes from the births that the flux pays.** With the births only at the fresh rim, a colony on
   slime everywhere is 1.32 to 2.23 times slower than without slime, and more so than with slime on both arms. With the
   births at every sink, in the share of the flux that it takes, it is as fast as without slime.
7. **A dish full of slime keeps its colony.** In a dish of 160 cells with slime everywhere the colony covers the dish as
   fast as without slime, and when the dish is full its agents stay and Jones' births go on (README, step 7).

The README has the tables of the three forms of the drift, with 40 runs per case: 40 : 0 with slime on one arm for the
crown and the fan (31 : 9 for the tree with the rules of decisions 7 and 8), no preference with slime on both arms,
everywhere or nowhere, and the first food after 3,275 to 3,768 steps without slime (the organism: 2,400 to 7,200).

## Decision

1. **The rules for the engine** (the rule set of the README): a territory per strain that agents push open with the
   chance 0.004 per agent and step; the agents at the edge of the territory with room beside them are the sinks,
   with the weight 1 within 6 cells of ground without slime and 0.025 elsewhere (decisions 5 and 8); together they
   take 2 times the flow strength, shared by their weights and an exponential mean over 100 steps;
   the covered foods pay it, and without one every tube cell of the strain pays an equal share; every 20 of flux that
   the sinks take is one birth at a sink, in the share of the flux that it takes (decision 7); the flow adapts while
   the front takes flux; a sensor reads minus a weight times the pressure of its strain, the drift (decision 6). The
   rule of the tubes stays as it is.
2. **The front of the owner's rule is the rim near ground without slime** (finding 2). A covered dead end has no room
   and no ground without slime, so it has no sink, as the owner wanted.
3. **The prototype stays research code** in `research/front/`, a topic of its own: `research/flow/prototype` keeps
   the code of ADR 0029.
4. **No GPU pass is written** before the owner has seen the pictures and the table (the plan of stage 4).
5. **The owner's decision of 2026-11-19: slime is a weak sink.** The owner's rule (only fresh ground is a sink) and
   the third target of the Y-maze conflict. With slime as no sink, a colony on slime on both arms has no drift there
   and is 1.87 times slower. A sink of weight 0.025 on slime, shared with the fresh rims, gives 1.27 times and keeps
   the dead ends without a sink (decision 2). The agent recommended the weight, and the owner took it. With 40 runs
   the weight gives 1.24 times on both arms and 1.32 times on slime everywhere. The agent had named the fresh base
   of the maze as the cause of the rest; the case of slime everywhere shows that this is wrong (finding 6). Under
   this decision a child still comes only on fresh ground: a rim on slime takes flux, but that flux pays no birth.
6. **The owner's decision of 2026-11-19: the panel offers every form.** The weight of the drift sets the form: 0
   gives a tree of tubes with small heads, 1.25 to 1.5 a tube with a crown, 5 a fan that migrates. The owner asked
   to make the form selectable in the panel ("über die UI auswählbar") and to build all forms in. So the drift
   becomes a setting with a help text, and each scene sets its value. The agent picks the default of a scene from
   the Y-maze of each form (the README) and from the targets of the scene. The pictures are attached to the pull
   request.
7. **The owner's decision of 2026-11-19: the births follow every sink.** The flux that a sink takes pays births there,
   in the share of that flux, also on slime (`paidOn=sinks`). Then a colony on slime everywhere is as fast as without
   slime in all three forms (0.95 to 1.00 times; Mann-Whitney p 0.15 to 0.82), and the crown and the fan keep 40 : 0
   with slime on one arm. The tree gives 33 : 7 (the organism 39 : 1; Fisher's test: p 0.057), and the first food
   without slime comes 5 to 9 % later. It touches the owner's rule that only a birth onto fresh ground counts: a rim on
   slime then grows from the flux that it takes. The agent recommended it: the flux that a sink takes then becomes plasm
   where it goes, and the organism grows on slime as fast as on blank agar (Reid et al. 2012). The owner took it, with
   the reason that a colony in a dish full of slime must still give birth: else a strain dies in time despite enough
   food, and a second strain cannot multiply at all. A covered dead end still has no sink and no birth (decision 2).
8. **Every sink sits at the edge of the territory, and the slime sets only its weight** (an agent's choice, 2026-11-19;
   it extends decision 2). Under decision 7 a sink on fresh ground could sit anywhere within 6 cells of ground without
   slime, and a sink on slime only within 2 cells of the edge of the territory. So the slime changed the place of the
   sinks, not only their weight: in an open dish the tree grew less far without slime than with it (5,588 against 7,117
   cells after 20,000 steps; p 0.11). Now a sink is an agent at the edge of the territory with room beside it, with the
   weight 1 within 6 cells of ground without slime and 0.025 elsewhere (`sinkAt=edge`). On slime everywhere this gives
   the same runs as before, and the dish grows alike on slime and without it in all three forms (p 0.17 to 0.71). The
   crown and the fan keep 40 : 0, and no preference with slime on both arms (60 : 59 in 120 runs each). The tree gives
   31 : 9 (33 : 7 before).

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
  engine. The tree takes the blank arm only 31 of 40 times and covers only 40 % of an open dish in 20,000 steps:
  the help text of the setting must say so.
- Two strains on one slime: the prototype has one strain, so it shows the births of a strain on the slime of another
  only as the births on slime everywhere. The engine needs a test where a second strain grows on the slime of the
  first.
- The prototype gives the births that the flux pays in one random order over all agents of the front. A GPU needs a
  form without a global order, for example a store of flux per sink that pays a birth when it is full, as the nodes
  at the rim of de Almeida 2021 do. That form is not measured.
