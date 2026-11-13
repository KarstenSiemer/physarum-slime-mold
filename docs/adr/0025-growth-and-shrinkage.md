# 0025: Growth and shrinkage of the population

- Status: accepted (owner rule, 2026-11-11: every decision goes into an ADR)
- Date: 2026-11-11
- Changed by ADR 0032 (2026-11-13): the start layout "At the first food" starts a colony of each strain on a food of
  its own, strain A on the first food as here, and the panel names it "On food, one colony each".

## Context

The owner saw that agents inoculated at one food of the Maze never reach the other food, no tube forms, and the margin
never grows like the real organism's. Measured on `main` (`45155a8`): in Jones 2010 nothing creates agents, so a small
group contracts and stays put. ADR 0023 says the same for the inoculate tool: "The Maze is not solved from an
inoculation: too few agents reach the far food. That needs growth." A diagnosis before this branch, a CPU model in
Python, reached the far food from 50 agents in 0 of 3 seeds without growth, and in 2 of 3 with a rough growth rule.

Jones' later papers add growth and shrinkage of the population. Read on 2026-11-11 in the author's copy of Jones 2011
(J. Jones, Influences on the formation and evolution of Physarum polycephalum inspired emergent transport networks,
Natural Computing 10: 1345–1369, Sec. 5.1, p. 1359) and in the preprints of the later papers (the specifications of
2026-11-11, section 0.2):

- "If there are between 1 and 10 particles in a 9 × 9 neighbourhood centred at the location of a particle, and the
  particle has moved forwards successfully, the particle attempts to divide into two if there is an empty location in
  the immediate neighbourhood surrounding the particle." Shrinkage: "If there are between 0 and 20 particles in [a
  5 × 5] region the particle survives, otherwise it is annihilated." Both tests run every three scheduler steps.
- "Growth and shrinkage states are iterated separately for each particle and the results for each particle are
  indicated by tagging Boolean values to the particles": both tests read the same state.
- Jones and Adamatzky 2014 (arXiv:1303.4969, Sec. 7.3) and Jones, Mayne and Adamatzky 2017 (arXiv:1511.05862,
  Sec. 7.5) name the child's cell: "a randomly selected empty location in the immediate 3 × 3 neighbourhood".
- The values differ per paper:

  | Paper                                   | Growth every | Growth window, range | Shrinkage every | Shrinkage window, range |
  | --------------------------------------- | ------------ | -------------------- | --------------- | ----------------------- |
  | Jones 2011, Sec. 5.1                    | 3            | 9 × 9, 1 to 10       | 3               | 5 × 5, 0 to 20          |
  | Jones, Mayne and Adamatzky 2017, Fig. 5 | 3            | 9 × 9, 0 to 15       | 3               | 5 × 5, 0 to 24          |
  | Jones and Adamatzky 2014 (TSP)          | 5            | 9 × 9, 1 to 10       | 10              | 9 × 9, 0 to 80          |
  | Jones 2015 (path planning)              | 10           | 9 × 9, 1 to 10       | 2               | 9 × 9, 0 to 79          |

- No paper states the child's heading, which steps run a test, or whether a growth count includes the agent itself.
  ADR 0024 (decision 6) reads the shrinkage count with the agent itself: only then can 0 to 24 of 25 cells delete one.
- One agent per cell is part of the rule: the counts and the "empty location" assume it.

The GPU runs all agents at once, and the WebGPU backend sorts its agent buffer every 32 steps, so slots are not
reproducible (ADR 0005). Growth needs agents that do not exist yet: the buffer must hold more agents than the start
population, and a child must take a free slot without a race.

## Options

How a child finds a free slot:

1. **A dead slot hashes to a candidate parent** (the brief's example). Each dead agent picks a random agent and becomes
   its child if that one qualifies and wins its cell. A qualifying parent then divides only with the chance that a
   dead agent picked it, about 1 − e^(−D/N) for D dead agents of N: 63 % in an empty buffer, 39 % at half and 10 % at
   nine tenths full. That is not Jones' rule, where every qualifying agent with an empty neighbour divides. A hash of
   slots is not deterministic on WebGPU, where the sort moves agents, so it must hash ids and look the parent up.
2. **An exact match by rank.** Every parent that wins its cell writes a birth there. The dead agent with rank r among
   the dead agents of a strain takes the birth with rank r of that strain. Ranks need prefix sums, over the cells and
   over the ids, on both backends; WebGL2 has no compute shaders.
3. **A pyramid of sums with a fan-in of 4** (a histogram pyramid): a node sums 4 nodes of the level below, up to one
   node. The rank of an element is the sum of the nodes before it at each level; the element with rank r is found
   from the top down. Both are a loop of at most 13 levels, and both backends can build it: WebGPU in compute passes,
   WebGL2 in fragment passes that read one level and write the next.

The order of the births when the dead agents run out (only with a capacity below one agent per cell):

1. Row-major order of the cells: the first births in rows from the top get the dead agents, so growth would favour the
   top of the grid.
2. **A bijection of the cells, new for every step**: a Feistel network of two rounds on the rectangle (`place()`). Each
   round adds a hash of one coordinate to the other, modulo the side, so it is exact for every grid size, needs no
   cycle walking, and gives the same order on both backends.

The capacity:

1. A start count of agents (the specifications, `startCount`), with the density as the capacity.
2. **A capacity in agents per cell** beside Agents per cell, which stays the start population. 0 stands for "as many
   as Agents per cell", so every scene and every old link keeps its buffer.

## Decision

All decisions of 2026-11-11, by this branch unless marked.

1. **Growth and shrinkage are a rule of Jones** (owner, ADR 0022, decision 1): available in the Jones model and in the
   extended model, off in every scene (since the review: but the Foraging maze, decision 30). One switch, "Growth and
   shrinkage (Jones 2011)", in a section Growth of the panel, with eight values: Growth test every (Gf), Growth
   window (Gw), Growth minimum and maximum (Gmin, Gmax), and the same four for shrinkage (Sf, Sw, Smin, Smax). An
   interval of 0 turns its test off, so that growth or shrinkage can run alone. Reason: the brief and ADR 0024
   (decision 1) ask for one Jones mode with each scene's values.
2. **The defaults are the values of Jones 2011**: 3, 9 × 9, 1 to 10; 3, 5 × 5, 0 to 20. A later scene sets its paper's
   values (table above). Reason: the brief; 2011 is the paper that introduced the rule.
3. **Both counts include the agent itself.** For shrinkage ADR 0024 decided it. For growth, Jones uses the same words
   for both windows ("particles in a … neighbourhood of a particle"), so the same count fits. Consequence: a minimum of
   0 and of 1 act the same, so the 2017 set (0 to 15) and a set of 1 to 15 are one rule. The help of Growth minimum
   says so.
4. **A test runs on the steps whose number is a multiple of its interval**, from step 0 (`growthTests()` in
   `pack.ts`). Reason: Jones gives the interval only; one rule for both backends and the CPU copy.
5. **Order within a step**: the moves and their deposits, then both tests on the occupancy after the moves.
   Shrinkage first: an agent that it deletes does not divide. A survivor divides if it moved in this step (its cell
   counts a move of its strain, which is what earns a deposit) and its growth count lies in [Gmin, Gmax]. Reason:
   Jones tags both states before he applies them; the deletion first decides the one case where both tags could hold,
   which none of the published sets can reach (a 5 × 5 count above 20 means a 9 × 9 count above 10).
6. **The child**: a random cell of the 8 around the parent that is habitable and empty after the moves (uniform among
   these), a random position in it, a random heading, the parent's strain, and no deposit in its step. Reason: the
   papers' words; Jones does not state the heading, and the specifications took random as the likely choice. Since
   the amendment of 2026-11-13 (decision 35), a diagonal cell between two wall cells that touch at the corner between
   it and the parent's cell is not among them.
7. **Two parents that pick one cell claim it** with the unique key of the step, as moves do (ADR 0008); only the
   winner gets a child there, and the loser does not divide in this step. Reason: no race and no duplicate. In
   Jones' sequential order the loser would pick another empty cell; this is the same synchronous difference as for
   moves (ADR 0008).
8. **A child takes a dead agent by rank (option 3)**: the dead agent with rank r among the dead agents of its strain,
   in the order of the ids, takes the birth with rank r of that strain, in the order of `place()`. Every qualifying
   parent that wins its cell gets a child while dead agents of its strain remain. The dead agents are the free list:
   ids stay a permutation, and an agent that shrinkage deleted in this step can be a child in the same step. Reason:
   it is Jones' rule, exact and deterministic on both backends, and option 1 would change his growth rate with the
   fill of the buffer.
9. **The order of the births is `place()`, a new bijection of the cells in every step** (option 2). Reason: when the
   dead agents run out, the births that get one spread over the grid. With a capacity of one agent per cell under the
   rule they never run out: each birth is a free habitable cell, and there are as many dead agents as free cells or
   more.
10. **The window counts come from a separable box sum** of the occupancy after the moves (`rowSums`, `windowSums`),
    recomputed on test steps only. The rectangle of the grid counts, wrapped on the periodic grid; cells outside a
    box count 0, and cells outside the dish hold no agent. A window is at most 15 cells and a grid side at least 16,
    so a periodic window never counts a cell twice.
11. **New passes are built only where they run.** `growth.wgsl` and its pipelines, and `growth.frag` and `growth.vert`
    with their programs, are built at the first step with a test. The start passes for a capacity above the start
    population are an override constant (`CAPACITY` in `init.wgsl`) and a `#define` (`init.frag`), built at their
    first use. The parameters have three slots more (`growth`, `shrinkage`, `startEnd`). Reason: ADR 0020 found that
    dead code changes float rounding; the passes without growth must keep the bytes of the code before (checked
    below).
12. **Capacity (option 2)**: "Capacity", agents per cell that the simulation holds, alive and dead, in the Growth
    section. It is at least Agents per cell (0 means as many), at most 1 with the rule, and a link carries it. The
    first agents of each strain's ids, as many as Agents per cell gives, start alive (`startEnds()`); the others wait
    dead. A change rebuilds the simulation, as a change of Agents per cell does. Switching growth on does not change
    it, so the switch restarts nothing while the growth buffers fit (decision 24); the help of Capacity says that 1
    gives room for an agent in every cell.
    Reason: the start population and the room for growth are two numbers in Jones' papers (a start of 10, 50 or 100
    agents that grows), and links and scenes keep their bytes.
