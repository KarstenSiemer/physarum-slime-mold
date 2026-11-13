# 0029: Flow in the tubes

- Status: accepted. The owner decided on 2026-11-12 that the flow is an option of the extended model
  that is off by default (decision 1). Every other decision here is the coordinator's choice under
  the owner's delegation of 2026-11-12, with its date and reason.
- Date: 2026-11-12

## Context

Step 4 of the owner's plan of 2026-11-11: tubes that carry much flow get thicker, and tubes with
little flow decay. In the real slime mould this gives the shortest tube in a maze (Nakagaki, Yamada
and Tóth 2000) and the network of the Tokyo experiment (Tero et al. 2010). Jones' agent model has no
flow (Jones 2015, Sec. 3: the population stands for the structure and the flux; no flux is computed).

Measured before this change, on a CPU copy of the Maze scene (512 × 320 cells, 10 seeds; the trail
in the corridor of the shortest route over the trail in the dead ends): 1.35 at step 1,000, 1.19 at
step 5,000 and 1.35 (1.26 to 1.57) at step 15,000. The dead ends never fall below 10 % of the
route. The Maze's own text said so: "it has no flow that thickens the shortest one".

What the papers give is in `docs/knowledge-base/flow-in-the-tubes.md`, with the section of each
fact. The parts that this decision uses:

- **The flux model** (Tero, Kobayashi and Nakagaki 2006, Eq. 1 to 5; 2007, Eq. 1 to 6): a tube has a
  conductivity D and a length L, and the flux is Q = D (p_i − p_j) / L. Kirchhoff's law holds at
  every node; one food source gives the flux I0 and another takes it. D adapts: dD/dt = f(|Q|) − D.
  A dead end has Q = 0, so its D falls as exp(−t) (2007, Sec. 5.1).
- **The network model** (Tero et al. 2010, p. 441): at each time step a random pair of food sources
  gives and takes I0, and f(Q) = Q^γ / (1 + Q^γ), with I0 = 2 and γ = 1.8 as typical values. The
  paper measures a network by its total length TL, its mean shortest distance MD and its fault
  tolerance FT, each over the value of the minimum spanning tree (p. 440).
- **A local alternative** (Ma et al. 2013, Eq. 2.4 to 2.16): particles walk on the network, their
  number on a node is the potential, and the flow of a step reinforces the conductivity. Its mean
  field is Tero's model.
- **Time scales of the organism**: the three facts of the owner's plan hold. The contractions have
  a period of about two minutes (Tero et al. 2007, Sec. 2; Marbach et al. 2023: 1 to 2 min). Veins
  "typically vanish over 15 min to 40 min", they answer with a delay of 1 to 3 min and adapt within
  10 to 100 min (Marbach et al. 2023). After food, the tube diameters reorganise "within about
  15 min" (Kramar and Alim 2021, Results; read by a helper in the copy at PubMed Central, not in
  the PDF).

Constraints: the Jones model holds only Jones' rules (ADR 0022). With the flow off, every scene
keeps its bytes. Both backends run the same rule, and a run is the same for the same seed.

## Options

1. **Tero's model with an exact pressure solve.** The pressure of every step is the solution of a
   linear system over all cells of the network. Tero et al. use a conjugate gradient method with an
   incomplete Cholesky preconditioner (2007, Sec. 3.3). That preconditioner is a chain of dependent
   steps and does not run in parallel on a GPU.
2. **Tero's model with a local pressure solver.** A few Jacobi iterations per step, started from the
   pressure of the step before. Each iteration is one pass over the grid: a stencil of five cells,
   as the diffusion pass.
3. **Current-reinforced random walks** (Ma et al. 2013). Walkers carry the flux; no pressure solve.
4. **No flux field: scale the deposit or the survival by a local measure**, such as the agent count
   or the age of the trail. No paper gives such a rule, and it cannot tell a dead end from a route:
   both look the same from inside.

## The prototype

A CPU prototype on the grid of the app (TypeScript, a copy of the agent model with the Maze's rules;
not bit-equal to the GPU) ran options 1 to 3 against each other. It is not in the repository; its
numbers are below. Tero's ring (2007, Sec. 5.2: two tubes of length 10 and 16 between two nodes)
checked the three solvers first: all give D1 = 0.9297 and D2 = 0.1419 for μ = 0.8, the equilibrium
of the paper, and (1, 0) for μ = 1.

### The pressure on a fixed network

The Maze's network at step 1,000 of seed 1, with I0 = 2 between its two foods:

| Solver                                                        | Result                                             |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Exact (conjugate gradients, modified incomplete Cholesky)     | 443 to 490 iterations per solve (Jacobi: 3,102)    |
| Local: damped Jacobi, second-order Richardson, radius 0.99999 | 5 % error after 4,150 iterations from a cold start |
| The same with radius 0.9999 and 0.999999                      | 5 % error after 14,140 and 5,110 iterations        |
| Local: plain Jacobi                                           | 40 % error after 400,000 iterations                |
| Ma's walkers (Eq. 2.16; 2,000 new walkers per step, dt 0.8)   | 88.8 % error after 150,000 steps; none at the sink |

The exact flux through the tube cells of the route's corridor is 0.083 per cell, and 0.0049 in the
dead ends: a ratio of 17. On the moving network the exact flux changes by 0.35 % per step. The
local solver with 16 iterations per step follows it within about 2 % (7 % at 300 steps after a cold
start), when the conductivity changes slowly and every open cell conducts a little (decisions 4
and 6).

