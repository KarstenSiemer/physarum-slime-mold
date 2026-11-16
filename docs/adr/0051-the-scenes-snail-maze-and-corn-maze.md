# 0051: The scenes Snail maze and Corn maze

- Status: accepted (the owner asked for the two scenes on 2026-11-15 and 2026-11-16; the choices below are those of a
  helper, 2026-11-16, under the owner's delegation of 2026-11-12), built 2026-11-16
- Date: 2026-11-16
- Uses ADR 0025 (growth), ADR 0029 (the flow in the tubes) and ADR 0032 (the foraging colony with the flow).
- Extended by ADR 0053 (2026-11-16): the two scenes measured again with its rule, and why the colony comes back into
  the blind branches.

## Context

The owner wrote two mazes into `TODO.md` on 2026-11-15 and said on 2026-11-16: "now do the two mazes."

- A snail maze: a spiral with one route, ring corridors, one gap per ring wall, blind branches, no loop.
- A corn maze: a grid of corridors with loops, so that routes of different lengths join two foods.

Both use the extended model with growth and the flow. The Maze (ADR 0029) has one route only, so it does not show a
choice between routes (`docs/fidelity.md`, row 5). The corn maze tests that choice.

No rule of the model changes. No shader changes. Every scene of before keeps its bytes: the pull request adds two
scenes and changes none.

## Decision

Two scenes in the group Experiments, both "Made for this app". The walls are the app's own design.

**The settings of both.** `forager()` of ADR 0032 with closed box edges: Jones' foraging agent (sensor angle 22.5°,
rotation angle 45°, sensor distance 7), growth and shrinkage with Jones' values of 2011, a start on the first food, food
weight 0.03, capacity 0.25, and the flow with the strength 8, the default of the app and the strength of the Maze.

**The walls of both.** A wall is 5.5 cells wide (`MAZE_WALL`), so a wall along a line of the lattice covers 6 cells and
the centre of no cell lies near its edge. A corridor is 40 cells from wall centre to wall centre, 34 cells open. Both
scenes have a lattice, so a corridor has this width on every screen.

**Snail maze** (`snail-maze`, 384 × 384 cells, `snailShapes()` in `src/model/presets.ts`).

- Five ring walls around the middle, with the radii 28, 68, 108, 148 and 188 cells. The outermost is closed. Each ring
  is a chain of straight walls of at most 16 cells. The scene has 213 shapes: 211 walls and 2 foods.
- Each other ring wall has one gap of 30 cells, on the right and on the left in turns.
- A bar closes each of the four ring corridors a quarter turn past the gap of its inner wall. So a corridor has one way
  from its outer gap to its inner gap, half a turn long, and two blind branches of a quarter turn each.
- The first food lies in the outermost corridor, half a turn from the first gap. The second food lies in the middle.
- The shortest route is 1,285 cells long.

**Corn maze** (`corn-maze`, 480 × 320 cells, `CORN_MAZE` in `src/model/presets.ts`).

- 12 × 8 rooms of 40 cells. The first food lies in the top-left room, the second in the bottom-right room.
- `research/flow/engine/corn-maze.ts` made the walls. It walks from the entrance to a random room that has no door yet,
  and steps back at a dead end: a maze without loops. Then it takes 7 walls away at random. The random numbers come
  from a seed.
- The seed is 8: the first seed whose maze has 3 to 8 routes from the entrance to the exit, one shortest route, and 3
  or more dead ends. A route enters no room twice.
- The maze of seed 8 has six routes of 26, 28, 30, 34, 36 and 40 rooms and seven dead ends beside the entrance. In cells
  the routes are 711 cells and 1.07, 1.06, 1.19, 1.34 and 1.47 times as long.
- The scene holds the 42 walls as a fixed list. `research/flow/research.test.ts` checks that the generator gives this
  list for seed 8, and that no seed below 8 fits.

## What was tried

- **The flow strength**: 2, 4 and 8, seed 1, 30,000 steps (`logs/engine/mazes/*-strength.txt`; 8 is seed 1 of the
  campaign). With 2 the flow memory never reached one half along the whole shortest route of the Corn maze, and the
  tube was broken in 15 % of the last dumps. With 2 the Snail maze joined its foods 2,000 steps later. With 4 the
  shortest route of the Corn maze alone carried flow from step 8,000 on, with 8 from step 5,000 on; the rest was alike.
  So the scenes keep the default, 8. One seed does not tell 4 from 8 for sure.
