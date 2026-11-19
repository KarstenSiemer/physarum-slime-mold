# 0064: The scenes of Start here and of Experiments run the rules of the organism

- Status: accepted. The wish is the owner's of 2026-11-19. The choices are those of an agent under the owner's
  delegation of 2026-11-12. Built 2026-11-19.
- Date: 2026-11-19
- Extends [ADR 0032](0032-scenes-for-the-flow.md) (the scenes with growth and the flow),
  [ADR 0025](0025-growth-and-shrinkage.md) (the Foraging maze) and
  [ADR 0026](0026-scenes-of-jones-on-their-lattices.md) (the texts about the grid of a scene). The Maze of
  [ADR 0029](0029-flow-in-the-tubes.md) stays as it is.
- Extended by [ADR 0066](0066-two-scenes-of-reid-and-the-start-spot.md) (2026-11-19): two scenes of Reid et al. 2012
  join Experiments with the rules of the organism.
- In short: the scenes are in `src/model/presets.ts`. [`research/flow/README.md`](../../research/flow/README.md),
  part 25, has the commands and the records.

## Context

The owner wrote on 2026-11-19 (translated from German):

1. In the scene Three strains with Growth, Flow in the tubes and the slime switched on, the tubes do not look as
   good as in Corn maze: restless, with bumps on the tubes, as if one saw single agents. In Corn maze the tubes are
   smooth and calm.
2. "I want to see smooth, calm, slimy tubes overall, as close to the real slime mold as possible."
3. "Set the presets of Start here and of Experiments to more similar settings: one agent per cell, growth, flow and
   so on. If presets are then no longer true to the real experiment of a paper, make a new top category for that."

Two causes of what the owner saw are in the picture and in the switch of the rule (ADR 0062, ADR 0063). The third
one is in the settings of the two start scenes:

- Three strains and Two strains were made for several agents per cell, without the rule of one agent per cell, in
  the style of Jenson and Fogleman. Three strains: a decay of 0.6, a sensor distance of 18, a step of 1.4 cells and
  two blur passes.
- With a decay of 0.6 the trail holds what the agents did in the last step or two. With 3 agents per cell that is a
  smooth field. With one agent per cell it is the agents of this moment: the picture shows each agent as a bump, and
  the bumps move in every step.
- The flow keeps a tube that carries flux between two foods, and lets the others starve
  (`docs/model.md`, section 8). A strain that covers fewer than two foods has no flux. The two start scenes have no
  food. So with growth and the flow switched on, nothing chooses a tube: the colony fills the dish and stays.

The owner's link, Three strains in a dish with one agent per cell, growth and the flow, on 768 × 584 cells, seed 1,
at step 900, with three sets of values of the strains:

| Values of the strains                                                      | Agents | What the dish holds              |
| -------------------------------------------------------------------------- | ------ | -------------------------------- |
| The scene's: decay 0.6, sensor distance 18, step 1.4, two blur passes      | 88,954 | one sheet, with a bump per agent |
| The same with a decay of 0.1                                               | 88,957 | one smooth sheet, no tubes       |
| Jones' foraging agent: decay 0.1, sensor distance 7, step 1, one blur pass | 45,621 | a network of tubes per strain    |

So the scenes with growth and the flow look as they do because of Jones' agent, of growth from a food, and of food
that gives the flow its flux.

Before this record the scenes stood in four groups: Start here (2 scenes without the rule), Jones 2010 (4 patterns
of the paper), Experiments (17 scenes: 4 of Jones 2010, 3 of later papers on Jones' model, and 10 on the extended
model, 7 of them with growth and the flow) and Fogleman 2020 (3 scenes without the rule).

## Options

For the two start scenes:

1. **Change their values in place**: Jones' agent, the rule, growth and the flow. Without food no tube is chosen.
2. **New start scenes with food**, and the old ones stay in a group of their own.
3. **New start scenes with food**, and the old ones go.

For the experiments of the papers on Jones' model (Shortest path, Steiner tree, Shrinking plasmodium, Wound healing,
Coarsening network, Electrotaxis, Voronoi diagram) and for the Maze, which follows the protocol of the maze of
Nakagaki et al. 2000 (ADR 0052):