13. **Growth needs one agent per cell**: `constrain()` turns it off without the rule, the panel shows the switch off and
    disabled with ": needs one agent per cell", and a notice says so when the rule goes off. Reason: the counts assume
    the rule (Jones 2011). On WebGL2 without float blending the rule is missing (ADR 0003), so growth is too; Capacity
    and the inoculate tool work there.
14. **Inoculate uses the same free slots** (ADR 0023): with a Capacity above Agents per cell a hold places agents in a
    full scene. Its notice now names Capacity first: "All agents of strain A are alive. Inoculate uses only dead
    agents. To get dead agents, set Capacity above Agents per cell, set Random shrinkage above 0, or select the start
    layout Empty. In that layout all agents are dead at the start." It shows 0.3 s per word (12.9 s).
15. **The slider Shrinkage is now "Random shrinkage"** (Jones 2010, Fig. 21). Reason: the new window shrinkage needs a
    name of its own; the link key `shrink` stays.
16. **The memory fit counts growth only while it is on**: 34 B per cell and 6 B per agent (`GROWTH_BYTES_PER_CELL`,
    `GROWTH_BYTES_PER_AGENT` in `sizing.ts`), and Capacity counts as the agents. The buffers and targets go when
    growth goes off.
17. **The alive count stays the stats' count**: the birth pass counts the agents anew on WebGPU; WebGL2 counts its
    agent texture, as before.
18. **On WebGL2 the deposits come before the tests**, so that an agent that shrinkage deletes keeps the trail of its
    move, as on WebGPU, where the settle pass deposits.
19. **For tests only**, `Sim.readWindows()` reads the window counts of the last test step, and `Simulation.create`
    and `initProgram()` take a start source as they take an agent source.

### Review of 2026-11-11

A logic review, an app review and a behaviour analysis read this branch at `92cdf10`. Each decision below is of
2026-11-11, with its reason.

20. **Capacity keeps the value set** (app review 6). `constrain()` no longer stores 0 once Agents per cell passes the
    Capacity, nor 1 under the rule: `capacityOf()` gives what the simulation holds, at least Agents per cell and at
    most 1 with the rule, and the value acts again when they change back. The slider shows `capacityOf()`; a value at
    or below Agents per cell stores 0, so a scene and its link keep 0. Its range ends at 1 while the rule is on.
    Reason: before, raising and lowering Agents per cell lost the room for growth without a word, and a typed 3 became
    1 under the rule.
21. **Each minimum stays at most its maximum, and each maximum from 1 to the cells of its window** (app review 4):
    `constrain()` for links, and slider ranges that follow the other values in the panel. Reason: Shrinkage minimum
    above maximum or Shrinkage maximum 0 deleted every agent within a few steps, and Growth minimum above maximum
    stopped growth, all without a word. The count includes the agent itself, so a maximum of 0 can never hold. Jones'
    sets keep their values.
22. **The card names only the tests that run**: "Growth and shrinkage", "Growth" or "Shrinkage by crowding", and none
    when both intervals are 0, where the section says that nothing runs (app review 4).
23. **The section says when growth has no room** (app review 3): with growth on and every agent of the simulation
    alive (the alive count of the current run), a hint says so and offers "Set Capacity to 1", which restarts the
    scene. Reason: "Agents low, Growth on" did nothing at the default Capacity, and only the help of Capacity said why.
    The button removes itself at once, so it moves the focus to Capacity, as the button of ADR 0026 moves it to the
    grid choice, and it has that button's style (added on the merge of ADR 0026).
