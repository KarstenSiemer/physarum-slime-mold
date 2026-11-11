# 0024: Scenes from later papers and from experiments

- Status: accepted
- Date: 2026-11-11

## Context

The owner compared the app with the real organism on 2026-11-11: agents barely react to food, a
Maze started from one point never reaches the other food, tubes do not thicken, and the margin
never looks like a tree crown. Jones 2010 has a fixed population, no flow and a food scent that
reaches about 2 cells. Jones' later papers and other experiments add what is missing: growth and
shrinkage of the population (Jones 2011), food that stops projecting once covered (Adamatzky and
Jones 2010, Jones and Adamatzky 2014), flow-based reinforcement of tubes (Tero et al. 2007, 2010).

The owner set two rules for new scenes: a scene honours its paper, and the scenes of Jones' papers
behave exactly as in those papers. A model switch separates Jones' rules from this app's additions
(ADR 0022). New scenes follow from the specifications of 2026-11-11: the Tokyo rail network (Tero
et al. 2010), foraging in an H-shaped light mask (Jones, Mayne and Adamatzky 2017, Fig. 5), the
travelling salesman tour of a shrinking blob (Jones and Adamatzky 2014), path planning around
obstacles (Jones 2015), proximity graphs (Jones 2011, Fig. 13), and a maze solved from one point
(Adamatzky 2012).

The specifications found facts that force decisions:

- Jones' later papers use the same mechanisms with different values: the growth and shrinkage
  windows, thresholds and intervals, the diffusion kernel (3 × 3, 5 × 5 or 7 × 7) and the factor
  for covered food (× 0.01 in 2014, × 0.001 in the road paper of 2010) differ between papers.
- When the front sensor reads the least, an agent turns at random in 2010 and toward the larger
  side in 2014 to 2017.
- The published shrinkage windows (0 to 24 of 25 cells, 0 to 80 of 81) delete an agent only if the
  agent counts itself.
- Jones 2017 dampens light by 0.9; applied to the agent's reading as a whole it changes no turn.
- Jones' lengths are in cells, and his lattices are fixed (200, 300, 400 × 150 cells). This app's
  Jones scenes use 512 cells on the long side, so the arena has 512 × 288 cells on a 16:9 screen,
  512 × 512 on a square one and 236 × 512 on a phone. The pattern keeps its size in cells, so the
  same scene shows more or fewer meshes with the screen and the chosen grid.
- The supplement of Tero et al. 2010 gives no city list or coordinates. Fig. 1 shows 36 food
  sources, Fig. 2 and the statistics use 33.
- The maze of Adamatzky 2012 needs an attractant that has spread through all corridors. Live, that
  takes about 200,000 steps on 512 × 320 cells, about 28 minutes at 120 steps per second.

## Decision

1. **One Jones mode for all of Jones' rules** (owner, 2026-11-11). It holds every mechanism of his
   papers, not one switch per paper. Each scene sets the values of its own paper. Every default is
   the behaviour of 2010, so the shipped scenes keep their bytes.
2. **The turn rule is a setting of each scene** (owner, 2026-11-11). The default is random, as
   in 2010. Scenes of the papers of 2014 to 2017 turn toward the larger side.
3. **A scene of Jones' papers runs on the lattice of its paper** (owner, 2026-11-11), for the
   shipped scenes too. The owner first kept every scene on a grid that grows with the screen, then
   asked whether results should not stay comparable. Only the paper's lattice gives the paper's
   result: Jones' lengths are in cells, and scaling every length with the grid is not his model,
   because diffusion acts over one cell per step. The arena keeps its cells on every screen and
   fits the screen with free space beside it. The grid stays a setting: when the user picks another
   size, the scene says why its result then differs from the paper and which lattice Jones used.
   The app's own scenes (the start scene, the Maze, Three strains) keep a grid that grows with the
   screen.
4. **Tokyo keeps north up** (owner, 2026-11-11). Its frame does not turn by 90° on a tall screen
   (ADR 0019 turns the others); a tall screen shows free space above and below the map.
5. **The maze of Adamatzky 2012 starts with a settled scent** (owner, 2026-11-11). The app computes
   the steady state of the attractant at load with the same diffusion, so the scene starts where
   the live run would arrive after about 28 minutes.
6. **A shrinkage window counts the agent itself.** Only this reading lets the published
   thresholds delete an agent.
7. **Light in Jones 2017 dampens each sensor** that lies on a lit cell or within its 3 × 3
   neighbourhood by 0.9. Only this reading changes what an agent does.
8. **Tokyo has the 36 food sources of Fig. 1** and of the text, where the organism found them. Its
   check computes cost, transport efficiency and fault tolerance on the 33 sources of Fig. 2, as
   the paper does, so the numbers compare with it.
9. **Map data comes from reusable sources only:** the coastline from OpenStreetMap (ODbL, with
   attribution), heights from SRTM (public domain).
10. **The scent can be shown** (owner, 2026-11-11). A switch in the view draws the food scent and
    the light's repellent. It changes nothing in the simulation.

Items 6 to 9 are this app's readings where the papers leave a choice; each scene's text names the
paper's values and these readings.

## Consequences

- A scene of a later paper needs the mechanisms of that paper first: growth and shrinkage, covered
  food and the turn rule in the Jones mode; flow reinforcement in the extended mode.
- A faithful Tokyo network needs flow reinforcement (Tero et al. 2007). Without it, the scene shows
  Jones' method on Tero's map, and its text says so.
- North-up and the settled scent are per-scene properties that other scenes do not have.
- The shipped Jones scenes change once they move to their papers' lattices: their bytes differ
  from today, and their cells look larger on a large screen.
