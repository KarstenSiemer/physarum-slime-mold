# 0025: Growth and shrinkage of the population

- Status: accepted (owner rule, 2026-11-11: every decision goes into an ADR)
- Date: 2026-11-11

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
   extended model, off in every scene. One switch, "Growth and shrinkage (Jones 2011)", in a section Growth of the
   panel, with eight values: Growth test every (Gf), Growth window (Gw), Growth minimum and maximum (Gmin, Gmax), and
   the same four for shrinkage (Sf, Sw, Smin, Smax). An interval of 0 turns its test off, so that growth or shrinkage
   can run alone. Reason: the brief and ADR 0024 (decision 1) ask for one Jones mode with each scene's values.
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
   papers' words; Jones does not state the heading, and the specifications took random as the likely choice.
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
    it, so the switch restarts nothing; the help of Capacity says that 1 gives room for an agent in every cell.
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
15 presets as the app does (`Engine.create` and `Engine.load` on a canvas of 1512 × 945, dpr 1), ran 500 steps from
seed 7 and wrote the SHA-256 of the agents (by id), the trail, the scent and `env`. Against `main` (`45155a8`):
all 16 give the digests of `main` on WebGPU, WebGL2 and WebGL2 without float blending (M3 Pro), with the settings
of the scenes and with growth off at values far from the defaults (every interval 1, windows 15 and 3, Gmax 200, Smax 0,
a capacity below the density). A temporary mutation that ran growth in every scene with the rule changed the digests
of all 10 such scenes on WebGPU and WebGL2, and none of the 6 without the rule.

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

Unit tests: `params.test.ts` (defaults, links without growth, rounding and odd windows, the rule, Capacity, `snap()`
of the windows), `pack.test.ts` (the slots, the test steps, `startEnds()`, the pyramid levels), `sizing.test.ts`,
`url.test.ts`, `state.test.ts` (the scene card, old links of every scene, dead agents with a capacity). e2e:
`ui.spec.ts` (the Growth section and the card; Capacity and Inoculate in a full scene; growth from 1 % of the cells).

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

The target of 9 of 10 seeds holds on 16:9 and 16:10 and fails on the square screen. Why, from the trail and the agents
saved every 1,000 steps (pictures in the pull request):

- The colony grows along the walls and the edges of the box. From step 3,000 on, 71 to 82 % of its agents lie within
  4 cells of a wall or an edge, which hold 7 to 9 % of the open cells (seed 1, 16:9 and 1:1). The Maze without growth
  keeps 1 % there (its full population at step 5,000): its sensors that walls block turn its agents away from the walls
  (ADR 0020). At any of the saved steps at most 2 % of the agents can divide (9 × 9 count from 1 to 10): paths of
  agents count a median of 24 to 25 agents in that window in open space and 21 to 22 near a wall, so growth happens at
  the tips of the lines. Why the tips run along the walls is not measured further.
- The top-left food lies in open space. Its rim lies 42 cells from the nearest wall or edge on 512 × 512, and 24 on
  512 × 288. Its scent falls to 1/e within 2 cells (ADR 0022), so a colony along the edges never senses it on the square
  screen, while on 16:9 a branch from the top edge reaches it.
- With the 50 agents in one clump on the 50 open cells nearest the food's centre, the square screen grows no colony at
  all: its food (radius 9.2 cells) is wider than the sensor distance of 7, so every sensor stays on the food and the
  clump stays there, with a median of 23 to 27 agents in the 9 × 9 window of an agent, above Gmax (seeds 1 and 3);
  shrinkage trims the clump to 23 to 37 agents. On 16:9 the food's radius is 5.2 cells, and agents leave it.
- The sensors that walls block (extended model) are not the cause: the Jones model, whose sensors read their own cell
  only, fails the same way (0 of 10).

These numbers are reported, not tuned away: the values of the papers stay the defaults. ADR 0024 (decision 5) gives the
coming maze scene of Adamatzky 2012 a settled attractant, which this check does not have (owner item below).

**D2: a full scene of Jones with growth on.** The Transport network (Jones 2010, Fig. 4) on 1024 × 640, 98,304
agents at the start (15 % of the cells), seeds 1 to 3, 20,000 steps:

| Capacity                    | Step 1,000       | 2,000            | 5,000            | 10,000           | 20,000           |
| --------------------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- |
| 1 agent per cell (655,360)  | 69,589 to 70,156 | 50,708 to 51,017 | 36,696 to 37,942 | 32,261 to 32,575 | 30,257 to 31,291 |
| as Agents per cell (98,304) | 63,667 to 64,304 | 47,247 to 48,803 | 35,247 to 36,093 | 30,007 to 31,887 | 29,872 to 30,952 |