24. **Decision 12 is corrected** (app review 7, logic review 5b): switching growth on restarts nothing as long as the
    growth buffers fit. On a device short of memory `Engine.fit()` lowers the grid for them (34 B per cell, 6 B per
    agent), and the scene restarts on the lower grid with the notice "Lowered the grid to … cells to fit this device."
    A lattice (ADR 0026) gives way to a grid shaped like the screen, with the notice of ADR 0026 ("This device cannot
    hold a lattice of … cells. …"; decision 32). Switching growth off keeps that grid, as for covered food. The help of
    Growth and shrinkage says so.
25. **The inoculate notice names the section Growth and the restart** (app review 8): "All agents of strain A are
    alive. Inoculate uses only dead agents. To get dead agents, raise Capacity in the section Growth (this restarts the
    scene), set Random shrinkage above 0, or select the start layout Empty. In that layout all agents are dead at the
    start." 47 words, 14.1 s.
26. **A number field shows the value the simulation uses** (app review 9): after a typed value the field shows the
    snapped value also when it equals the old one (a window of 8 shows 9).
27. **The notice of the rule names growth also in a scene made for the rule** (app review 10), and says that growth
    stays off after the rule comes back. Without float blending the switch reads "not available here" (app review 11).
28. **Texts** (app review 12): Learn no longer shows "a fan of fine veins" that the app does not draw, says how to see
    growth (the scene Foraging maze, or the rule, Growth and shrinkage, and Capacity or Empty with Inoculate), and
    calls the second square the shrinkage square. Learn → Controls lists the switch before its values and Capacity.
    The help of the switch says "between", that growth in a full scene only replaces what shrinkage removes, that in a
    dense scene of Jones shrinkage first removes many agents, and that the switch can lower the grid. The windows read
    "cells wide", and their help says that 9 is a square of 9 × 9 cells.
29. **The choices the code made without a record** (logic review 5):
    - a. On a test step, covered food reads the occupancy after shrinkage and the births, on other steps the occupancy
      after the moves. Reason: it is the occupancy at the end of the step, which the next step's moves also read.
    - b. See decision 24.
    - c. See decision 20.
    - d. The ranges: an interval of 0 to 100 steps covers Jones' 2 to 10 with room and 0 for off; counts of 0 to 225
      cover the largest window, 15 × 15, and the panel limits them to the window; Capacity 0.01 to 8 on a log scale is
      the range of Agents per cell. Two Feistel rounds: the CPU check of the review found a bijection on 9 grids and
      the first tenth of the positions spread 22 to 27 % into each quarter of the rows and columns; a unit test keeps
      both. The salts 4, 5 and 6 follow the streams 0 to 3 of `agents.wgsl`, so no stream of growth repeats a stream of
      the moves, the tools, random shrinkage or a blocked turn.
    - e. "Moved" is read per backend: WebGL2 reads the agent's MOVED bit of its settle pass, WebGPU whether the
      agent's cell counts a move of its strain in this step (the CPU copy follows WebGPU). Both are the same while one
      agent per cell holds: a cell counts a move only of the agent that moved into it, and an agent that stayed blocked
      in its cell holds it alone. Growth runs only with the rule, and switching the rule restarts the population, so
      two agents never share a cell.
30. **A start layout at a food, and the scene Foraging maze** (coordinator decision of 2026-11-11, values of this
    branch). The analysis showed that the Maze's sensor angle, not growth, keeps the colony on its food. The Maze stays
    as it is, byte for byte. A new scene, Foraging maze, has the Maze's walls and foods, the extended model, Jones'
    foraging angles (SA 22.5°, RA 45°), growth with the values of 2011, no random shrinkage (Jones 2011 grows and
    shrinks by the windows only), Capacity 0.25 and the new start layout "At the first food" (`'food'`): every agent
    starts dead, as with Empty, and one step of the inoculate tool (step 0) places about 50 agents (`FOOD_START`) of
    strain A on the first food of the edit list, at half the density of a full sheet: about 69 dead agents try a random
    point of a disc of 100 cells, and with the rule each cell they hit takes one. Reasons:
    - A start that the user can also skip: the layout Empty starts the same scene without its colony, so the user can
      inoculate it himself (the owner's flow, D1b).
    - Half the density, because a full disc of 52 agents lost 15 of them to the shrinkage test of its first step (5 × 5
      counts up to 25, above 20).
    - The step reuses the shipped passes of the inoculate tool, so no shader changes; the same seed gives the same
      colony.
    - Capacity 0.25: without a cap (capacity 1, seeds 1 to 3) the colony reaches at most 16,400 agents on 512 × 288,
      18,200 on 512 × 320 and 27,300 on 512 × 512, 10 to 11 % of the cells. 0.25 holds 2.2 times that, and with it the
      colony settles where it settles without a cap (D1b).
    - The layout packs as Empty for the GPU, so no pass changes.
31. **Tests of the review** (logic review 1 to 3): four growth steps in a row against the CPU copy, with more births
    than dead agents and a strain without dead agents; the spread of the births that get a dead agent, checked on the
    children, not with the CPU copy of `place()`; a unit test of `place()`'s bijection and spread; a test that each
    growth pass takes a bind group of exactly its list in `GROWTH_BINDINGS`; e2e tests that start the app once. Each
    of these tests failed under a temporary mutation of its code (listed in the pull request).

### Merge of the lattices (ADR 0026), and the checks after it

Main ran the scenes of Jones 2010 on the lattices of their figures (ADR 0026, `f81c4a3`) while this branch was open.
The merge (2026-11-11, coordinator's direction) and the checks after it add three decisions of 2026-11-11.

32. **The memory fit of a lattice counts growth and the capacity.** `fits()` in `sizing.ts`, which ADR 0026 added for
    the lattice, counts the agents that the simulation holds (`capacityCount()`) and the bytes per agent while growth
    is on (decision 16), as `fitResolution()` does. `Engine.fit()` checks a lattice with the settings that this backend
    runs: without the rule (WebGL2 without float blending) the capacity is not capped at 1, and growth is off. The
    engine rebuilds when the lattice, the grid or the capacity that runs changes, and the rebuild sizes the buffer for
    the capacity on the lattice's cells. Reason: else a lattice passes the fit with the start population and fails at
    its allocation, or the simulation holds more than the budget. ADR 0026 (decision 8) finds that a lattice of Jones
    2010 always fits the smallest budget of 32 MiB. That still holds: with growth (Capacity at most 1) 300 × 300 cells
    need 14.6 MB (124 B per cell, 90,000 agents at 38 B), and with the largest Capacity, 8 agents per cell without the
    rule, 33.0 MB on WebGL2 without float blending with covered food (111 B per cell, 720,000 agents at 32 B), below
    the 33.6 MB of 32 MiB. Since ADR 0028 (amendment of 2026-11-12) the fit counts the two coarse maps of the view,
    8 B per cell more: with growth 15.3 MB, which fits; the largest Capacity on WebGL2 without float blending with
    covered food 33.8 MB (119 B per cell), which no longer fits 32 MiB, so that one case runs on a grid shaped like
    the screen on a device of 0.25 GB. The scenes of Jones now run on their lattices, so D2, D3 and the cost were measured again
    on them (below).
33. **The test of the start colony asks for agents in the middle of its food** (`engine.gpu.test.ts`). Reason: a
    mutation that revived every dead agent on the disc (a full disc, not half the density of decision 30) passed the
    test: the shrinkage test of step 0 removed the middle and left 60 agents on the rim, inside the range of 40 to 60.
    A full disc keeps no agent within 2.8 cells of the centre; the test asks for at least 4 within 2.5.
34. **The time limits of the new tests** (ADR 0010, measured on SwiftShader on an M3 Pro): the two new hooks that
    build passes keep 180 s (at most 4.7 s), the colony test 150 s (4.6 s in the review), the test of the start colony
    150 s (7.6 s) and the start of the app in `growth.spec.ts` 150 s (32.0 s in the review). The four growth steps
    against the CPU copy go back to the default of 60 s: they take 0.2 s once the hook has built the passes. Reason:
    ADR 0010 asks for a row per longer limit, and a limit without need hides a slow test.

## Consequences

### The GPU passes

On a test step, after the moves (both backends, all with ids, so the WebGPU sort changes nothing):

1. Row sums and window sums of the occupancy (2 passes over the cells).
2. `test`: shrinkage, and each parent's claim of its neighbour (WebGL2: a fragment pass marks the parent and its
   neighbour, then a point per parent claims with MAX blending).
3. Growth steps only: `win` writes each winner's birth at `place(cell)` and every agent's dead flag (WebGL2: a point
   per winner; the agent texture is the base of the dead pyramid); then the two pyramids, one pass per level.
4. `birth`: each dead agent finds its rank and its birth; every agent counts into the occupancy and the alive count
   (WebGL2: a fragment pass for the births, then the points of the occupancy).

A step without a test runs none of them. Invariants, tested on both backends (below): one agent per cell after every
step, no agent lost or doubled, the alive count of the stats equal to the agents, the same bits in two runs and for
every sort interval.

### WebGL2 without float blending

Growth and shrinkage are off and cannot be switched on: the rule needs float blending, and so do the claims of the
parents. Capacity works: it keeps dead agents, so the inoculate tool places agents in a full scene. Random shrinkage
works as before.

### Bytes of the scenes

Offline check (not a test in the repository), as for ADR 0022: a scratch GPU test built the default settings and all
presets as the app does (`Engine.create` and `Engine.load` on a canvas of 1512 × 945, dpr 1), ran 500 steps from seed 7
and wrote the SHA-256 of the agents (by id), the trail, the scent and `env`. On the merge of ADR 0026, against `main`
(`f81c4a3`, with the lattices): the default settings and all 15 presets of `main` give the digests of `main` on WebGPU,
WebGL2 and WebGL2 without float blending (M3 Pro), with the settings of the scenes and with growth off at values far
from the defaults (every interval 1, windows 15 and 3, Gmax 200, Smax 0, a capacity below the density). Against this
branch before the merge (`8b8de97`): the 9 scenes that `main` did not change, the Foraging maze among them, keep their
digests on all three backends; the 8 scenes of Jones 2010 differ, as `main` moved them to their lattices. The Foraging
maze also gives the same steps to the far food and the same population at every mark over 15,000 steps (seed 1, 16:9
and 1:1, WebGPU), so D1b holds on the merge. Before the merge the same check against `45155a8` gave the same result
for all 16. A temporary mutation that ran growth in every scene with the rule changed the digests of all 10 such
scenes on WebGPU and WebGL2, and none of the 6 without the rule.

### Tests

GPU tests in `sim.gpu.test.ts`, on both backends, each failed under a temporary mutation of its code (listed in the
pull request):

- One step that tests growth and shrinkage against the CPU copy of the passes (`growth-reference.ts`), on the
  periodic grid with walls across both seams, in a box with walls at its edge and in a dish, with two strains: the
  window counts of every cell, every agent bit for bit, and each child in a cell that was habitable and empty after
  the moves, next to a parent of its strain that moved. A twin without growth runs the same moves.
- A colony of 40 agents in a box with a wall grows past 300 agents in 150 steps: one agent per cell, none in a wall,
  and the stats equal to the agents per strain, after every step.
- Growth every 3 steps and shrinkage every 5: agents come to life only on steps 0, 3, 6, … and die only on steps 0,
  5, 10, …
- Two runs give the same agents and trail; on WebGPU also with the agents sorted every step and never.
- With a capacity above the start population, only the first agents of each strain start, in four layouts and arenas
  with and without the rule; the inoculate tool places agents in a full scene.
- The start passes with the capacity code, at a capacity of the start population, give the agents and trail of the
  start passes with it cut out, in three layouts and arenas.
- Four growth steps in a row against the CPU copy, with more births than dead agents and a strain without dead agents
  (periodic grid, and a box with 5 dead agents of strain A).
- The births that get a dead agent spread over the grid, checked on the children, not with the CPU copy of `place()`.
- Each growth pass takes a bind group of exactly its list in `GROWTH_BINDINGS` (WebGPU).
- `engine.gpu.test.ts`: the start layout At the first food places 40 to 60 agents of strain A on distinct cells within
  5.7 cells of the bottom-right food, the same after a reset, and none with the layout Empty.

Unit tests: `params.test.ts` (defaults, links without growth, rounding and odd windows, the rule, Capacity, the limits
of the minimums and maximums, `snap()` of the windows, growth off in every scene but Foraging maze), `pack.test.ts`
(the slots, the test steps, `startEnds()`, the pyramid levels), `sizing.test.ts` (the capacity in the memory fit),
`growth-reference.test.ts` (`place()` is a bijection on 8 grid sizes, and its first tenth spreads over the quarters),
`engine-env.test.ts` (merge of ADR 0026: each byte count of growth and the capacity decides whether a lattice fits at
its own boundary, also on a backend without the rule; a new capacity rebuilds on the same lattice, and a capacity
below Agents per cell rebuilds nothing), `url.test.ts`, `state.test.ts` (the scene card, old links of every scene,
dead agents with a capacity). e2e, `growth.spec.ts`, one start of the app per test: the Growth section, the card and
the link, a field that shows 9 for 8, the hint when both tests are off; the hint without room, its Capacity and the
focus after it; Capacity and Inoculate in a full scene; the Foraging maze grows.

### Behaviour

Scratch GPU tests (not in the repository), built as the app builds the scenes (`Engine.create` and `Engine.load`),
WebGPU on an Apple M3 Pro unless marked.

**D1: the Maze from one food.** Start layout Empty, growth on with the values of 2011, the Maze's other values
unchanged (density 0.12, so the capacity is the Maze's buffer of 12 % of the cells, random shrinkage 0.0001). 50
agents at the bottom-right food: on 50 random open cells of the default brush there (18 px on the canvas: 7.2 cells
on 16:9 and 16:10, 11.5 on 1:1), as a hold of the tool places them. Every 100 steps the flood fill of ADR 0019 (open
cells whose 3 × 3 mean trail lies above the mean of open cells, 8 neighbours, from the bottom-right food) checks for a
path to the top-left food. 10 seeds per screen, 15,000 steps:

| Screen (canvas, grid)         | Values                | Seeds with a path | Step of the path, range (median) | Agents at 15,000 |
| ----------------------------- | --------------------- | ----------------- | -------------------------------- | ---------------- |
| 16:9 (1280 × 720, 512 × 288)  | 2011                  | 10 of 10          | 3,200 to 10,000 (5,350)          | 7,410 to 8,271   |
| 16:10 (1280 × 800, 512 × 320) | 2011                  | 10 of 10          | 3,300 to 6,000 (3,700)           | 7,805 to 8,666   |
| 1:1 (800 × 800, 512 × 512)    | 2011                  | 0 of 10           | none                             | 10,774 to 11,546 |
| 16:9                          | 2017 (0–15, 0–24)     | 10 of 10          | 3,000 to 6,000 (3,350)           | 11,361 to 12,465 |
| 16:10                         | 2017                  | 10 of 10          | 3,100 to 5,800 (3,450)           | 11,780 to 13,361 |
| 1:1                           | 2017                  | 1 of 10           | 5,300                            | 16,258 to 17,885 |
| 16:9                          | 2011, covered food    | 10 of 10          | 3,300 to 5,300 (4,000)           | 7,545 to 8,689   |
| 16:10                         | 2011, covered food    | 9 of 10           | 3,200 to 12,300 (3,900)          | 7,802 to 8,778   |
| 1:1                           | 2011, covered food    | 0 of 10           | none                             | 6,391 to 11,508  |
| 1:1                           | 2011, the Jones model | 0 of 10           | none                             | 10,535 to 11,755 |
| 16:9, 50 agents in one clump  | 2011                  | 10 of 10          | 3,300 to 12,200 (3,950)          | 4,407 to 8,203   |
| 16:10, 50 agents in one clump | 2011                  | 9 of 10           | 3,200 to 13,500 (6,000)          | 1,339 to 8,633   |
| 1:1, 50 agents in one clump   | 2011                  | 0 of 10           | none                             | 27 to 32         |

The population over time with the values of 2011 (median of 10 seeds; 50 at step 0):

| Screen | Step 500 | 1,000 | 2,000 | 5,000 | 10,000 | 15,000 | Buffer |
| ------ | -------- | ----- | ----- | ----- | ------ | ------ | ------ |
| 16:9   | 485      | 807   | 1,787 | 4,360 | 7,568  | 7,835  | 17,695 |
| 16:10  | 552      | 1,019 | 2,810 | 6,955 | 8,183  | 8,263  | 19,661 |
| 1:1    | 408      | 697   | 1,686 | 5,680 | 10,934 | 11,316 | 31,457 |

It settles below the buffer, at about 8,000 agents on the wide screens and 11,300 on the square one.

WebGL2 (the same check, the same seeds): 9 of 10 on 16:9 (3,300 to 10,000, median 5,200; seed 6 had 4,665 agents at
step 15,000 and no path), 10 of 10 on 16:10 (3,400 to 8,900, median 5,300), 0 of 10 on 1:1 (10,647 to 11,800 agents at
step 15,000). Its claim keys differ from WebGPU's (ADR 0008), so the runs differ.

The target of 9 of 10 seeds holds on 16:9 and 16:10 and fails on the square screen. The first reading of this branch
(kept below as history) blamed the far food's distance from the walls. A behaviour analysis of 2026-11-11 (a second
agent, with variants of the code; the review of this branch) found the causes, and they replace that reading:

- **The passes on 16:9 and 16:10 rest on the walls.** The diffusion then (before ADR 0027) took the 3 × 3 mean over
  habitable cells only, so
  a wall or a closed edge reflects the trail (`diffuse.wgsl`, the mean over open neighbours; ADR 0007; both models).
  Jones absorbs the chemoattractant at the edges ("absorbed at the edges", Jones 2011, p. 1353) and runs the mean at
  every lattice site (2014, 2015, 2017). Beside a wall the trail at the agents is 7.4 to 7.6, far from walls 5.5 to
  5.9. The colony then grows along the walls: at step 15,000, 71 % (16:9) and 80 % (1:1) of the agents lie within 4
  cells of a wall or an edge (median of 10 seeds; 7 % of the open cells). With walls and edges that absorb, the share
  falls to 10 % and the Maze passes on 16:9 in 4 of 10 seeds; with Jones' mean at every site, 30 to 33 % and 9 of 10.
  So the 10 of 10 on the wide screens is the coat along the top edge, which passes 24 cells from the far food.
- **The square screen fails on the sensor angle.** The Maze turns with SA 45° and RA 45°, Jones' minimising angles.
  Jones forages with SA 22.5° (Jones 2011, Sec. 3.2, p. 1355: "When SA was low (11.25–22.5°) fine branching networks
  were formed"; Jones, Mayne and Adamatzky 2017, Table 1, Fig. 5). At SA 45° a few unbranched tips run straight until a
  wall turns them. With SA 22.5° and nothing else changed, the check passes in 10 of 10 seeds on 16:9, 16:10 and 1:1,
  on WebGPU and WebGL2 (median steps 2,800 to 3,950), a clump of 50 agents grows too, and 37 to 41 % of the agents lie
  near a wall.
- **The colony does not miss the food because no scent is there, but because its own trail is stronger.** The food's
  scent beyond its rim is 36.6 at the rim, 12.8 at 2 cells, 1.97 at 5, 0.58 at 7 (the sensor distance), 0.094 at 10.
  The trail of the colony under its sensors is 5 to 8. An agent beside the far food weighs its own trail above the
  scent, so it turns to the food only when a sensor lies on it.
- The growth and shrinkage rules match the papers; the analysis found no other difference.

This branch changes neither the diffusion nor the Maze. The owner decided on 2026-11-11 that Jones' corrections hold
for both models. Asked whether Jones' order of a step, walls that absorb the trail and Jones' dish size also apply to
the extended model, he answered "Ja, beide Modelle" (yes, both models). A separate fidelity pull request, in progress,
brings them to both models: Jones' order of a step (move and deposit, then sense, then diffuse); closed edges that
absorb the trail in both models; inner walls that are lattice sites of the diffusion in the Jones model and sinks in
the extended model; and a dish of 0.945 of the short side. That pull request measures the Maze (SA 45°) with growth
again. It also changes the diffusion under the Foraging maze (the extended model, a closed box, inner walls), so D1b
holds for the diffusion of this branch and needs a new measurement after it. A new scene uses Jones' foraging angle
(decision 30, D1b below).

Amendment (2026-11-12, ADR 0027): the fidelity pull request measured the Maze (SA 45°) with growth again (ADR 0027,
Measurements, "Growth after the merge of ADR 0025"). With walls and edges that take in the trail the colony no longer
coats the walls: 6 to 18 % of its agents lie within 4 cells of one at step 15,000, against 71 to 80 % here. It reaches
the far food on 16:9 in 4 to 9 of 10 seeds and on 1:1 in 0 to 3 of 10, in either order of a step and on both backends.
The square screen still fails on the sensor angle, as above.

History, the first reading (2026-11-11, before the analysis): the colony grows along the walls and the edges of the
box (71 to 82 % of its agents within 4 cells of them from step 3,000 on, seed 1, 16:9 and 1:1; without growth 1 %); at
any saved step at most 2 % of the agents can divide (9 × 9 count from 1 to 10; median 24 to 25 in open space and 21 to
22 near a wall), so growth happens at the tips; the far food's rim lies 42 cells from the nearest wall or edge on
512 × 512 and 24 on 512 × 288; with 50 agents in one clump on the 50 open cells nearest the food's centre, the square
screen grows no colony (its food, radius 9.2 cells, is wider than the sensor distance 7; median 9 × 9 count 23 to 27,
above Gmax; shrinkage trims the clump to 23 to 37 agents); the Jones model fails the same way. "Never senses it" was
wrong: the scent is there, the colony's own trail outweighs it.

**D1b: the Foraging maze** (decision 30). The scene as it ships: the Maze's walls and foods, the extended model, SA
22.5°, RA 45°, sensor distance 7, food weight 0.03, growth with the values of 2011, no random shrinkage, Capacity 0.25
and the start layout At the first food. Seeds 1 to 10 per screen, 15,000 steps, the flood fill of D1 every 100 steps.
Three flows: "start" is the scene as it loads; "inoculate at 100" and "at 1,000" are the owner's flow: the same scene
with the start layout Empty, and from step 100 or 1,000 a hold of Inoculate on the bottom-right food for 1 s (60
frames at 60 Hz, 2 steps a frame, the default brush of 18 px), through `Engine.agentTool()` and `Engine.frame()` as
the app does. Steps count from step 0.

| Backend | Flow               | Screen (grid)     | Seeds with a path | Step of the path, range (median) | Agents at the start, or placed | Agents at 15,000 (buffer) |
| ------- | ------------------ | ----------------- | ----------------- | -------------------------------- | ------------------------------ | ------------------------- |
| WebGPU  | start              | 16:9 (512 × 288)  | 10 of 10          | 2,401 to 3,401 (2,801)           | 44 to 62                       | 15,646 to 16,698 (36,864) |
| WebGPU  | start              | 16:10 (512 × 320) | 10 of 10          | 2,401 to 3,401 (2,751)           | 44 to 63                       | 16,119 to 17,930 (40,960) |
| WebGPU  | start              | 1:1 (512 × 512)   | 10 of 10          | 3,301 to 4,101 (3,901)           | 42 to 66                       | 25,866 to 27,534 (65,536) |
| WebGPU  | inoculate at 100   | 16:9              | 10 of 10          | 2,620 to 3,320 (2,920)           | 130 to 312                     | 15,311 to 16,829          |
| WebGPU  | inoculate at 100   | 16:10             | 10 of 10          | 2,820 to 3,720 (3,170)           | 151 to 356                     | 16,514 to 17,778          |
| WebGPU  | inoculate at 100   | 1:1               | 10 of 10          | 3,420 to 4,420 (3,920)           | 253 to 588                     | 25,158 to 26,857          |
| WebGPU  | inoculate at 1,000 | 16:9              | 10 of 10          | 3,420 to 4,420 (4,070)           | 109 to 372                     | 14,990 to 16,751          |
| WebGPU  | inoculate at 1,000 | 16:10             | 10 of 10          | 3,520 to 4,220 (3,920)           | 134 to 343                     | 16,278 to 18,109          |
| WebGPU  | inoculate at 1,000 | 1:1               | 10 of 10          | 4,320 to 5,620 (5,120)           | 301 to 423                     | 24,755 to 26,530          |
| WebGL2  | start              | 16:9              | 10 of 10          | 2,401 to 3,201 (2,851)           | 44 to 62                       | 15,388 to 16,321          |
| WebGL2  | start              | 16:10             | 10 of 10          | 2,701 to 3,301 (2,951)           | 44 to 63                       | 16,936 to 18,142          |
| WebGL2  | start              | 1:1               | 10 of 10          | 3,401 to 4,301 (3,901)           | 42 to 66                       | 25,412 to 26,447          |
| WebGL2  | inoculate at 100   | 16:9              | 10 of 10          | 2,520 to 3,320 (3,020)           | 86 to 411                      | 15,705 to 16,996          |
| WebGL2  | inoculate at 100   | 16:10             | 10 of 10          | 2,820 to 3,520 (3,320)           | 141 to 308                     | 16,496 to 18,068          |
| WebGL2  | inoculate at 100   | 1:1               | 10 of 10          | 3,820 to 4,420 (4,070)           | 256 to 475                     | 25,288 to 27,228          |
| WebGL2  | inoculate at 1,000 | 16:9              | 10 of 10          | 3,620 to 4,220 (4,020)           | 99 to 370                      | 15,433 to 17,001          |
| WebGL2  | inoculate at 1,000 | 16:10             | 10 of 10          | 3,420 to 4,420 (3,920)           | 114 to 316                     | 16,685 to 18,065          |
| WebGL2  | inoculate at 1,000 | 1:1               | 10 of 10          | 4,620 to 5,620 (4,870)           | 228 to 498                     | 25,634 to 26,947          |

Every flow reaches the far food in 10 of 10 seeds on every screen and both backends, the target of 9 of 10 met. The
population over time in the start flow (median of 10 seeds, WebGPU; WebGL2 within 6 % of it from step 1,000 on):

| Screen | Step 500 | 1,000 | 2,000  | 3,000  | 5,000  | 10,000 | 15,000 | Highest at a mark, of the buffer |
| ------ | -------- | ----- | ------ | ------ | ------ | ------ | ------ | -------------------------------- |
| 16:9   | 2,218    | 5,867 | 12,212 | 16,154 | 15,989 | 15,994 | 15,906 | 17,003, 46 %                     |
| 16:10  | 2,410    | 6,236 | 12,744 | 17,538 | 17,398 | 17,319 | 17,283 | 18,529, 45 %                     |
| 1:1    | 1,820    | 4,706 | 13,438 | 21,880 | 26,268 | 26,462 | 26,294 | 27,534, 42 %                     |

The colony fills the maze with a mesh. At step 15,000 it holds 9.4 to 11.5 % of the cells (all flows), and at no mark
more than 47 % of its buffer, as without a cap (decision 30): the cap does not shape it. Images of seed 1 on 16:9 and
1:1 at steps 500 to 15,000 are in the pull request.

Amendment (2026-11-12, ADR 0027): measured again with Jones' order of a step, Jones' dish and the walls of ADR 0027, and
in the order that senses first, which it ships with since 2026-11-12 (ADR 0027, decision 24): every flow reaches the far
food in 10 of 10 seeds on every screen, on both backends and in both orders, with 33 to 39 % of the agents near a wall
(ADR 0027, Measurements).

**D2: a full scene of Jones with growth on.** The Transport network (Jones 2010, Fig. 4) on its lattice of 200 × 200
cells (ADR 0026), 6,000 agents at the start (15 % of the cells), seeds 1 to 3, 20,000 steps (measured again on the
merge of ADR 0026):

| Capacity                   | Step 1,000     | 2,000          | 5,000          | 10,000         | 20,000         |
| -------------------------- | -------------- | -------------- | -------------- | -------------- | -------------- |
| 1 agent per cell (40,000)  | 4,091 to 4,457 | 3,005 to 3,225 | 1,980 to 2,241 | 1,638 to 2,243 | 1,932 to 2,242 |
| as Agents per cell (6,000) | 3,686 to 3,960 | 2,606 to 3,108 | 2,184 to 2,321 | 1,635 to 1,877 | 1,688 to 2,036 |

The population falls from 15 % of the cells and stays at 1,384 to 2,290 agents (3.5 to 5.7 %) from step 10,000 on
(steps 10,000, 15,000 and 20,000), with either capacity: no blow-up. Shrinkage holds the 5 × 5 counts: a median of 10
to 11 and a 95th percentile of 15 to 17 at every mark, and at most 0.2 % of the agents above 20 between two tests.
History: on 1024 × 640 with 98,304 agents at the start (before the merge) it stayed at 27,900 to 33,000 agents (4.3 to
5.0 %; the first version of this record said 29,900, which left out step 15,000).

**D3: shrinkage against Jones' published effect.** Jones 2011: shrinkage "ensures that network paths between nodes
remain thin", and "new particles are created to repair the break". Shortest path (Jones 2010, Fig. 18) on its lattice
of 200 × 200 cells, 800 agents at the start, capacity 1, seeds 1 to 5, 10,000 steps; at step 5,000 every agent in a
stripe 8 cells wide across the middle dies (its trail stays), and the run counts the steps until the stripe holds 80 %
of its agents again (checked every 100 steps). The counts are those of steps 5,000 and 10,000 (measured again on the
merge of ADR 0026):

| Rules                          | Agents at 5,000 | Agents at 10,000 | 5 × 5 count: median, 95th, max | Above 20   | Refilled in                         |
| ------------------------------ | --------------- | ---------------- | ------------------------------ | ---------- | ----------------------------------- |
| Growth and shrinkage (2011)    | 313 to 336      | 320 to 374       | 11–12, 16–18, 19–20            | 0 %        | 200 steps in 5 of 5 seeds           |
| Growth without shrinkage       | 8,908 to 9,784  | 8,537 to 9,196   | 23–24, 25, 25                  | 85 to 93 % | 200 steps in 4 of 5 seeds, 300 in 1 |
| Shrinkage alone                | 248 to 293      | 207 to 236       | 8–10, 13–16, 14–19             | 0 %        | 200 to 300 steps                    |
| Neither (the scene as shipped) | 800             | 737 to 746       | 15–19, 23–25, 25               | 16 to 42 % | 200 to 500 steps                    |

Shrinkage keeps the paths thin, as Jones says: without it, growth fills the dish around the band (85 to 93 % of the
agents in a crowded window); with it no agent stays above 20 at these steps, and the scene as shipped has 16 to 42 % of
its agents above 20. The stripe refills in 200 steps with growth in every seed, and in 200 to 500 steps without
growth, where agents walk back into the trail that stayed. A tear repairs in both. With growth the dead agents return
as children, so the population after the tear returns to what it was; with growth off it stays 54 to 63 agents lower.
Shrinkage alone (growth off) thins the band and lowers the population to 207 to 236. History: on 256 × 160 with 512
agents (before the merge) the table gave the same picture: 0 to 0.2 % above 20 with both rules, 90 to 92 % with growth
alone, 6 to 26 % in the scene as shipped, and a refill in 200 steps in 4 of 5 seeds with growth (in seed 3 the band
moved away from the stripe).

**Cost** (WebGPU and WebGL2, M3 Pro shared with other users, measured again on the merge of ADR 0026, two runs): one
simulation, growth on and off in alternating blocks of 150 steps, 8 blocks each, median ms per step, after 300 steps
with growth on; the range of the two runs:

| Backend | Scene (grid, buffer, agents alive)                       | Growth off     | Growth on      |
| ------- | -------------------------------------------------------- | -------------- | -------------- |
| WebGPU  | Transport network, capacity 1 (200 × 200, 40,000, 3,014) | 0.079 to 0.093 | 0.177          |
| WebGPU  | Maze, capacity 1 (512 × 320, 163,840, 8,375)             | 0.300 to 0.315 | 0.515 to 0.529 |
| WebGPU  | Shrinking plasmodium (300 × 300, 45,000, 2,067)          | 0.097          | 0.195 to 0.211 |
| WebGPU  | Foraging maze (512 × 320, 40,960, 11,654)                | 0.229 to 0.233 | 0.361 to 0.373 |
| WebGL2  | Transport network, capacity 1 (200 × 200, 40,000, 2,921) | 0.262 to 0.267 | 0.553 to 0.556 |
| WebGL2  | Maze, capacity 1 (512 × 320, 163,840, 7,075)             | 0.609 to 0.636 | 0.865 to 0.871 |
| WebGL2  | Shrinking plasmodium (300 × 300, 45,000, 2,027)          | 0.262 to 0.277 | 0.589 to 0.594 |
| WebGL2  | Foraging maze (512 × 320, 40,960, 11,844)                | 0.384 to 0.385 | 0.603 to 0.612 |

The tests run every 3 steps; a test step costs about three times the difference. The passes over the cells and over
the buffer, dead agents included, decide the cost, not the agents alive. Growth is on only in the Foraging maze, where
it costs about 0.13 ms per step on WebGPU and 0.22 ms on WebGL2. History: the first measurement, on 1024 × 640 for the
Transport network and 512 × 320 for the Shrinking plasmodium under more load, gave 2.64 / 4.39 ms (WebGPU) and 6.29 /
9.20 ms (WebGL2) for the Transport network, and 0.59 / 1.00 and 0.85 / 1.26 ms for the Maze, which the merge does not
change: its rows differ by the load of the machine.

## Open for the owner

See `TODO.md` (M2):

- Decided on 2026-11-11, no longer open: the Maze with growth from one food passes on the wide screens only along its
  walls and fails on a square screen (D1), because the diffusion reflects the trail at walls where Jones absorbs it,
  and SA 45° is Jones' minimising angle. The owner decided that Jones' corrections hold for both models ("Ja, beide
  Modelle", yes, both models). The fidelity pull request brings them to both models and measured both scenes again
  (ADR 0027, 2026-11-12): the Foraging maze reaches the far food in 10 of 10 seeds in every flow, on every screen and
  both backends; the Maze (SA 45°) no longer coats its walls and passes on 16:9 in 4 to 9 of 10 seeds and on 1:1 in 0
  to 3 of 10.
- Growth counts the agent itself, as shrinkage does, so Growth minimum 0 and 1 act the same (decision 3); a child
  gets a random heading, which Jones does not state (decision 6). Both are this branch's readings.
- Whether a scene or the default settings should hold a Capacity above Agents per cell, so that Inoculate works there
  without a change (decision 14). It changes the run of such a scene (other ids, so other random streams) and costs
  32 B per agent more (54 B on WebGL2 since ADR 0028, decision 14).
- The scenes of the later papers (a later pull request) set their papers' values; this branch adds one scene, the
  Foraging maze (decision 30).

## Amendment 2026-11-13: the Tokyo scene grows too

Decision 1 and the list of unit tests name the Foraging maze as the only scene with growth on. Since ADR 0029 (pull
request #44) the Tokyo rail network has growth on as well: its colony grows out from Tokyo (`src/model/presets.ts`;
`params.test.ts`, "keeps growth off in every scene but Foraging maze and Tokyo"). The rules of growth are in
[model.md](../model.md), section 9.

## Amendment 2026-11-13: no child between two walls that touch at a corner

**The gap.** The code reading for [model.md](../model.md) (the specification of the model, pull request #49) found
that decision 6 lets a child land in a diagonal neighbour between two wall cells that touch at the corner between the
two cells. A move cannot go there: it counts both cells beside a grid corner that it passes within 0.001 cells
(`clearPath` and `CORNER` in `agents.wgsl` and `agents.frag`; ADR 0019, "Wall jumps"), and every other way into the
diagonal cell crosses one of the two walls. So a line of single wall cells that touch only at their corners stops the
agents but not their children. Jones' papers do not say how a child treats the corner of a wall.

**Reproduced first.** The GPU test "places no child across the corner of a wall" (`sim.gpu.test.ts`, both backends):
wall cells that touch only at their corners, one diagonal line in a box of 32 × 32 cells and two on the periodic grid,
which part the torus into two bands. A colony starts on one side, with growth in every step, for 30 steps. On `main`
(`7d3a5ee`) 459 (WebGPU, box), 480 (WebGPU, periodic grid), 496 (WebGL2, box) and 480 (WebGL2, periodic grid) agents
lie on the other side. A move cannot get there, so each one is a child that a parent placed across a corner, or a
descendant of one. With the fix the other side holds no agent, and the colony still grows on its own side.

35. **A diagonal neighbour is free only if the two cells beside the corner between it and the parent's cell are not
    both walls.** Reason: the child then goes only where a move from the parent's cell can go. With one wall beside
    the corner, a move from a position in the parent's cell reaches the diagonal cell through the free cell beside the
    corner, as the plasmodium flows around the corner of an obstacle. With two walls no move can. The rule picks a
    cell, not a position: the child gets its position later, from the dead agent that takes the birth (decision 8, the
    stream `BIRTH`). A cell outside a box or the dish is no wall here, as for a move (`wallIn` in `agents.wgsl`). The
    other rules of decision 6 stay. My choice under the owner's delegation of 2026-11-12, after a first version of
    this branch with the second option below. The options:
    - Two walls block, one does not (chosen). No scene holds two wall cells that touch at a corner with open cells on
      both sides of it (`research/corner/walls.gpu.test.ts`: 0 such pairs in every scene on 16:9, 16:10 and 1:1), so
      every scene keeps its bytes (below). The rule acts where a person paints such walls.
    - Either wall blocks (the brief's proposal, and the first version of this branch): the way from the centre of the
      parent's cell to the centre of the diagonal cell passes exactly through the corner, and the move rule blocks a
      segment there if either cell beside the corner is a wall. Rejected. That part of the move rule serves the
      rounding of float32: a walk exactly at a corner may enter either cell, so each one must block ("counts both
      cells beside a corner the move passes, in every diagonal direction"). It is a rule for one segment and not for a
      cell: a move from another position in the parent's cell passes the corner of one wall cell through the free
      cell. And the option changes both scenes with growth at the corners of their walls (18 to 23 in the Foraging
      maze, 815 on the coast of the Tokyo rail network): measured below, it slows the start of the Tokyo colony, and it
      moves the steps of the Foraging maze within the spread of the seeds. It closes no gap that the chosen option
      leaves open.
    - The way from the parent's position to the child's position, with the walk of a move: the child's position would
      have to be drawn in the pass `test`, before the births are matched to dead agents. That changes the random
      streams of every scene with growth, also where no wall is near. Rejected.
36. **One loop with two masks of bits.** `divideInto()` in `growth.wgsl`, `target()` in `growth.frag` and `growthStep()`
    in `growth-reference.ts` read the 8 neighbours once into a mask of the free cells and a mask of the walls, then
    take out each diagonal cell whose two cells beside the corner are walls, then pick. The code before read every
    neighbour twice (once to count, once to pick). Without such a pair of walls the free cells and their order are
    those of the code before, so the pick is the same. `aroundIndex()` (`growth.wgsl`, `growth.glsl`) is the inverse
    of `around()`.

The tests:

- The GPU test above fails on `main` and passes with the fix, on both backends.
- A unit test of the CPU copy (`growth-reference.test.ts`, "the child at the corner of a wall"): a parent whose only
  free cell is a diagonal one. Past the corner of one wall cell the child goes there; between two wall cells no child
  comes. With the rejected option in the CPU copy the first case fails, without a corner rule the second.
- "divide and die as the CPU copy of the passes does" has, with walls, single wall cells that touch only at their
  corners where the colony grows: a diagonal line across the seam of the periodic grid and from the edge of the box,
  and a lattice of diamonds. 10 to 11 dividing agents then have an empty diagonal neighbour between two walls, and 16
  to 18 one past the corner of one wall cell; the test asks for both. It also checks that each child has a parent
  that moved and is not between two walls from it. The GPU equals the CPU copy on both backends. A check by hand: the
  CPU copy without a corner rule, and the CPU copy with the rejected option, each fail all 4 cases with walls. On
  `main` the test fails on both backends: children whose only parents lie across a gap.
- The whole GPU suite passes (844 tests, M3 Pro).

The time of a step does not change. With the chosen rule the scenes run the states of `main` (the same agents alive),
so their times compare: `research/flow/engine/bench.gpu.test.ts`, the median of 21 samples of 50 steps after 3,000
steps, two runs of each version in turn, `main` at `e3bbefc`. The Foraging maze as it ships: 0.352 and 0.356 ms on
`main`, 0.354 and 0.356 ms with the rule (WebGPU); 0.736 and 0.758 against 0.750 and 0.756 ms (WebGL2). The Tokyo
rail network: 3.204 and 3.204 against 3.186 and 3.224 ms (WebGPU); 3.684 and 3.686 against 3.692 and 3.708 ms
(WebGL2). The differences lie within those between two runs of one version. The machine ran other work at the time.

### Measurements of the amendment

The record and its commands are in [research/corner](../../research/corner/README.md) (M3 Pro, Chromium, Metal).
`main` is `7d3a5ee`; the chosen rule is this branch with `main` of 2026-11-13 merged in (pull requests #48 and #50);
the rejected option is `91907bc`, the first version of this branch, measured before that merge. With the rejected
option, the merge gives the bytes of `91907bc` at step 3,000 in both scenes with growth, on both backends.

**Bytes, with the chosen rule.** The digests of `research/flow/engine/digest.gpu.test.ts` (the agents, the trail, the
scent and the environment; the default settings and 17 scenes on both backends, from seed 12345) equal those of
`main` in 36 of 36 runs after 500 steps, and in the Foraging maze and the Tokyo rail network after 15,000 steps on
both backends. This follows from the walls too: the rule differs from the code before only between two
wall cells that touch at a corner, and no scene has such a pair. So the numbers of D1b, of ADR 0027 and of ADR 0029
hold with the chosen rule, and `docs/fidelity.md` keeps its numbers. Pull request #53 added three scenes, among them
Tokyo rivals with growth and the coast of the Tokyo map. After its merge all 20 scenes hold 0 such pairs, and after
3,000 steps the digests of the three new scenes, the Foraging maze and the Tokyo rail network equal those of `main`
(`a37c2b5`) on both backends.

**Bytes, with the rejected option.** After 500 steps 33 of 36 digests equal those of `main`. The other three are the
two scenes with growth: the Foraging maze on WebGPU, and the Tokyo rail network on both backends. Then both scenes
ran with the seeds of their records.

**The Foraging maze, with the rejected option** (D1b, the harness of ADR 0027 "Growth after the merge of ADR 0025",
sensing first as the scene ships; seeds 1 to 10 per screen, 15,000 steps; WebGPU). On `main` the harness gives the
lines of the record of ADR 0027 byte for byte, so the column `main` is that table's column "Sense first".

| Backend | Flow               | Screen | `main`: path, steps (median)                    | Near a wall | Either blocks: path, steps (median) | Near a wall | Agents at 15,000: `main` | Either blocks    |
| ------- | ------------------ | ------ | ----------------------------------------------- | ----------- | ----------------------------------- | ----------- | ------------------------ | ---------------- |
| WebGPU  | start              | 16:9   | 10 of 10, 2,501 to 3,901 (3,251)                | 38 %        | 10 of 10, 2,901 to 4,001 (3,151)    | 37 %        | 15,827 to 16,434         | 15,597 to 17,023 |
| WebGPU  | start              | 16:10  | 10 of 10, 2,601 to 3,601 (3,401)                | 37 %        | 10 of 10, 2,701 to 3,901 (3,301)    | 37 %        | 16,337 to 18,783         | 17,224 to 17,914 |
| WebGPU  | start              | 1:1    | 10 of 10 (at 15,000: 9), 4,201 to 5,401 (4,551) | 34 %        | 10 of 10, 3,901 to 6,201 (4,301)    | 33 %        | 25,043 to 27,209         | 24,783 to 26,856 |
| WebGPU  | inoculate at 100   | 16:9   | 10 of 10, 2,920 to 4,020 (3,370)                | 37 %        | 10 of 10, 3,320 to 4,820 (3,470)    | 37 %        | 15,989 to 17,066         | 15,199 to 17,053 |
| WebGPU  | inoculate at 100   | 16:10  | 10 of 10, 3,220 to 4,320 (3,620)                | 37 %        | 10 of 10, 2,920 to 4,720 (3,770)    | 36 %        | 16,531 to 18,569         | 17,215 to 18,089 |
| WebGPU  | inoculate at 100   | 1:1    | 10 of 10, 4,020 to 6,020 (4,870)                | 33 %        | 10 of 10, 4,120 to 5,120 (4,570)    | 33 %        | 25,316 to 27,786         | 25,445 to 27,140 |
| WebGPU  | inoculate at 1,000 | 16:9   | 10 of 10, 4,220 to 5,020 (4,520)                | 38 %        | 10 of 10, 3,820 to 5,220 (4,570)    | 37 %        | 15,375 to 16,737         | 15,607 to 16,888 |
| WebGPU  | inoculate at 1,000 | 16:10  | 10 of 10, 3,820 to 5,220 (4,520)                | 36 %        | 10 of 10, 3,820 to 5,120 (4,420)    | 37 %        | 16,492 to 18,334         | 16,731 to 18,557 |
| WebGPU  | inoculate at 1,000 | 1:1    | 10 of 10, 4,820 to 6,920 (5,870)                | 34 %        | 10 of 10, 5,020 to 6,220 (5,470)    | 33 %        | 25,391 to 27,195         | 25,066 to 27,610 |

Every flow still reaches the far food in 10 of 10 seeds. The medians move by −400 to +150 steps, within the spread of
the seeds. The runs on WebGL2 were stopped once the chosen rule kept every byte: 16 of the 30 runs of the start flow
had run, all with a path (10 of 10 on 16:9, 6 of 6 on 16:10), and the lines of `main` among them equal the record of
ADR 0027.

**The Tokyo rail network, with the rejected option** (ADR 0029, "The Tokyo rail network": flux 1.4, seeds 1 to 10 on
WebGPU, measured on the 33 food sources of Tero et al. 2010, Fig. 2; median and range over the seeds). The record is
the table of ADR 0029.

| Step   | Code     | All 33 joined | All 36 joined | Links           | TL                  | MD                  | FT                  | Agents alive           |
| ------ | -------- | ------------- | ------------- | --------------- | ------------------- | ------------------- | ------------------- | ---------------------- |
| 1,000  | record   | 5 of 10       | 0 of 10       | 64.5 (49 to 71) | 2.12 (1.72 to 2.32) | 0.87 (0.84 to 0.90) | 0.91 (0.86 to 0.92) | 6,427 (5,558 to 6,998) |
| 1,000  | rejected | 1 of 10       | 0 of 10       | 54.5 (45 to 70) | 1.96 (1.78 to 2.34) | 0.86 (0.83 to 0.90) | 0.92 (0.84 to 0.96) | 5,701 (5,125 to 6,785) |
| 2,000  | record   | 10 of 10      | 10 of 10      | 80.5 (72 to 92) | 2.73 (2.56 to 2.85) | 0.83 (0.82 to 0.90) | 0.97 (0.94 to 0.99) | 6,312 (5,951 to 6,724) |
| 2,000  | rejected | 10 of 10      | 10 of 10      | 82.5 (75 to 98) | 2.73 (2.63 to 2.93) | 0.82 (0.81 to 0.83) | 0.97 (0.94 to 0.99) | 6,530 (6,326 to 6,797) |
| 8,000  | record   | 10 of 10      | 10 of 10      | 61.5 (55 to 71) | 2.05 (1.87 to 2.28) | 0.82 (0.81 to 0.84) | 0.95 (0.90 to 0.96) | 4,272 (4,096 to 4,603) |
| 8,000  | rejected | 10 of 10      | 10 of 10      | 63 (54 to 84)   | 2.08 (1.90 to 2.41) | 0.82 (0.80 to 0.84) | 0.94 (0.89 to 0.96) | 4,318 (4,159 to 4,723) |
| 24,000 | record   | 10 of 10      | 9 of 10       | 53 (47 to 60)   | 1.77 (1.63 to 1.99) | 0.82 (0.81 to 0.84) | 0.92 (0.85 to 0.95) | 3,936 (3,736 to 4,205) |
| 24,000 | rejected | 10 of 10      | 10 of 10      | 53 (48 to 63)   | 1.84 (1.66 to 2.05) | 0.82 (0.80 to 0.84) | 0.93 (0.86 to 0.94) | 3,917 (3,742 to 4,303) |
| 48,000 | record   | 10 of 10      | 8 of 10       | 53 (45 to 65)   | 1.77 (1.51 to 1.98) | 0.83 (0.81 to 0.91) | 0.91 (0.78 to 0.96) | 4,003 (3,697 to 4,229) |
| 48,000 | rejected | 10 of 10      | 8 of 10       | 51.5 (46 to 62) | 1.73 (1.60 to 1.97) | 0.83 (0.81 to 0.91) | 0.89 (0.81 to 0.94) | 3,928 (3,658 to 4,136) |

At step 48,000, mean and standard deviation: TL 1.75 ± 0.12, MD 0.84 ± 0.03 and FT 0.88 ± 0.04 with the rejected
option, against 1.77 ± 0.15, 0.84 ± 0.03 and 0.90 ± 0.05 in the record. The check of the specification (TL from 1.45
to 2.05 and MD from 0.77 to 0.93 in 7 of 10 seeds, FT at least 0.66) holds in 10 of 10 seeds at steps 24,000 and
48,000, as in the record. The one change beyond the spread of the seeds is the start: at step 1,000 the colony has
11 % fewer agents (median) and joins all 33 food sources in 1 seed of 10, against 5. Its children can no longer pass
the 815 corners of the coast. From step 2,000 on the numbers lie within the spread of the record.