4. **Give them the same rules.** They then no longer follow their papers, which the project wants
   (`AGENTS.md`, "The Jones scenes follow their papers").
5. **Keep them as they are, in a new group.**
6. **Keep them, and add a second scene with the rules of the organism for each.** Eight new scenes, each with a
   layout and a run that somebody must check.

## Decision

Options 2 and 5.

1. **The rules of the organism** are those of `forager()` in `src/model/presets.ts`, which the Snail maze, the Corn
   maze, the Tokyo scenes, Food ring and Rival networks already had: the extended model, one agent per cell, growth
   and shrinkage with Jones' values of 2011, a Capacity of 0.25, the flow in the tubes and the slime. The agent is
   Jones': a step of 1 cell, 5 units per move, a decay of 0.1, one blur pass, a sensor distance of 7, a rotation
   angle of 45° and a food weight of 0.03. Every scene of Start here and of Experiments now runs them, and a unit
   test holds that. The sensor angle is 22.5°, Jones' angle for foraging.
2. **Three strains** (`three-networks`, the new start scene): three rival colonies in a dish of 384 × 384 cells.
   Three foods near the middle are their starts, and nine foods lie on a ring. Each strain flees the trail of the
   others with a weight of −1 and has a flow of its own (ADR 0031).
3. **Two strains** (`two-networks`): two rival colonies in a box of 480 × 320 cells, one from the left and one from
   the right, with nine foods.
4. Both run the flow with a strength of 8, the default and the value of the mazes. With 2, the value of Rival
   networks, each strain keeps fewer and thinner tubes: pictures at the steps 8,000 and 20,000 showed both, and 8
   gives the fuller picture.
5. **Fleeing light** runs the rules of the organism: a colony in a dish of 384 × 384 cells with six foods around the
   lamp, and a flow strength of 2 as in Food ring. The lamp keeps its place, its size and its strength of 0.2.
   Its shapes are revision 1: a link made before paints revision 0, the lamp alone.
6. **The Foraging maze** gets the flow, with a strength of 8. It was the Maze's walls with growth; now it also ends
   with one tube.
7. **The Maze keeps every setting.** It follows the protocol of the maze of 2000: the slime mold filled its maze and
   did not grow after the food came (ADR 0052). So it starts full and has no growth. A campaign with growth in the
   Maze shows the cost (Results): the dead ends empty about eight times later, and the tube lies less tight. It is a
   scene that follows the experiment of a paper, so it moves to the new group.
8. **Paper experiments** is the new group. It holds the seven experiments of the papers on Jones' model and the
   Maze, with every setting as before: no byte of them changes.
9. **Agents share cells** is the group of the scenes without the rule: Fogleman's three, and the two old start
   scenes under the names Three-strain weave and Two-strain weave. They keep their ids (`three-strains`,
   `two-strains`) and their settings, so a link to them and their bytes stay. The group replaces Fogleman 2020: each
   of his scenes still names him as its source.
10. The groups stand in this order: Start here, Experiments, Jones 2010, Paper experiments, Agents share cells. The
    list of the scenes follows the order of the groups by itself (`PRESETS`).
11. **The texts about the grid.** A scene with a lattice showed "as in the paper" and "For this figure, Jones used
    … cells" beside its grid, also where the lattice is this app's choice, as in the Tokyo scenes. The start scenes
    now have a lattice, so every visitor would read it. These texts now name Jones and the paper only for a scene
    of Jones 2010; every other scene reads "the scene’s grid" (`figureLattice()`).
12. Option 6 stays open. A second Shortest path or Steiner tree with the rules of the organism is a scene like
    Food ring with two or four foods. The Foraging maze is such a second scene for the Maze.

## Results

**The new scenes**, WebGPU, seed 1, read every 250 to 500 steps with `tests/pictures/scenes.spec.ts`:

| Scene         | What                                                 | Step                 |
| ------------- | ---------------------------------------------------- | -------------------- |
| Three strains | every strain covers all 12 foods                     | 1,003                |
| Three strains | trail on 0.69 to 0.70 of the cells: the dish is full | 753 to 6,503         |
| Three strains | 29,146 agents, then 11,540, then 10,399              | 1,003; 8,003; 12,003 |
| Two strains   | both strains cover all 9 foods                       | 2,252                |
| Two strains   | trail on 0.98 of the cells or more: the box is full  | 2,252 to 6,502       |
| Two strains   | 28,422 agents, then 11,940, then 7,583               | 2,502; 8,002; 12,002 |
| Fleeing light | the colony covers all 6 foods                        | 2,001                |
| Fleeing light | 6,620 agents, then 2,769, then 1,606                 | 2,251; 8,001; 12,001 |