Ma's walk on a grid is Tero's model with a slow pressure solver: the mean field of Eq. 2.16 with a
time step of 1 is one weighted Jacobi iteration of Tero's Poisson equation per step. The walkers add
sampling noise to it. The Maze's route is about 700 cells long, and a diffusion over 700 cells needs
in the order of 700² steps.

### (a) The Maze: the route against the dead ends

The Maze scene on the CPU copy, 10 seeds each, the flow from step 500 on. "Ratio": trail in the
route's corridor over trail in the dead ends. "Below 10 %" and "below 2 %": the first step at which
the trail of the dead ends is below that share of the route's; median and range over the seeds.
"Tube": the length of the tube over the shortest route at step 10,000.

| Rule                              | Ratio at 2,500 | Ratio at 5,000 | Below 10 % at step     | Below 2 % at step      | Joined   | Tube |
| --------------------------------- | -------------- | -------------- | ---------------------- | ---------------------- | -------- | ---- |
| No flow (Jones)                   | 1.45           | 1.19           | never                  | never                  | 10 of 10 | 1.21 |
| Tero, exact solve every 8 steps   | 14.9           | 62             | 2,250 (2,250 to 2,500) | 4,875 (4,750 to 6,250) | 10 of 10 | 1.13 |
| Tero, local solver, 8 iterations  | 3.2            | 37             | 3,250 (2,750 to 4,500) | 5,625 (4,750 to 8,000) | 10 of 10 | 1.16 |
| Tero, local solver, 16 iterations | 12.2           | 85             | 2,500 (2,500 to 3,250) | 4,375 (2,750 to 6,750) | 10 of 10 | 1.13 |
| Tero, local solver, 32 iterations | 21.6           | 1,960          | 2,250 (2,250 to 2,500) | 3,625 (3,000 to 8,250) | 10 of 10 | 1.13 |
| Ma's walkers                      | 5.8            | (no network)   | (no network)           | (no network)           | 0 of 10  | none |

With Ma's walkers the flux never reaches the far food, every tube starves, and 78 agents (63 to 97)
of 19,661 live at step 2,500: the foods are not joined in any seed. The local solver with 16
iterations ends where the exact solve ends, within the spread of the seeds; 8 iterations are slower,
and 32 gain little. These runs held the two foods at fixed pressures and scaled the flux to I0.
With a fixed flux at each food, as in the app (decision 5), the prototype gave, for 16, 8 and 32
iterations: below 10 % at step 2,125, 2,250 and 2,250 (each 2,000 to 2,250), below 2 % at step
3,625, 3,125 and 3,000, and a ratio of 28, 23 and 30 at step 2,500, in 10 of 10 seeds each.

### (b) A layout like Tokyo: 36 food sources

The Tokyo map (decision 12) on 400 × 400 cells, the land full of agents at the start (the second
protocol of Tero et al. 2010, p. 439), the flow from step 500 on. The measures are those of the
paper (p. 440) on the 33 food sources of its Fig. 2: the trail above 1.5 as the network, thinned to
lines; a link is a line between two junctions or food sources.

| Rule (flux 8 per food site)             | Seeds | Agents alive at step 2,000 | Joined of 33, steps 2,000 to 7,000 | TL           | MD           | FT           |
| --------------------------------------- | ----- | -------------------------- | ---------------------------------- | ------------ | ------------ | ------------ |
| Tero, local solver, all sites at once   | 2     | 3,947 and 4,013 of 5,293   | 33, but 28 at one of 6 steps each  | 1.41 to 1.67 | 0.83 to 0.90 | 0.75 to 0.93 |
| Ma's walkers                            | 3     | 147 to 160                 | 1 (no network), in 3 of 3 seeds    | none         | none         | none         |
| The organism (Tero et al. 2010, p. 440) | 21    |                            | all                                | 1.75 ± 0.30  | 0.85 ± 0.04  | 0.80 to 0.86 |

With Ma's walkers the network dies here too: 57 to 94 agents live from step 3,000 on. With Tero's
rule a flux of 4 gives a tree within 5,000 steps (TL 1.05 to 1.13, FT 0 to 0.43, one seed), and a
flux of 8 a network with loops: more flux keeps more links, as in the supplement of the paper
(Fig. S1). In this protocol some food sources lose their last tube for a time (28 of 33 joined at
single steps), and a run with a flux of 4 loses up to 8. The app's Tokyo scene does not start
from a full sheet; its results are below.

### (c) The cost on the GPU

Measured for the rule as built (decision 3), in the real engine on an M3 Pro (Chromium with Metal,
2026-11-13, commit `92a63e7`, no other load): the median time of a step over 21 batches of 50
steps, after 3,000 steps. Two runs agree within 0.02 ms.

| Scene                  | Backend | Without the flow | With the flow | The flow     |
| ---------------------- | ------- | ---------------- | ------------- | ------------ |
| Maze, 512 × 320 cells  | WebGPU  | 0.17 ms          | 1.66 ms       | 1.49 ms more |
| Maze, 512 × 320 cells  | WebGL2  | 0.33 ms          | 2.04 ms       | 1.71 ms more |
| Tokyo, 512 × 512 cells | WebGPU  | 0.36 ms          | 2.64 ms       | 2.28 ms more |
| Tokyo, 512 × 512 cells | WebGL2  | 0.64 ms          | 3.11 ms       | 2.47 ms more |