- **The lattice and the corridor**: one size only, 40 cells per corridor. It worked at the first try, so no other width
  was measured. The Maze's corridors are 128 cells wide; nobody measured the narrowest corridor that still holds a tube.
- **The number of walls taken away**: 7 only. It is a free choice.

## Results

One campaign: seeds 1 to 10 on WebGPU and seeds 1 and 2 on WebGL2, 30,000 steps, a dump every 500 steps (M3 Pro,
2026-11-16, 45 to 62 s per run). `research/flow/engine/measure-mazes.ts` gives the numbers; the record is
`logs/engine/mazes/` in the archive of `research/flow/`.

The campaign ran on `main` at `9dad09b`, before the rule Light stops growth (ADR 0050) came into `main`. Seed 1 of
each maze ran again on WebGPU with that rule in the code (`main` at `7f8ef64`): every line of both runs equals the
record. The mazes hold no light.

The measures are those of the Maze (`research/flow/prototype/maze.ts`). A tube is the cells with a trail above twice
the mean trail of the open cells. A dead end is every cell from which the way from food to food is 120 cells or more
longer than the shortest route. "The tail" is the 20 dumps of the last 10,000 steps.

The colony keeps growing short branches into empty corridors and losing them again. So one dump says little, and the
tables give means over the tail.

### Snail maze

| Seed | Joined at step | Tube over the route | Tube cells on the route | Trail of a blind branch over the route's | Branches below 0.10 | Flow memory of a blind branch over the route's |
| ---- | -------------- | ------------------- | ----------------------- | ---------------------------------------- | ------------------- | ---------------------------------------------- |
| 1    | 9,500          | 1.00                | 0.86                    | 0.14 to 0.23                             | 0 of 6              | at most 0.008                                  |
| 2    | 9,000          | 1.01                | 0.87                    | 0.11 to 0.26                             | 0 of 6              | at most 0.009                                  |
| 3    | 8,500          | 1.01                | 0.88                    | 0.04 to 0.26                             | 1 of 6              | at most 0.015                                  |
| 4    | 9,500          | 1.01                | 0.88                    | 0.12 to 0.20                             | 0 of 6              | at most 0.007                                  |
| 5    | 8,500          | 1.01                | 0.88                    | 0.09 to 0.21                             | 1 of 6              | at most 0.007                                  |
| 6    | 8,000          | 1.01                | 0.88                    | 0.09 to 0.23                             | 1 of 6              | at most 0.012                                  |
| 7    | 9,000          | 1.01                | 0.84                    | 0.14 to 0.36                             | 0 of 6              | at most 0.018                                  |
| 8    | 9,000          | 1.01                | 0.87                    | 0.13 to 0.23                             | 0 of 6              | at most 0.013                                  |
| 9    | 9,500          | 1.01                | 0.86                    | 0.11 to 0.21                             | 0 of 6              | at most 0.009                                  |
| 10   | 7,500          | 1.00                | 0.86                    | 0.13 to 0.22                             | 0 of 6              | at most 0.009                                  |

- **The step at which the colony joins both foods**: 7,500 to 9,500, the median is 9,000. From then on the tube joins
  the foods in every dump of the tail, in 10 of 10 runs.
- **Does every dead end empty?** No. By the Maze's measure a dead end is empty below 10 % of the route's trail. Over
  the tail, 3 of 60 blind branches are below it; the others hold 11 to 36 %. Every blind branch was below 10 % at the
  same time in 6 of 200 dumps. The flow does leave the blind branches: their flow memory is at most 1.8 % of the
  route's. What stays is growth: the colony grows new branches into the empty corridors, and they die again.
- **Does the last tube follow the one route?** Yes. The way through the tube is 1.00 to 1.01 times the shortest route,
  and 84 to 88 % of the cells of the tube lie on the route. The rest are the short branches.
- Six of the eight blind branches are measured. The two of the innermost corridor are 75 cells long, and a dead end of
  the Maze's measure starts 60 cells off the route.
- WebGL2, seeds 1 and 2: joined at 9,000 and 8,500, tube 1.00 and 1.01, blind branches 0.13 to 0.26, none below 0.10.

### Corn maze

"Tube on a route" is the share of the dumps of the tail in which a tube crosses every door of the route. A route
"carries flow" when the flow memory is above one half at every door of it.