In pictures the three networks of Three strains stay, wound around each other: at the steps 8,000, 20,000 and 40,000
with seed 1, and to step 20,000 with seed 7. The two networks of Two strains stay to step 40,000 (seed 1). In
Fleeing light a ring of tubes around the lamp joins the foods at step 8,000, and no tube crosses the lit disc.

**The Foraging maze with the flow**, 10 seeds, WebGPU (`measure-maze.ts`):

- The colony joins both foods in 0 of 10 seeds at step 2,000, in 3 at step 4,000 and in 10 at step 5,000.
- The trail in the dead ends over the trail of the route is 0.91 at step 5,000, 0.15 at step 10,000, 0.016 at step
  15,000 and 0.010 at step 20,000 (medians).
- The tube is 1.05 times as long as the shortest route at step 10,000, and 1.03 times at the steps 15,000 and
  20,000 (1.01 to 1.08).

**The Maze with growth**, the option that this record rejects: the Maze with growth, a Capacity of 0.25 and no random
shrinkage, 10 seeds on WebGPU, against the Maze as it is (the record of ADR 0029, 10 seeds):

| Measure, median and range of the seeds                         | The Maze            | The Maze with growth   |
| -------------------------------------------------------------- | ------------------- | ---------------------- |
| First measured step with the dead ends below 0.1 of the route  | 1,500 (1,500–2,000) | 12,500 (7,500–15,000)  |
| First measured step with the dead ends below 0.02 of the route | 2,250 (2,000–4,000) | 15,000 (10,000–15,000) |
| Seeds that reach 0.02 by step 15,000                           | 10 of 10            | 9 of 10                |
| The tube over the shortest route at step 15,000                | 1.10 (1.09–1.13)    | 1.17 (1.13–1.22)       |

On WebGL2 (3 seeds) the Maze with growth has its dead ends below 0.1 of the route at step 7,500 (5,000 to 10,000),
and its tube is 1.19 times the shortest route at step 15,000. The dead ends of the organism shrink within 4 hours,
which are 7,200 steps (`docs/fidelity.md`, row 2).

**The bytes of the scenes.** The digests of every scene after 500 steps on both backends, against those of `main`:
50 of 54 runs are equal. The 4 others are Fleeing light and the Foraging maze on each backend, the two scenes that
this record changes. The Maze, the two weaves and the seven experiments of the papers keep their bytes. The two new
scenes add 4 runs.

**The fit of the grid.** On WebGL2 with a memory hint of 0.5 GB the start scene cannot hold its lattice: three
strains have a flow each. It then runs on a grid shaped like the screen, of 512 or 256 cells on the long side, and a
notice says so (`research/electrode/fit.ts`, 6 of 3,132 cases).

**Tests.** `src/model/presets.test.ts` holds the groups, the rule set of each group, the two start scenes and the
three changed scenes. `src/model/params.test.ts` holds the lists of the scenes with growth and with the flow.
The e2e tests name the new groups and the notice of the start scene on a small device. Lint, the type check, the
unit tests with `RESEARCH=full`, the whole GPU suite and the e2e tests pass on the M3 Pro.

## Consequences

- The app starts with three colonies of about 50 agents each, in a buffer of 36,864 agents. Before, the start scene
  held 3,981,312 agents on a screen of 16:9.
- A visitor sees the first tubes after about 800 steps and three networks after about 8,000: 7 and 67 seconds at
  the default speed of 120 steps per second. The old start scene showed its weave in the first seconds.
- The two weaves and their look stay, one group down.
- Experiments no longer holds the Maze: it stands under Paper experiments, with the experiments of the papers on
  Jones' model. Its records in ADR 0029 and in `docs/fidelity.md` stay true.
- A link made before this record runs as it was made: it holds its settings, and the shapes of its revision.
- The README has a new first picture, of the new start scene.
