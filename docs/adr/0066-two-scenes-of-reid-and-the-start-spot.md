# 0066: Two scenes of Reid et al. 2012, and the start spot of a scene

- Status: accepted. The wish is the owner's of 2026-11-19. The coordinator decided the group and the settings of the
  scenes, the layout of the Y-maze, the dish and the kind of shape `start` (decisions 1, 2, 3 and 5); an agent decided
  the details and the rest. Both under the owner's delegation of 2026-11-12. Built 2026-11-19.
- Date: 2026-11-19
- Extends [ADR 0064](0064-the-scenes-run-the-rules-of-the-organism.md) (the group Experiments and its rules),
  [ADR 0025](0025-growth-and-shrinkage.md) and [ADR 0032](0032-scenes-for-the-flow.md) (the start layout At the
  first food). Changes decision 3 of [ADR 0056](0056-the-avoidance-of-slime-waits-for-the-growth-front.md): the
  Y-maze is a scene of the app now.
- Extended by [ADR 0088](0088-the-scenes-of-reid-run-the-rules-and-the-avoidance-of-slime-is-a-setting.md)
  (2026-11-21): both scenes run the rules of the growth front, and the Y-maze has its two controls as scenes.
- In short: the scenes are in `src/model/presets.ts` and the layout of the Y-maze in `src/model/y-maze.ts`.
  [`research/flow/README.md`](../../research/flow/README.md), part 26, has the commands and the records.

## Context

The owner wrote on 2026-11-19 (translated from German): "Test with a Y preset where one corridor has slime, and with a
petri dish where there is slime everywhere. Feel free to add these presets."

The two are the test beds of stage 4 of the plan, the growth front as a sink of the flow (ADR 0065, which the open
pull request #114 builds). Reid et al. 2012 (PNAS 109: 17490;
[slime-mazes-and-the-front.md](../knowledge-base/slime-mazes-and-the-front.md), "The plasmodium avoids its own slime")
give the facts:

- **The Y-maze.** A base of agar of 1 cm², two arms of 4 cm of 1 % agar, and a food at the end of each arm. The
  plasmodium sits on the base, without food. With slime on one arm, 39 of 40 plasmodia chose the arm without slime;
  with slime on both arms they showed no preference. The paper gives no width and no angle of the arms.
- **The dish.** 8.6 cm wide, 1 % agar, coated with the slime of a plasmodium that explored it for 48 h. The goal is a
  well of 0.5 cm with 2 % glucose, and the plasmodium starts with 1 mm² of search front. Without the U-shaped trap the
  slime changed neither the time to the glucose, nor the way, nor the speed (n = 13 and 16).
- The knowledge base does not give where the start and the goal lie in the dish. The agent could not read the paper
  on 2026-11-19: PubMed Central shows a check for bots, PNAS answers 403, and NCBI's own interface gives only the
  front matter of this paper.

What the app had:

- ADR 0056 measured the Y-maze as research code (`research/flow/engine/y-maze.ts`), and its decision 3 kept it out of
  the app: without a rule for the slime its two arms fill alike (19 : 20).
- No rule reads the slime (`docs/fidelity.md`, row 23). So today the Y-maze shows no avoidance, and the dish grows as
  on blank agar.
- The start layout At the first food places a colony on a food (`Engine.seedAtFood()`). Reid's plasmodium starts on
  agar without food, and a scene had no other way to start a colony at a spot.

## Options

For the start without food:

1. **A shape of the kind `start`**, an edit of the list of the engine that paints nothing. Strain k starts at the k-th
   start spot, in place of its food.
2. **A start point in the settings.** A link carries the settings, so every link would carry the point, and it would
   not follow a scene's shapes to another grid or arena.
3. **The layout Empty and a step of the inoculate tool by the scene**, as `y-maze.gpu.test.ts` does it. The engine has
   no step of a scene, and a reset would lose it.
4. **A small food under the start.** It would be a site of the flow and a source of scent, where the paper has none.

For the slime of the arm of the Y-maze: the layout paints it as runs of single rows, with the smallest radius of a
brush. They stamp the cells of the arm exactly, but a stroke of that radius gives a cell 737 of the 4,095 of the full
amount of slime (`docs/model.md`, 6.9), and the picture hardly draws it. In a picture of step 1,000 the ground of the
arm with slime is (27, 26, 21) in RGB, that of the blank arm (23, 21, 16), and the full film of the dish (73 to 79,
76 to 83, 66 to 72).