| Seed | Joined at step | Only the shortest route carries flow from step | Tube over the shortest route | Tube on the route of 28 rooms | of 30 rooms | of 34 rooms | of 36 or 40 rooms | Only the shortest holds a tube |
| ---- | -------------- | ---------------------------------------------- | ---------------------------- | ----------------------------- | ----------- | ----------- | ----------------- | ------------------------------ |
| 1    | 3,000          | 5,000                                          | 1.00                         | 0.10                          | 0.05        | 0           | 0                 | 0.85                           |
| 2    | 3,500          | 5,500                                          | 1.02                         | 0.20                          | 0.10        | 0           | 0                 | 0.70                           |
| 3    | 4,000          | 5,000                                          | 1.02                         | 0.25                          | 0.10        | 0           | 0                 | 0.65                           |
| 4    | 4,000          | 5,500                                          | 1.02                         | 0.15                          | 0.20        | 0           | 0.05 (36)         | 0.65                           |
| 5    | 3,500          | 4,500                                          | 1.01                         | 0.10                          | 0.10        | 0           | 0                 | 0.80                           |
| 6    | 3,500          | 6,000                                          | 1.02                         | 0.25                          | 0.35        | 0.05        | 0                 | 0.45                           |
| 7    | 4,500          | 5,500                                          | 1.02                         | 0.10                          | 0.05        | 0           | 0                 | 0.85                           |
| 8    | 4,000          | 5,000                                          | 1.01                         | 0.10                          | 0.20        | 0           | 0                 | 0.70                           |
| 9    | 3,500          | 4,000                                          | 1.02                         | 0.05                          | 0.30        | 0.05        | 0                 | 0.70                           |
| 10   | 3,000          | 4,500                                          | 1.01                         | 0.20                          | 0.35        | 0.05        | 0                 | 0.50                           |

- **Which routes hold a tube at the end?** The shortest route holds a tube in every dump of the tail, in 10 of 10
  runs. The way through the tube is 1.00 to 1.02 times the shortest route. The shortest route alone holds a tube in
  137 of the 200 dumps. In the others a tube also crosses the route of 28 rooms (1.07 times as long) or of 30 rooms
  (1.06 times), which leave the shortest route for two or three rooms. The routes of 34, 36 and 40 rooms (1.19 times
  and more) hold a tube in 4 of 200 dumps.
- **The flow keeps the shortest route.** In all 600 dumps of the ten runs, no route but the shortest carries flow from
  end to end. The shortest carries it from step 4,000 to 6,000 on, in every later dump.
- **How long do the other routes take to starve?** By the flow: 500 to 2,500 steps after the colony joins the foods
  (the median is 1,250), the shortest route alone carries flow. Before that no route carries it from end to end. By
  the trail: they never starve for good. A side route of two or three rooms comes back as a short branch that meets
  the tube again. At step 30,000 a tube crosses 33 to 74 of the 102 doors; the route needs 26.
- WebGL2, seeds 1 and 2: joined at 4,000, the shortest alone carries flow from 5,000 and 5,500, tube 1.02 and 1.01.

### Against the organism

Nakagaki, Yamada and Tóth 2000 report that the organism kept the shortest route of a maze, and the rule of Tero,
Kobayashi and Nakagaki 2007 predicts it. In the Corn maze the flow of the app does so in 10 of 10 runs: the shortest
of six routes alone carries the flow. The picture is less clean than the claim: with growth on, the colony never
stops exploring, so thin branches beside the tube stay. Nobody read the paper of 2000 for this project, so this record
does not compare numbers with it (`docs/fidelity.md`, row 5).

## Consequences

- The app has a maze with a choice between routes. `docs/fidelity.md`, row 5, names it.
- A scene with growth and the flow does not reach the clean end of the Maze, where the dead ends fall below 1 % of
  the route's trail. Its dead ends thin out and stay at 10 to 40 %. The texts of the two scenes say so.
- The two scenes add no e2e test that waits for steps (ADR 0049). The unit tests hold their settings and lattices.
- The record of the runs is 6 files in `logs/engine/mazes/`; the archive of `research/flow/` now holds 256 logs.

## Open points

- Why growth comes back into corridors that the flow has left was not studied. Decision 19 of ADR 0029 keeps starved
  ground closed for about 33,000 steps, which is longer than these runs. A rule that stops growth there would be a
  change of the model, so it is the owner's decision.
- Other layouts: only seed 8 of the generator and one snail were measured. A maze whose routes differ by less than
  6 % was not tried.
- The narrowest corridor that still holds a tube was not measured.