The cost follows the cells: about 9 ns per cell and step on WebGPU and 9 to 10 ns on WebGL2, for
the update and the 16 pressure passes.

Ma's walk was not built for the GPU, because it failed in (a) and (b). So its cost is an estimate
and not a measurement: a step of the walk is one pass over the walkers, one pass that counts them
per cell and one pass over the grid for the conductivity. The agents of these scenes take the same
three kinds of pass, and a whole step of them takes 0.2 to 0.6 ms. So with about as many walkers as
agents, a step of the walk would cost a tenth to a quarter of a step of the local solver. That does
not help it: on the fixed network it had not carried the flux to the sink after 150,000 steps.

## Decision

1. **The flow is an option of the extended model, off by default** (owner, 2026-11-12). The switch
   "Flow in the tubes" and the setting "Flow strength" are in a section Flow of the panel, in the
   extended model only. The Jones model never runs it: `constrain()` binds the switch to off there,
   and `flowOn()` checks the model again in the simulation. With the switch off, every scene keeps
   its bytes (decision 13 and the checks below).

2. **Tero's flux model, not Ma's walk.** Reason: the measurements above. On this grid the walk does
   not carry a flux over the length of a route within the life of a tube, and its mean field is
   Tero's model with a slower solver.

3. **A local pressure solver with 16 iterations per step.** Reason: it is one stencil pass over the
   grid, as the diffusion, so it runs on both backends; the exact solve has no parallel
   preconditioner. In the Maze it ends where the exact solve ends (table (a)). The iteration is a
   damped Jacobi iteration (weight 0.9) with the acceleration of a second-order Richardson
   iteration: p ← ω (p + 0.9 (p\* − p)) + (1 − ω) p_before, where p\* solves Kirchhoff's law of the
   cell for the pressures of its neighbours, and ω = 2 / (1 + √(1 − r²)) for the spectral radius
   r = 0.99999. That radius reached 5 % error first (table above). The pressure of a step starts
   from the pressure of the step before, and keeps the pressure of the iteration before as momentum.
   Only a cell that conducts takes the momentum (ω); a cell without a tube takes the plain damped
   iteration (decision 6).

   Kirchhoff's law fixes the pressure only up to a constant. So the first two iterations of a step
   take the pressure of one cell off the whole field: the centre of the first site that gives or
   takes, a cell of the network. The first version took the first site of the list. A review of
   2026-11-13 found its fault: that site can lie under a wall, and a closed cell holds no pressure,
   so nothing was taken off. In the CPU copy with four covered sites, one of them not joined to the
   others, the mean pressure of the network then went to −2.9 · 10⁴ in 3,000 steps, and the flux of
   a cell was up to 2.8 % of the largest flux off. With the cell of the first site that gives or
   takes, the mean pressure is 18 after 6,000 steps, whatever the first site of the list is.

4. **The network is the grid.** Every open cell is a node, and two cells that share a side are
   joined by an edge. A cell has a conductivity g = B (0.02 + D): B is the tube body, the trail of
   all strains smoothed over time (rate 0.02 per step; presence from 0.2 to 1 deposits of strain A;
   no tube below B = 0.05), and D is the flow memory, Tero's conductivity, from 0 to 1. The base
   0.02 lets a new tube carry a first flux. A food cell with a tube has g = 4 B, so the flux of a
   site spreads over its food before it enters the tubes. The conductance of an edge is the
   harmonic mean of its two cells, two half cells in series. Reason: the app has no graph of tubes;
   the trail is the plasmodium. The slow body keeps the conductivity from changing faster than the
   solver follows.

5. **Every covered food site gives or takes the flux at once, and as many give as take.** A site
   is the centre cell of a food stroke (at most 64 sites; with more foods, sites spread evenly over
   the list). The plasmodium covers a site while its centre cell holds a tube (B ≥ 0.05). Four
   pressure fields run side by side, each with its own roles. Two covered sites: the first gives I0
   and the other takes it, always; a new draw could only swap them, which gives the same flux in
   every tube and a pressure that has to settle again. Three or more: a hash of the site, the
   field, the seed and the time orders the covered sites; the first half gives, the second half
   takes, and with an odd count the last one rests. The order is new every 300 steps, the fields
   75 steps apart. The `update` pass draws the roles on the GPU, because only the GPU knows which
   sites are covered; `flowRoles()` in `flow.ts` is the same rule for the tests. While fewer than
   two sites are covered, no cell adapts: the flow memory keeps its values, so no cell becomes a
   starved cell. The agents still follow the memory that they find (decision 8). On fresh ground
   (D = 0.2) the chance to starve is 0.005 % per step: without growth, half of a colony that has no
   flux is gone after 13,900 steps, 7.7 h of model time. Rejected on 2026-11-13, after a review
   found that an earlier text said "nothing starves": no starvation at all until a flux runs. The
   agent passes would need to know whether a flux runs, and the agents would stop following the
   memory when a flux ends, for example when the user removes a food.
   Rejected, with the prototype on the Tokyo layout: (a) one random pair per step, as in Tero et
   al. 2010: the local solver cannot follow a new pair at every step, and with a pair held for 300
   steps each tube carries flux only part of the time, so the network starves; (b) a fixed
   pressure at each site in place of a fixed flux: two sites close together then exchange almost
   all of the flux, and far sites get none; (c) roles drawn among all food sites on the CPU, as
   the first version of the app did: see decision 6.