1. **Keep the runs alone**: the scene shows no slime on its arm.
2. **Add one stroke of slime for the film**, inside the own part of the arm: the same stamps, the full amount.
3. **Paint the arm with wider strokes in place of the runs**: they would stamp cells beyond the own part.

## Decision

1. **Two scenes in Experiments**, with the rules of the organism (ADR 0064) and the source "Reid et al. 2012". Each
   has one case, and its texts say plainly that no rule reads the slime yet, and that the avoidance comes with a rule
   for the growth front (stage 4, ADR 0065).
2. **Y-maze with slime** (`y-maze`): the layout of ADR 0056 as it was, on its lattice of 129 × 90 cells at 0.537 mm per
   cell: a base of 19 × 19 cells, arms of 74 cells at 45°, 19 cells wide, and a food at the end of each arm. Slime lies
   on the own part of the left arm. The settings are those of the Snail maze on the lattice of the layout, as
   `y-maze.gpu.test.ts` ran the measurement of ADR 0056: Jones' foraging agent, growth and shrinkage, and the flow with
   a strength of 8, in a box. So the scene runs what that measurement ran, with the settings of a maze of Experiments.
   The layout moved to `src/model/y-maze.ts`; `research/flow/engine/y-maze.ts` exports it again, so the research code
   and the prototype of stage 4 keep their path.
3. **Slime everywhere** (`slime-everywhere`): a dish on a lattice of 169 × 169 cells. The dish of the app is 0.945 of
   the side (`DISH_FILL`), here 159.7 cells or 8.58 cm. 169 is the odd side nearest to 8.6 cm, so the middle of the
   dish is the middle of a cell, as in the Voronoi diagram; 171 cells give 8.68 cm. The well of glucose is food, 5 mm
   wide. One stroke of slime of half the side covers every cell of the dish with the full amount. The settings are
   `forager()` with this lattice: the rules of Experiments, in a dish, and the flow with the default strength of 8.
   With one food no flux runs today; a sink at the front of stage 4 takes flux from it.
4. **The places in the dish are this app's**, as the paper's were not read: the start and the well lie on the vertical
   axis, 1 cm inside the rim, the start at the top and the well at the bottom. So the colony crosses the dish, 6.6 cm.
5. **The start spot: option 1.** A shape of the kind `start` is an edit with the number 7 (`EnvKind.start`). With the
   layout food, strain k starts at the k-th start spot of the list, in the disc and with the step of a start on a
   food. A strain without a start spot starts on its food: the k-th food stroke, as before. Each scene has one start
   spot, its first shape.
   - It paints nothing: `paintsEnv()` and `changesSlime()` are false for it. The engine gives a simulation no stroke
     of one, and both backends would leave one out, so no shader changes.
   - The sweep keeps it under an erase and a wall: it stands in the placement as an edit outside the grid does.
     Nothing on screen shows it, so no stroke clears it.
   - Clear removes it with the rest of the list. A reset after a Clear starts no colony.
   - A link holds it as every shape of its scene: by the bit of the shape, with no new version of the link. No link
     holds it as a stroke: no tool paints one, a drawing with such a stroke gives no bytes, and bytes with the number
     7 give no drawing.
   - Its radius is not read, and the scenes give 0. The colony takes the disc of about 100 cells of a start on food.
6. **The film of the Y-maze: option 2.** One stroke of slime along the middle line of the own part of the left arm,
   with a radius of 12.69 cells: the 9.19 cells from the middle line to the cells of the arm farthest from it, and the
   3.5 cells that the ramp of the amount needs. It starts 22.0 cells from the apex, so that the nearest cell that the
   two arms share lies 0.1 cells outside its edge, and it ends on the last diagonal of the arm. It stamps no cell that
   the runs do not stamp, so the slime of ADR 0056 keeps its cells. It gives 1,126 of the 1,228 cells of the arm the
   full amount. Only the picture reads the amount. The research code keeps the runs alone (`shapes()`); the film is
   `film()` of the layout.
7. **The panel names the layout "On food or start, one colony each"** (the coordinator, on review). It was "On food, one
   colony each", and in the two scenes of this record no colony starts on food: a label of the panel must say what the
   layout does in every scene.
8. **No link to a figure.** The knowledge base names Fig. 2 for the Y-maze, but the agent could not open the paper to
   see what the figure shows (ADR 0037 links a figure that shows the result of the scene). The tab About of Learn
   cites the paper with its DOI, and the chip of the source opens the tab Physarum.