The population falls from 15 % of the cells and settles at 29,900 to 33,000 agents (4.6 to 5.0 %) from step 10,000
on, with either capacity: no blow-up. Shrinkage holds the 5 × 5 counts: a median of 11 and a 95th percentile of 16 to
17 at every mark, and at most 0.1 % of the agents above 20 between two tests.

**D3: shrinkage against Jones' published effect.** Jones 2011: shrinkage "ensures that network paths between nodes
remain thin", and "new particles are created to repair the break". Shortest path (Jones 2010, Fig. 18) on 256 × 160,
512 agents at the start, capacity 1, seeds 1 to 5, 10,000 steps; at step 5,000 every agent in a stripe 8 cells wide
across the middle dies (its trail stays), and the run counts the steps until the stripe holds 80 % of its agents
again (checked every 100 steps). The counts are those of steps 5,000 and 10,000:

| Rules                          | Agents at 5,000 | Agents at 10,000 | 5 × 5 count: median, 95th, max | Above 20   | Refilled in               |
| ------------------------------ | --------------- | ---------------- | ------------------------------ | ---------- | ------------------------- |
| Growth and shrinkage (2011)    | 283 to 1,429    | 284 to 766       | 11–12, 16–18, 18–21            | 0 to 0.2 % | 200 steps in 4 of 5 seeds |
| Growth without shrinkage       | 5,342 to 6,177  | 4,918 to 5,692   | 24, 25, 25                     | 90 to 92 % | 200 steps in 5 of 5 seeds |
| Shrinkage alone                | 208 to 301      | 183 to 224       | 9–10, 13–16, 14–20             | 0 %        | 200 to 400 steps          |
| Neither (the scene as shipped) | 512             | 469 to 489       | 14–18, 21–24, 23–25            | 6 to 26 %  | 200 to 500 steps          |

Shrinkage keeps the paths thin, as Jones says: without it, growth fills the dish around the band (90 to 92 % of the
agents in a crowded window); with it almost no agent stays above 20, and the scene as shipped has 6 to 26 % of its
agents above 20. The stripe refills in 200 steps with growth in 4 of 5 seeds (in seed 3 the band moved away from the
stripe), and in 200 to 500 steps without growth, where agents walk back into the trail that stayed. A tear repairs in
both. With growth the dead agents return as children, so the population after the tear returns to what it was; with
growth off it stays 23 to 43 agents lower. Shrinkage alone (growth off) thins the band and lowers the population to 183
to 224.

**Cost** (WebGPU and WebGL2, M3 Pro shared with other users): one simulation, growth on and off in alternating blocks
of 150 steps, 8 blocks each, median ms per step, after 300 steps with growth on:

| Backend | Scene (grid, buffer, agents alive)                          | Growth off | Growth on |
| ------- | ----------------------------------------------------------- | ---------- | --------- |
| WebGPU  | Transport network, capacity 1 (1024 × 640, 655,360, 46,655) | 2.64       | 4.39      |
| WebGPU  | Maze, capacity 1 (512 × 320, 163,840, 8,375)                | 0.59       | 1.00      |
| WebGPU  | Shrinking plasmodium (512 × 320, 51,200, 2,194)             | 0.25       | 0.44      |
| WebGL2  | Transport network, capacity 1 (1024 × 640, 655,360, 46,993) | 6.29       | 9.20      |
| WebGL2  | Maze, capacity 1 (512 × 320, 163,840, 7,075)                | 0.85       | 1.26      |
| WebGL2  | Shrinking plasmodium (512 × 320, 51,200, 3,634)             | 0.52       | 0.94      |

The tests run every 3 steps; a test step costs about three times the difference. The passes over the cells and over
the buffer, dead agents included, decide the cost, not the agents alive. Growth is off in every scene.

## Open for the owner

See `TODO.md` (M2):

- The Maze from one food fails on a square screen (D1): keep the values of the papers and wait for the maze scene of
  Adamatzky 2012 with its settled attractant (ADR 0024, decision 5), or change the Maze (its food or walls in cells).
- Growth counts the agent itself, as shrinkage does, so Growth minimum 0 and 1 act the same (decision 3); a child
  gets a random heading, which Jones does not state (decision 6). Both are this branch's readings.
- Whether a scene or the default settings should hold a Capacity above Agents per cell, so that Inoculate works there
  without a change (decision 14). It changes the run of such a scene (other ids, so other random streams) and costs
  32 B per agent more.
- The scenes of the later papers (a later pull request) set their papers' values; this branch adds no scene.