6. **Four rules keep the pressure bounded.** The first version of the app let the pressure of the
   Tokyo scene run away while the colony grew: about ±4 · 10⁶ on the tubes at step 250, up to
   10¹⁸ at step 1,000, and back to ±450 only at step 4,000, when the growth had ended (flux 1,
   seed 1, WebGPU). The flux was above 3 on every tube cell from step 500 to 2,000, so f was 1,
   the flow memory went to 1 on the whole colony, and dead agents came to life everywhere: the land
   filled with a sheet of agents that the model does not give. The Maze, with two covered foods and
   no growth, did not show it. The CPU mirror of the passes reproduced it (a growing mesh with four
   foods: 7 · 10⁷ at step 300 and 3 · 10²³ at step 500). The causes and the rules against them:

   - **A food without a tube does not conduct.** Before, every food cell had g = 4. A food that
     the colony had not reached yet then held a pressure of its own behind the tiny conductivity
     of open ground, thousands of units from the pressure of the colony, and let it go into the
     tubes when the colony arrived.
   - **As many covered sites give as take** (decision 5). Before, the roles were drawn among all
     food sites, and the covered ones were out of balance (3 to 5 more gave than took at step
     250). The pressure of the colony then rose as a whole by tens of units per step, away from
     the open ground around it.
   - **A site works only up to a pressure limit.** A site gives or takes its full flux while its
     pressure lies within 4,096 · I0 of the mean pressure of all sites that give or take, on the
     side it pushes to; the flux falls to nothing over the last quarter of that range. So a site
     that no tube joins to the others stops, as a pump does against a closed pipe, and its part of
     the network does not move away from the rest without limit.
   - **Only a cell that conducts takes the momentum of the iteration.** With the momentum
     (ω = 1.991) a pressure swings for hundreds of iterations. A cell without a tube swung by
     itself beside the network. At the margin of a tube the trail flickers, so the tube body of a
     cell crosses its limit of 0.05 again and again, and each time the cell brought its swing into
     the network. In the CPU mirror this alone made the pressure grow by a factor of more than
     10⁷ in 100 steps; with the plain damped iteration on the cells without a tube it stayed below
     70 in 800 steps. A first try, the momentum only for cells with a mature tube body (from 0.25
     or 0.1 on), was stable too, but the flux no longer reached along the Maze's route in time (0.5
     of 8 across the middle of the maze at step 1,000), and the colony died.

   Every open cell also has a conductivity of 0.00001 for the pressure iteration only: a cell
   beside the network then holds the pressure of its neighbours before it joins. With the four
   rules the pressure of the Tokyo scene stays within ±770 in all four fields from step 250 to
   step 12,000 (flux 2, seed 1), and the flux of a cell is at most 22 at step 250, beside Tokyo's
   seven sites, and at most 8 from step 500 on.

   The flux of the local solver against an exact solution of Kirchhoff's law on the same network
   (conjugate gradients to a residual of 10⁻⁸; Tokyo scene, flux 2, seed 1, two fields; the cells
   whose exact flux is above 5 % of I0):

   | Step                                   | Sum of the flux, local over exact | Error per cell, median | 90th percentile |
   | -------------------------------------- | --------------------------------- | ---------------------- | --------------- |
   | 500 (the colony grows, 24 sites)       | 132 % and 144 %                   | 11 % and 21 %          | 60 % and 80 %   |
   | 2,000 (all 42 sites)                   | 97 % and 99 %                     | 6 %                    | 15 % and 16 %   |
   | 4,000 (100 and 175 steps after a draw) | 96 % and 97 %                     | 21 % and 9 %           | 63 % and 24 %   |
   | 8,000                                  | 102 % and 99 %                    | 4 % and 5 %            | 16 % and 10 %   |

   So the local solver is within about 5 % of the exact flux in a settled network, and about 20 %
   off while the colony grows fast and for about 100 steps after a field draws new roles.

7. **Tero's adaptation, per cell.** The flux of a cell is half the sum of the absolute fluxes over
   its four edges. A cell that holds a tube adapts: D ← D + 0.003 (f − D), with f the mean over the
   four fields of Q^γ / (1 + Q^γ) and γ = 1.8 (Tero et al. 2010, Fig. 4). D is at least 0.0001.
   Ground that never held a tube has D = 0.2. Ground that lost its tube keeps its D and recovers
   slowly, by the factor 1.00023 per step up to 0.2. Reason for the last rule: when starved ground
   was fresh again at once, agents came back at once, and faint strands lived for ever.

8. **The flux decides where agents live.** An agent on a cell with the flow memory D dies with the
   chance 0.02 · h² / (D² + h²) per step, h = 0.01. A dead agent draws one random cell per step; if
   the cell is open, holds a tube and has D above 0.5, the agent comes to life there with the chance
   0.2 · (D − 0.5) / 0.5. With the rule of one agent per cell the cell must be empty, and the agent
   claims it as a move does (ADR 0008). In a step in which a tool places agents (inoculate or cut,
   ADR 0023), the flow brings none to life: an agent has one placement per step. So a tube that
   carries flux fills up and gets wider, until the flux per cell falls. Rejected, with the
   prototype: (a) a deposit scaled by the flow memory alone: the dead ends stay, because Jones'
   agents steer by the difference between their sensors and not by the amount of trail; (b)
   starvation without births: the tube of the route dies out too, more slowly.