9. **The slime is new at the start of a run**, as all painted slime (`docs/model.md`, 6.9). The paper's slime was 8 to
   12 h old in the Y-maze and up to 48 h old in the dish. No rule reads it today; a rule that reads only old slime
   needs a setting for the age of the slime of a scene.

## Results

**The Y-maze with slime**, WebGPU, 5 seeds, 6,000 steps (`reid.gpu.test.ts`). The colony comes at step 1. A food is
touched when one of its cells holds plasm, as in ADR 0056:

| Seed | First food      | Other food | Plasm on the base at step 1,000, 6,000 |
| ---- | --------------- | ---------- | -------------------------------------- |
| 1    | right, step 101 | step 192   | 280, 98                                |
| 2    | right, step 96  | step 124   | 359, 220                               |
| 3    | left, step 64   | step 175   | 361, 227                               |
| 4    | left, step 95   | step 100   | 261, 102                               |
| 5    | right, step 119 | step 221   | 308, 100                               |

On WebGL2 (seeds 1 and 2, 3,000 steps) the right food comes first, at the steps 83 and 140, and the left one at the
steps 170 and 149. So the left arm, with slime, comes first in 2 of 7 runs. ADR 0056 had 19 : 20 in 39 runs. In the
pictures the colony fills the base and both arms, and from about step 3,000 one tube joins the two foods and the rest
of the base starves. The base keeps a part of the tube where the tube runs across it (seeds 2 and 3).

The colony of the scene reaches the first food after about 100 steps; in ADR 0056 it took 65 steps. There the colony
came after 18,000 steps, when the scent of the foods had spread, and here at step 1. Which of the two sets the
difference is not measured.

**Slime everywhere**, the same runs: the colony reaches the glucose at the steps 421, 339, 397, 511 and 410 on
WebGPU, and 115 and 355 on WebGL2. Arms grow out on all sides. With one food no flux runs, and a network of loops
remains: a ring along the rim and a few tubes across, with 1,642 to 1,907 agents at step 6,000.

**The slime changes neither scene.** The same runs without the slime shapes (`VITE_SLIME=0`) end with the same bytes
of the agents and of the trail: 10 of 10 runs on WebGPU at step 6,000, and 4 of 4 on WebGL2 at step 3,000. So in the
dish the app keeps the time and the way, as the plasmodia of the paper did, and in the Y-maze it shows no avoidance,
unlike them.

**The bytes of the other scenes.** The digests of every scene after 500 steps on both backends, with the state of the
flow, against those of ADR 0064 (`logs/engine/scenes-0064/digest-branch.jsonl`): 58 of 58 runs are equal. The two new
scenes add 4 runs. The fit of the grid of ADR 0058 (`research/electrode/fit.ts`) has 3,348 cases now, and the same 8
change their grid; the two new scenes keep theirs in all 216 of their cases.

**Tests.** The unit tests hold the two scenes (`presets.test.ts`), the start spot in the engine with the CPU backend:
the start, a strain without a spot, that it paints nothing, the sweep, Clear and a link (`engine-env.test.ts`), the
sweep (`sweep.test.ts`), the link (`link.test.ts`), the film (`research/flow/engine/y-maze.test.ts`) and the slime of
the dish (`environment.test.ts`). The GPU tests place the colony on the start spot of the Y-maze on both backends and
compare the environment, the outlines and the slime with the scene without the spot (`engine.gpu.test.ts`). The 15
wrong rules SP1 to SP15 of `mutate.ts` each fail at least one test. The e2e test of the chip of the source opens Learn
for the Y-maze too; no e2e test is new, so the four shards keep their tests.

## Consequences

- Experiments holds 11 scenes. A visitor sees what the app does with slime today: nothing that the organism does in
  the Y-maze, and what it does in the dish.
- A scene can start its colony anywhere. A scene of a paper whose plasmodium starts without food can use it.
- Stage 4 measures its rule on these scenes in the app, beside its prototype in `research/front/`.
- A link made before this record holds no start spot: no scene had one.

## Open points

- **The places of the start and of the well in the dish of the paper**, and the time that the plasmodia took to the
  glucose without the trap: not read.
- **Not measured**: more than 5 seeds on WebGPU and 2 on WebGL2; the scenes with slime on both arms or on neither,
  which a user paints with the Slime tool or erases.
- The U-shaped trap of the paper is no scene.
- The colony of the app crosses an arm of 4 cm in about 100 steps, 3.3 min of model time; the organism needs 1.3 to
  4 h (`docs/fidelity.md`, row 6).