9. **With growth and shrinkage (ADR 0025), an agent does not divide on a starved cell.** An agent
   divides only where D ≥ h (0.01), the level at which the chance of starvation is half its top
   value. Reason: Jones' growth rule divides every agent in a thin part of the colony every 3
   steps, faster than the starvation of at most 2 % per step removes agents. The flow supplies no
   plasm for a child where it passed the cell by. Measured on the Tokyo scene (flux 2, seed 1, the
   33 cities), with the rule and with only this rule off: without it the network keeps its mesh,
   with TL 2.66 to 2.80 and 75 to 84 links from step 2,000 to step 24,000, and 61 % of its tube
   cells have a flow memory below 0.01. With it TL falls from 2.77 at step 2,000 to 1.87 at step
   12,000 and stays at 1.85 to 1.99 with 52 to 59 links up to step 24,000.

10. **Thirty steps are one minute of model time.** A step is 2 s. An agent moves one cell per step;
    on the Tokyo scene a cell is 0.54 mm of the plate of Fig. 1 (17 cm on 316 cells), so an agent
    moves at 0.27 mm/s, the order of the flow in the tubes (1 mm/s; Tero et al. 2007, Sec. 2). With
    this scale the constants give the times of the organism:

    | Constant                      | Steps                           | Model time | The organism (Marbach et al. 2023) |
    | ----------------------------- | ------------------------------- | ---------- | ---------------------------------- |
    | The body follows the trail    | 1 / 0.02 = 50                   | 1.7 min    | delay of 1 to 3 min                |
    | A tube adapts                 | 1 / 0.003 = 333                 | 11 min     | 10 to 100 min                      |
    | A tube without flux starves   | ln(0.2 / 0.01) / 0.003 = 999    | 33 min     | veins vanish in 15 to 40 min       |
    | The foods keep their roles    | 300                             | 10 min     | (this app's choice)                |
    | Starved ground is fresh again | ln(2000) / ln(1.00023) = 33,050 | 18 h       | (this app's choice)                |

    The roles change five times as slowly as the shuttle flow of the organism (2 min), because the
    solver needs time after a draw: from a cold start it came within 5 % after 4,150 iterations,
    260 steps. Tero et al. state that the mean of the shuttle flow over a period acts as a direct
    current (2007, Sec. 6).

11. **Two settings; the rest are constants.** "Flow in the tubes" (off) and "Flow strength", the
    flux I0 of each site, from 0.1 to 32 on a logarithmic slider, 8 by default. The unit is the flux
    through one cell at which f is one half. γ, the rates and the levels are constants in
    `src/engine/flow.ts`, each with its source or its measurement here. Reason: each one moves a
    time scale of the table above or a level that the tests pin.

12. **Two scenes use the flow.** The Maze turns it on, with the default strength of 8: its text
    said what was missing. A new scene, Tokyo rail network, rebuilds the experiment of Tero et al.
    2010 (Fig. 1) with the map of ADR 0024: the 36 food sources, Tokyo as seven food sources (as in
    the model of the paper, Fig. 4), walls along the coast (© OpenStreetMap contributors, ODbL) and
    along the west, north and south edges of the map. The protocol is the first one of the paper:
    a colony of about 50 agents starts on the food at Tokyo station (start layout "At the first
    food") and grows with Jones' rule of 2011 (ADR 0025) as a mesh of tubes over the land; the
    flow decides which tubes stay. The scene runs on a square lattice of 512 × 512 cells in a dish,
    so north is up on every screen (ADR 0024, decision 4; a grid shaped like a tall screen would
    turn the frame). Where the simplified coast came within 5.4 km of a city, it follows a circle
    around the city on the seaward side (9.4 km around Tokyo, for its seven food sources): the
    simplified line passed over harbour cities.

    The flow strength of the scene is 1.4. Reason: the measurement with 1, 1.4 and 2 over ten seeds
    each, run twice (results below). With 1.4 the total length of the network is that of the
    organism in both sets of runs, and every measure lies within one standard deviation of the
    paper. A flux of 1 is as near within the spread of the seeds; a flux of 2 gives a longer
    network. The model of the paper uses I0 = 2 (Fig. 4), but the flux of this app has another unit
    (Consequences), so that value does not carry over.

13. **The flow is in the source of a pass only while it is on.** WGSL has no preprocessor, and an
    override constant leaves its code and its bindings in the pass. So the lines of the flow in
    `agents.wgsl` and `growth.wgsl` stand between the markers `//#if FLOW`, `//#else` and
    `//#endif`, and `variant()` (`src/engine/shaders/variant.ts`) builds the source of a pass with
    or without them. Without them the source is the one of `main`, character for character. GLSL
    uses `#if FLOW`. The passes of the flow itself are `flow.wgsl` and `flow.frag`: `update` (the
    flux, the memory, the body, the conductivity and the roles of each cell) and `pressure` (one
    iteration), 17 passes per step.

14. **The flow holds 80 B more per cell while it is on**: the memory of each cell in two textures
    and the pressure of the four fields in three, each `rgba32float`. The memory fit counts them
    only while the flow runs (`FLOW_BYTES_PER_CELL`).

15. **The draws of the flow have their own random streams** (9 for starvation, 8 for the cell that
    a dead agent draws), so they shift no other draw. A unit test checks that every stream number
    is used once, in WGSL and in GLSL, and that every draw of a shader names its stream. The start
    of a simulation draws from the streams 7 + k · 65536. The first version used 7 for starvation,
    so in step 0 the draw of starvation was the first draw of the agent's start (review of
    2026-11-13).

## Results in the app

All numbers are from the real engine (M3 Pro, Chromium with Metal, 2026-11-13), measured on dumps
of the trail with the scripts of the prototype. The tables are from the code after the review
(commit `92a63e7`). The same runs with the code before the review gave the same picture; where
they add something, the text names them. The review changed the random stream of the starvation
draw and the cell that the pressure is recentred by: single runs differ, the rule does not. Three
checks were not run again and are from the code before the review: the bounds of the pressure and
the comparison with the exact solution (decision 6 and the Maze below), and the control without
the growth gate (decision 9).

Pictures from the app's own renderer (`npm run gallery`, seed 7): `docs/images/maze-flow.jpg` is
the Maze at step 5,000 without and with the flow, `docs/images/tokyo-flow.jpg` the Tokyo scene at
step 12,000 without and with the flow, and `docs/images/tokyo-time.jpg` the Tokyo scene at step
1,000 and at step 48,000.

### The Maze (flux 8)

Ten seeds on WebGPU, three on WebGL2, three without the flow. "Dead ends over route": the mean
trail in the dead ends over the mean trail in the corridor of the shortest route. Median and range.

| Step                               | No flow, 3 seeds    | With the flow, WebGPU, 10 seeds | With the flow, WebGL2, 3 seeds |
| ---------------------------------- | ------------------- | ------------------------------- | ------------------------------ |
| Dead ends over route at 1,000      | 0.73 (0.68 to 0.75) | 0.54 (0.50 to 0.59)             | 0.54 (0.51 to 0.55)            |
| at 1,500                           | 0.76 (0.72 to 0.76) | 0.089 (0.064 to 0.127)          | 0.104 (0.088 to 0.105)         |
| at 2,000                           | 0.65 (0.65 to 0.68) | 0.025 (0.003 to 0.070)          | 0.020 (0.008 to 0.032)         |
| at 3,000                           | 0.71 (0.64 to 0.78) | 0.012 (0.000 to 0.045)          | 0.004 (0.004 to 0.006)         |
| at 5,000                           | 0.76 (0.73 to 0.91) | 0.000 (0.000 to 0.006)          | 0.000 (0.000 to 0.000)         |
| at 15,000                          | 0.66 (0.60 to 0.77) | 0.000 (0.000 to 0.000)          | 0.000 (0.000 to 0.003)         |
| First measured step below 10 %     | never               | 1,500 (1,500 to 2,000)          | 2,000 (1,500 to 2,000)         |
| First measured step below 2 %      | never               | 2,500 (2,000 to 4,000)          | 2,500 (2,000 to 2,500)         |
| Foods joined from step 1,000 on    | 3 of 3              | 10 of 10 (9 of 10 at step 500)  | 3 of 3                         |
| Tube over shortest route at 15,000 | 1.15 (1.11 to 1.17) | 1.10 (1.09 to 1.14)             | 1.11 (1.10 to 1.13)            |
| Agents alive at 15,000             | 4,467               | 4,186 (3,991 to 4,480)          | 4,137 (4,074 to 4,154)         |

Without the flow a mesh stays in every corridor. With it one tube remains, and it pulls tight:
1.20 times the shortest route at step 1,000 and 1.10 at step 15,000. Other flow strengths, two
seeds each: with 2 the tube dies out (about 60 agents left, foods not joined), because the Maze has
no growth and dead agents come to life only where the flow memory is above 0.5; with 4 a thinner
tube remains (about 2,060 agents, 1.04 to 1.06 times the shortest route); with 16 a thicker one
(about 9,600 agents, 1.03 to 1.04).

The local solver against the exact solution in the Maze (seed 1): the flux on the cells that carry
more than 5 % of I0 is 40 % off at step 500, while the pressure still builds up along the route,
6 % at step 1,000, 4 % at 1,500 and 1 to 2 % from step 2,000 on.

### The Tokyo rail network

The scene as it loads (flux 1.4), ten seeds on WebGPU, measured as in the paper (p. 440) on the 33
food sources of its Fig. 2: the trail above 1.5 is the network, thinned to lines; a link is a line
between two junctions or food sources. TL, MD and FT are over the values of the minimum spanning
tree. Median and range over the seeds.

| Step   | Model time | All 33 joined | All 36 joined | Links           | TL                  | MD                  | FT                  |
| ------ | ---------- | ------------- | ------------- | --------------- | ------------------- | ------------------- | ------------------- |
| 1,000  | 33 min     | 5 of 10       | 0 of 10       | 64.5 (49 to 71) | 2.12 (1.72 to 2.32) | 0.87 (0.84 to 0.90) | 0.91 (0.86 to 0.92) |
| 2,000  | 1.1 h      | 10 of 10      | 10 of 10      | 80.5 (72 to 92) | 2.73 (2.56 to 2.85) | 0.83 (0.82 to 0.90) | 0.97 (0.94 to 0.99) |
| 4,000  | 2.2 h      | 10 of 10      | 10 of 10      | 70 (60 to 85)   | 2.46 (2.15 to 2.59) | 0.81 (0.80 to 0.85) | 0.97 (0.93 to 0.99) |
| 8,000  | 4.4 h      | 10 of 10      | 10 of 10      | 61.5 (55 to 71) | 2.05 (1.87 to 2.28) | 0.82 (0.81 to 0.84) | 0.95 (0.90 to 0.96) |
| 12,000 | 6.7 h      | 10 of 10      | 9 of 10       | 53.5 (49 to 63) | 1.90 (1.58 to 2.05) | 0.83 (0.82 to 0.91) | 0.91 (0.80 to 0.93) |
| 16,000 | 8.9 h      | 10 of 10      | 9 of 10       | 55 (46 to 64)   | 1.88 (1.67 to 2.02) | 0.82 (0.81 to 0.91) | 0.92 (0.89 to 0.95) |
| 24,000 | 13.3 h     | 10 of 10      | 9 of 10       | 53 (47 to 60)   | 1.77 (1.63 to 1.99) | 0.82 (0.81 to 0.84) | 0.92 (0.85 to 0.95) |
| 32,000 | 17.8 h     | 10 of 10      | 10 of 10      | 53 (45 to 57)   | 1.81 (1.45 to 2.00) | 0.82 (0.80 to 0.89) | 0.92 (0.82 to 0.96) |
| 40,000 | 22.2 h     | 9 of 10       | 8 of 10       | 54 (42 to 57)   | 1.84 (1.53 to 1.91) | 0.82 (0.81 to 0.84) | 0.93 (0.85 to 0.93) |
| 48,000 | 26.7 h     | 10 of 10      | 8 of 10       | 53 (45 to 65)   | 1.77 (1.51 to 1.98) | 0.83 (0.81 to 0.91) | 0.91 (0.78 to 0.96) |

At step 48,000, the end of the experiment in model time: TL 1.77 ± 0.15, MD 0.84 ± 0.03 and FT
0.90 ± 0.05 (mean and standard deviation), and FT over TL is 0.51. The organism (p. 440): TL
1.75 ± 0.30, MD 0.85 ± 0.04, FT 0.80 ± 0.13 without light and 0.86 ± 0.04 with light on the
mountains, and FT over TL about 0.5. The check of the specification of 2026-11-11 (TL from 1.45 to
2.05 and MD from 0.77 to 0.93 in 7 of 10 seeds, FT at least 0.66) holds in 10 of 10 seeds at step
24,000 and at step 48,000, and FT in 10 of 10. So the network of the scene is as long as the
organism's, and it is a little more direct and more fault tolerant: MD is 0.3 and FT 0.8 standard
deviations of the paper from the paper's mean without light (FT 1.0 above the mean with light).
The runs with the code before the review gave TL 1.77 ± 0.14, MD 0.83 ± 0.03 and FT 0.90 ± 0.04.

From step 2,000 on, all 33 food sources of Fig. 2 are joined in every sample but one (32 of 33 in
one seed at step 40,000). All 36 are joined in 73 of the 80 samples from step 4,000 on. In the
other seven, one of the three food sources at the edge of the map (those that only Fig. 1 has) has
no tube above the level of the measure. No such gap lasts two samples in a row. Two of the seven
are at step 48,000.

The time course: the colony grows out from Tokyo as a mesh of tubes, reaches all 36 food sources
by step 2,000 and has its most links there. Then the tubes without a flux between food sources
starve, and the network thins, fast to step 12,000 and slowly after it. The organism covers the
land in 11 to 16 h and has its network at 26 h (Fig. 1). The scene is at these stages after about
1 h and after 7 to 13 h of model time: Jones' growth rule has no speed of its own to set, and it is
about ten times as fast as the organism against the time of the adaptation.

Three flow strengths, ten seeds each on WebGPU to step 48,000. The measures are the mean and the
standard deviation at step 48,000. "Samples" are the 8 measured steps from 4,000 to 48,000 of each
seed, 80 in all.

| Flux         | TL          | MD          | FT                         | All 36 joined at 48,000 | All 36 joined, samples | Check of the specification at 48,000 |
| ------------ | ----------- | ----------- | -------------------------- | ----------------------- | ---------------------- | ------------------------------------ |
| 1            | 1.71 ± 0.15 | 0.83 ± 0.01 | 0.88 ± 0.03                | 10 of 10                | 73 of 80               | 10 of 10                             |
| 1.4          | 1.77 ± 0.15 | 0.84 ± 0.03 | 0.90 ± 0.05                | 8 of 10                 | 73 of 80               | 10 of 10                             |
| 2            | 1.88 ± 0.13 | 0.81 ± 0.01 | 0.93 ± 0.02                | 9 of 10                 | 72 of 80               | 9 of 10                              |
| The organism | 1.75 ± 0.30 | 0.85 ± 0.04 | 0.80 ± 0.13 or 0.86 ± 0.04 | all                     |                        |                                      |

The same thirty runs with the code before the review gave TL 1.64 ± 0.10, 1.77 ± 0.14 and
1.94 ± 0.10, and all 36 joined in 70, 76 and 75 of 80 samples. So two sets of ten seeds differ by
up to 0.07 in the mean TL and by up to 3 samples.

More flux gives a longer network with more loops, as in the model of the paper (supplement,
Fig. S1): with a flux of 4 and of 8 (three seeds each, step 24,000) TL is 1.97 (1.89 to 2.25) and
2.34 (2.32 to 2.36), and FT is 0.95 and 0.97. With 1 and with 1.4 every measure lies within one
standard deviation of the organism's. With 2, TL is 0.4 standard deviations above, MD is one
standard deviation off, and FT one (without light) to two (with light). The strengths do not
differ in how often one food source is without a tube above the level of the measure: 7, 7 and 8
of 80 samples.

The scene uses 1.4: in both sets of runs its total length is the organism's (1.77 against 1.75). A
flux of 1 is as near to the organism in MD and FT, within the spread of the seeds, and a little
shorter in TL (1.71, and 1.64 before the review).

Without the flow (one seed) the mesh of Jones' growth rule stays: TL 2.70 to 2.88 and FT 0.96 to
0.99 from step 2,000 to step 24,000, with 76 to 88 links. On WebGL2 (two seeds) the scene gives TL
1.72 and 1.91, MD 0.82 and 0.83 and FT 0.90 and 0.92 at step 24,000, within the range of the ten
seeds on WebGPU.

### With the flow off

With `flow` off the branch gives the bytes of `main` (`377f428`): the 16 scenes of `main` and the
default settings, 500 steps from seed 12345, on WebGPU and on WebGL2; the Maze with its flow
switched off. The SHA-256 digests of the agents, the trail, the scent and the environment are equal
in 34 of 34 runs (M3 Pro, 2026-11-13, checked again with commit `92a63e7` after the review). The
sources of `agents.wgsl` and `growth.wgsl` without the lines of the flow equal the files of `main`
character for character (decision 13).

The Foraging maze with the flow switched on (flux 8, three seeds; the scene itself keeps it off):
the colony grows from the first food and reaches the far food between step 4,000 and step 6,000.
From then on both foods are covered, the flux runs, and the mesh thins to one tube: 1.04 to 1.07
times the shortest route at step 12,000. The dead ends hold 37 to 63 % of the route's trail at
step 8,000 and 20 to 28 % at step 12,000.

## Review before the merge (2026-11-13)

A second reader went through the change before the merge. Each finding was checked in the code.

- **WebGPU, a serious fault.** With the flow, the pass `settle` has one pipeline for each variant
  of the agent passes (walls, trail saturation), but its bind group was cached without the
  variant, and on WebGPU a bind group belongs to its pipeline. In a scene with the flow and the
  rule of one agent per cell, a change of the trail saturation or of the walls made every later
  step invalid: no pass of it ran, and no message showed. A new GPU test changes both during a
  run; before the fix no agent moved after the change. The key of the bind group now names the
  variant (`sim.ts`).
- The reference cell of the pressure: decision 3.
- The random stream of the starvation draw: decision 15.
- The text "nothing starves" without a flux: decision 5. The rule did not change.
- The engine mapped the food sites after every paint, also with the flow off (8 ms for a list of
  100,000 edits, measured by the reader). It now maps them only while the flow is on, when the
  flow turns on and after every load. A load without shapes left the sites of the scene before in
  the simulation; they had no effect, because a site without food gives and takes nothing.
- Open: the textures of the flow are made at the first step that needs them, outside the error
  scopes of the start (`TODO.md`).

## Consequences

- The Jones scenes, the Fogleman scenes and the extended scenes without the flow keep their bytes
  (checks above). The Maze changes: it is the scene that shows the flow.
- The rule is this app's, built from Tero's flux model and Jones' agents. It is not the model of
  Tero et al. 2010: the flux runs on grid cells and not on a graph of tubes; all foods give or take
  at once; a local solver follows the pressure with a lag; and agents, not tube radii, carry the
  result. The texts of the scenes and of the help say so.
- The flux per cell depends on the width of a tube in cells. So "Flow strength" has this app's
  unit, and a value of the paper (I0 = 2) does not carry over.
- The pressure lags the roles after each draw (decision 10), and it lags more across a weak tube.
  The four fields and the slow adaptation (333 steps) average over this. The results in the app are
  measured with this lag.
- Starved ground stays closed to the colony for hours of model time. A colony that lost a region
  does not grow back into it soon.
- On the Tokyo scene the colony reaches all food sources about ten times as fast as in the
  experiment, measured against the time of the adaptation (about 1 h of model time against 11 to
  16 h): Jones' growth rule has no speed of its own to set.
- North stays up on the Tokyo scene only on its lattice. A grid shaped like a tall screen, chosen
  by the user, turns the map by 90°, as every scene (ADR 0019).
- Cost: the flow takes about 1.5 ms more per step on 512 × 320 cells and 2.3 to 2.5 ms on
  512 × 512 (M3 Pro; table (c)), 5 to 10 times the step of these scenes without it. At the default
  speed of 120 steps per second the steps then take a fifth (Maze on WebGPU) to more than a third
  (Tokyo on WebGL2) of the time. The frame budget (ADR 0028) lowers the steps per second on a slower GPU, and the
  startup check can lower the grid.
- The time limits of the new GPU tests follow ADR 0010. In the CI image (SwiftShader, 4 CPUs,
  16 GB, Docker on an M3 Pro, 2026-11-13) the 23 tests of `flow.gpu.test.ts` took 68 s together.
  The slowest took 13.6 s of its limit of 240 s (WebGL2 without float blending), the next 7.4 s of
  240 s (Kirchhoff's law on WebGPU) and 7.3 s of 120 s (the CPU copy on WebGL2). The hook that
  compiles the pipelines took 45 s on WebGPU and 7 s on WebGL2, of a limit of 600 s. GitHub runs
  SwiftShader's WebGPU compute about twice as slowly as the image (ADR 0010). So each wait stays
  below a quarter of its limit there; the times on GitHub are in the pull request.
