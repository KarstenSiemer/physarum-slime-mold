# 0029: Flow in the tubes

- Status: accepted. The owner decided on 2026-11-12 that the flow is an option of the extended model
  that is off by default (decision 1). Every other decision here is the coordinator's choice under
  the owner's delegation of 2026-11-12, with its date and reason. The sections on the solvers and
  the mathematics and on how to check this record came on 2026-11-13, at the owner's request,
  with the research code in the repository (decision 16).
- Date: 2026-11-12
- In short: [`research/flow/README.md`](../../research/flow/README.md) tells on one page, in plain
  words, how this decision came about. This record has the details.

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

## The solvers and the mathematics

Added on 2026-11-13, at the owner's request: how each solver works, why the local one is called
local, why it is not exact, and the formulas of the rule. The scripts behind every number of this
section are in `research/flow/` (decision 16; the last section of this record has the commands).

### The model on a graph

Tero, Kobayashi and Nakagaki describe the plasmodium as a graph. A node i has a pressure p_i. A
tube between the nodes i and j has a length L_ij and a conductivity D_ij. Node 1 is the food
source that gives the flux I0, and node 2 is the one that takes it.

```text
Q_ij = D_ij · (p_i − p_j) / L_ij        the flux through a tube                    (2007, Eq. 1)
Σ_i Q_ij = 0                            Kirchhoff's law at a node j that is no food (2007, Eq. 2)
Σ_i Q_i1 + I0 = 0,   Σ_i Q_i2 − I0 = 0  the same law at the two foods              (2007, Eq. 3)
dD_ij/dt = f(|Q_ij|) − D_ij             the adaptation: a tube follows its flux     (2007, Eq. 5)
f(Q) = Q^γ / (1 + Q^γ),   γ = 1.8       the shape of f                (2010, p. 441 and Fig. 4)
```

The first three lines together are one linear system for the pressures, the "network Poisson
equation" (2007, Eq. 6). With s_i for the flux that node i gives (+I0, −I0 or 0):

```text
Σ_j (D_ij / L_ij) · (p_i − p_j) = s_i    for every node i;    in short    A · p = s
A_ii = Σ_j D_ij / L_ij,    A_ij = −D_ij / L_ij
```

The solvers use three properties of A. It is symmetric. It is sparse: the row of a node holds only
the neighbours of that node. And it fixes the pressures only up to a constant: the same number
added to every pressure changes no flux. So Tero et al. set one pressure by hand, p_2 = 0 (2007,
after Eq. 6), and the sources must sum to zero. The paper solves the system anew at every time
step, with the adaptation as a semi-implicit step (2007, Sec. 3.3).

### The same model on the grid of the app

The app has no graph of tubes. Every open cell c is a node (decision 4). It holds the trail T_c of
all strains, the tube body B_c (0 to 1), the flow memory D_c (Tero's conductivity, 0.0001 to 1),
the conductivity g_c, and one pressure p_c for each of four fields (decision 5).

```text
presence_c = clamp((T_c − 0.2 · d) / (d − 0.2 · d), 0, 1)     d: the deposit of strain A
B_c ← B_c + 0.02 · (presence_c − B_c)                          the tube body follows the trail
g_c = B_c · (0.02 + D_c)       a cell with a tube (B_c ≥ 0.05) that is no food
g_c = B_c · 4                  a food cell with a tube
g_c = 0                        a cell without a tube
g_cd = 2 · g_c · g_d / (g_c + g_d)       the conductance of the edge between two cells c and d
Q_cd = g_cd · (p_c − p_d)                the flux over that edge; every edge is one cell long
Q_c  = ½ · Σ_d |Q_cd|                    the flux through cell c, over its four edges
```

The edge is two half cells in series. Half a cell of conductivity g has the conductance 2 · g, and
two conductances in series add as 1 / (1 / (2 · g_c) + 1 / (2 · g_d)): the harmonic mean. The flux
through a cell is half the sum, because what passes the cell comes in over one edge and leaves over
another, so the sum counts it twice.

Kirchhoff's law of a cell, in each field:

```text
Σ_d ĝ_cd · (p_c − p_d) = s_c · I0 · r_c
ĝ_cd      the edge conductance from g_c + 0.00001 and g_d + 0.00001 (the "ghost" conductivity)
s_c       +1 at the centre cell of a food site that gives in this field, −1 if it takes, else 0
r_c = clamp((H − s_c · (p_c − p̄)) / (0.25 · H), 0, 1),   H = 4,096 · I0     (the pressure limit)
p̄         the mean pressure of the sites that give or take in this field
```

The ghost conductivity and the pressure limit r_c are this app's (decision 6); without them the
line is Tero's Eq. 6 with several foods. The flux Q_cd that the adaptation reads uses g_cd, without
the ghost conductivity. In the code: `update` and `pressure` in `src/engine/shaders/flow.wgsl`
(`edge()`, `ghostEdge()`, `headroom()`), the same in `src/engine/gl/glsl/flow.frag`, and on the
CPU `flowUpdate()` and `flowPressure()` in `src/engine/flow-reference.ts`.

### Solver 1, exact: conjugate gradients

The method of conjugate gradients (Hestenes and Stiefel 1952) solves A · p = s for a symmetric
matrix that is positive definite or, as here, positive semi-definite with sources that sum to
zero. It improves a guess p step by step:

```text
r = s − A · p          the residual: how far each cell is from Kirchhoff's law
z = M⁻¹ · r            the preconditioner M: a cheap and rough solve
d = z                  the search direction
repeat
  α = (r · z) / (d · A · d)        how far to go along d: two sums over all cells
  p ← p + α · d
  r ← r − α · A · d
  z = M⁻¹ · r
  β = (r · z) / (the r · z of the iteration before)
  d ← z + β · d                    the new direction, conjugate to all directions before
until the size of r is below the tolerance
```

The product A · d is local: each cell reads its four neighbours. The two sums r · z and d · A · d
are not: each one runs over every cell of the network, and the step sizes α and β that they give
hold for every cell. This is how one iteration carries information across the whole network, and
why the method reaches any accuracy that the tolerance asks for. After k iterations its error is
at most 2 · ((√κ − 1) / (√κ + 1))^k times the error at the start, with κ the condition number of
M⁻¹ · A. So a good preconditioner M is the key:

- **The diagonal**: z_c = r_c / A_cc. Every cell by itself, so it runs in parallel.
- **Modified incomplete Cholesky, MIC(0)**: M = L · Lᵀ, where L is a lower triangle with the
  sparsity of A, and the entries that a full Cholesky factor would add are put on the diagonal
  (Bridson and Müller-Fischer 2007, Sec. 4.3.4, Eq. 4.33 and Fig. 4.2). On the grid, with a_w and
  a_n for the conductances of the edges of cell c to the west and to the north, a_ws for the edge of
  the west neighbour to its south neighbour, and a_ne for the edge of the north neighbour to its
  east neighbour:

  ```text
  e_c = A_cc − (a_w / E_w)² − (a_n / E_n)² − τ · (a_w · a_ws / E_w² + a_n · a_ne / E_n²)
  E_c = √e_c,   τ = 0.97;   the prototype takes e_c = A_cc where e_c < 0.25 · A_cc
  ```

  To apply M⁻¹, a first sweep goes through the cells in reading order, and each cell needs the
  result of its west and north neighbours; a second sweep goes back (Fig. 4.3 of the same notes).

Tero et al. use this family of solver ("ICCG", 2007, Sec. 3.3). Measured on the Maze's network at
step 1,000 of seed 1 (47,544 cells in the network, residual 10⁻⁸ of I0): 496 iterations with
MIC(0), and 3,109 with the diagonal (`research/flow/prototype/static.ts`).

Why the app does not run it: the sweeps of MIC(0) are a chain through the whole grid, and a GPU
pass computes all cells at once. With the diagonal the method runs in parallel, but one solve is
then about 3,100 stencil passes and 6,200 sums over the grid, and each sum is a chain of
reduction passes or a read-back to the CPU. The local solver is 16 stencil passes per step.

### Solver 2, local: Jacobi iterations with a momentum

A Jacobi iteration sets the pressure of each cell to the value that satisfies Kirchhoff's law of
that cell alone, for the pressures that its four neighbours have now:

```text
p*_c = (Σ_d ĝ_cd · p_d + s_c · I0 · r_c) / Σ_d ĝ_cd
```

The app damps this step (weight 0.9) and adds a momentum: the pressure of the iteration before
(decision 3). The iteration with the momentum is a second-order Richardson iteration (Golub and
Varga 1961); a step that also keeps a part of the step before is the idea of the heavy-ball
method too.

```text
J_c = p_c + 0.9 · (p*_c − p_c)                       the damped Jacobi step
p_c ← ω · J_c + (1 − ω) · p_c(one iteration ago)     a cell with a tube (g_c > 0)
p_c ← J_c                                            a cell without a tube
ω = 2 / (1 + √(1 − r²)) = 1.9911                     for the radius r = 0.99999
```

A step of the app runs 16 of these iterations, from the pressure of the step before. The first
two iterations of a step also take the pressure of one cell off the whole field, because the law
fixes the pressure only up to a constant (decision 3).

How fast it converges. Take the difference between the pressure and the exact solution, and split
it into the modes of the damped Jacobi step: patterns that the step multiplies by a number μ, the
eigenvalue of the mode. All μ lie between −0.8 and 1. A rough pattern, which changes from cell to
cell, has a μ far from 1 and is gone after some iterations. A smooth pattern, which changes over
the whole length of the network, has a μ just below 1.

- Without the momentum, an iteration multiplies each mode by its μ. On a plain chain of N cells
  the smoothest mode has a μ of about 1 − 0.9 · π² / (2 · N²). For N = 754, the way between the
  Maze's two foods, that is 1 − 7.8 · 10⁻⁶: the error of this mode falls by a factor e in 128,000
  iterations. The count grows with N².
- With the momentum, the error e(k) of a mode after k iterations follows
  e(k + 1) = ω · μ · e(k) + (1 − ω) · e(k − 1). For every mode with |μ| ≤ r the two roots of
  λ² − ω · μ · λ + (ω − 1) = 0 are complex or equal, and the mode falls by the factor
  √(ω − 1) = r / (1 + √(1 − r²)) per iteration. For r = 0.99999 that is
  0.99554: a factor e in 224 iterations, for all these modes alike. Tuned to the smoothest mode of
  the chain, the count is N / (π · √0.9), 253 for N = 754: it grows with N and not with N².
- A mode with μ above r falls more slowly, by the larger root
  λ = (ω · μ + √(ω² · μ² − 4 · (ω − 1))) / 2.
- The weight 0.9 is needed for the momentum. On a grid the plain Jacobi step has a mode with
  μ = −1, the checkerboard, and the formula for ω holds only for modes between −r and r. The
  weight moves that mode to −0.8.
- The mode of a constant pressure has μ = 1 and never falls. The recentring takes it off.

### Solver 3: the walkers of Ma et al.

Walkers stand for the pressure. A cell c holds N_c walkers and has the "capacitance" C_c, the sum
of its edge conductances (Ma et al. 2013, Eq. 2.15). The potential of the cell is u_c = N_c / C_c:
in the model that the paper calls biologically realistic, the walkers of a node count against its
capacitance, and the flow follows Ohm's law (Sec. 2.4, Eq. 2.16).

```text
m_cd = (u_c − u_d) · g_cd · Δt       the mean number of walkers that go from c to d in a step
the number that go is a Poisson sample of |m_cd|                                    (Eq. 2.5)
in each step the food that gives gets w new walkers, and the food that takes loses up to w
the flux of an edge is its sampled number of walkers times I0 / w
```

No system is solved: a walker needs only the cells beside it. Its mean is still the same
iteration. The mean number of walkers on a cell after a step is N_c − Σ_d m_cd, so

```text
u_c ← (1 − Δt) · u_c + Δt · (Σ_d g_cd · u_d) / C_c
```

This is one damped Jacobi step with the weight Δt, without a momentum: one iteration per step of
the simulation, where the local solver runs 16 with a momentum, and with the noise of the samples
on top. The prototype used Δt = 0.8 and w = 2,000.

### Why the local solver is called local

In one iteration a cell reads its own pressure and the pressures of its four neighbours, and
nothing else: no sum over the grid, no order among the cells. So one iteration is one pass over
the grid that computes all cells at once, a stencil of five cells, as the diffusion of the trail
is. That is what a GPU does well, with WebGPU and with WebGL2. Ma et al. draw the same line
between their walk and Tero's model: there a solution of Kirchhoff's law needs "a global solution
over all nodes" (2013, Sec. 2.2), and a walker needs none.

The price of a local rule: news travels one cell per iteration. After k iterations a change at one
food has reached only the cells within k steps of it (measured: 2, 50 and 962 cells after 1, 4 and
16 iterations). With 16 iterations per step, a food 754 cells away cannot feel the change before
step 48, whatever the tuning: the way through the maze is at least that long. Conjugate gradients
have no such limit, because their two sums reach every cell in every iteration.

### Why the local solver is not exact

1. **It never runs to the end.** A step has 16 iterations. From a pressure of 0 on the fixed Maze
   network, the flux of the app's rule is 44 % off the exact flux after 260 steps (4,160
   iterations), 20 % after 570 steps and 7 % after 1,000 steps (table in the next section). The app
   does not wait: the agents move on, and the next step starts from the pressure that is there.
2. **The smooth modes are the slow ones, and they carry the flux between far foods.** The measured
   fall on the Maze network, a factor e in about 6,300 iterations with the radius 0.99999 and in
   about 1,900 with 0.999999, is in both cases that of a mode with μ between 1 − 7 · 10⁻⁷ and
   1 − 6 · 10⁻⁷ (the larger root above). That is above both radii, and ten times as near to 1 as
   on a plain chain of the same length. Probable cause, not measured: the wide mesh and its dead
   ends fill and empty through narrow tubes.
3. **The network moves under the solver.** While the colony grows, cells join the network in
   every step, and their pressure is not that of the network yet. At step 500 of the Tokyo scene
   the flux of the local solver is two to four times the exact flux in sum (decision 6).
4. **The roles change.** With three or more foods, each field draws new roles every 300 steps, and
   the pressure for the new roles has to build up again. 100 to 175 steps after a draw the flux is
   9 to 25 % off (median per cell, decision 6).
5. **In a settled network the rest is small.** With slow changes only, the pressure of the step
   before is a good start: 3 to 7 % off in the Tokyo scene at step 8,000, and 1 to 6 % in the Maze
   from step 1,000 on (decision 6 and "Results in the app").
6. **Two smaller parts.** The ghost conductivity lets a little flux through cells without a tube:
   it changes the exact flux of the Maze network by 0.04 %. And a site at its pressure limit gives
   less than I0; that holds only for a site that no tube joins to the others.

What follows from this for the model: the flow memory averages over the error. A tube adapts with
the rate 0.003 per step, a time of 333 steps, and over four fields with roles that change 75 steps
apart. So a wrong flux for some tens of steps moves the memory little. A flux that is wrong for
hundreds of steps does move it: this is why the roles are held for 300 steps (decision 10), why
the pressure needs the four rules of decision 6, and why the results below are measured in the
app as it is and not taken from the exact model.

### The rest of the rule in formulas

```text
f_c = ¼ · Σ_k Q_c,k^γ / (1 + Q_c,k^γ)            the mean over the four fields k, γ = 1.8
D_c ← max(0.0001, D_c + 0.003 · (f_c − D_c))     a cell with a tube, while a flux runs between foods
D_c ← min(0.2, max(D_c, 0.0001) · 1.00023)       a cell without a tube; fresh ground has D_c = 0.2
chance that an agent on cell c dies in a step:      0.02 · h² / (D_c² + h²),   h = 0.01
chance that a dead agent comes to life on the cell that it draws:   0.2 · (D_c − 0.5) / 0.5
    the cell is open and holds a tube, and D_c is above 0.5
an agent divides only on a cell with D_c ≥ 0.01     with Growth and shrinkage (decision 9)
```

Three numbers follow from these lines.

- The unit of the flux. A tube with the constant flux Q settles at D = f(Q), and f(1) = ½. So a
  flux of 1 through a cell is the flux at which the memory settles at one half. Dead agents come
  to life only above D = 0.5: a tube gets new agents only where the mean of f over the four fields
  is above one half, which is a flux above 1 if the four fields carry the same flux.
- A tube without flux. With f = 0 the memory falls as D · (1 − 0.003)^t. From 0.2 to the level
  h = 0.01 it takes ln(20) / 0.003 = 999 steps, 33 minutes of model time (decision 10).
- Fresh ground without a flux. The chance to die is 0.02 · 0.01² / (0.2² + 0.01²) = 0.00005 per
  step: one agent of 20,000 (decision 5).

The roles of the food sites (decision 5): `flowRoles()` in `src/engine/flow.ts`. For field k the
covered sites are put in the order of a hash of the site, the field, the seed and the number
⌊(step + 75 · k) / 300⌋; the first half of the order gives, the second half takes, and with an odd
count the last site rests. Two covered sites: the first of the list gives, the other takes.

### The measures of a network

The measures are those of Tero et al. 2010 (p. 440), on a picture of the trail
(`research/flow/prototype/tokyo.ts`). The cells with a trail above 1.5 and the food cells are the
network. A thinning (Zhang and Suen 1984) makes lines one cell wide of it. A vertex is a food
source or a junction of lines, and a link is a line between two vertices. The length of a link
is that of the line after it is made of straight pieces (Douglas and Peucker 1973, within 1.5
cells), so that the steps of the cells do not count. Links that end at no food source are cut off.

```text
TL = (the sum of the lengths of all links) / (the length of the minimum spanning tree)
MD = (the mean over all pairs of food sources of the shortest way through the network)
     / (the same mean in the minimum spanning tree)
FT = the share of the links whose loss leaves all food sources joined
```

The minimum spanning tree joins the food sources by straight lines with the least total length.
It has TL = 1, MD = 1 and FT = 0: every link of a tree is needed. The paper measures the fault
tolerance by the "failure of a single link" (caption of Fig. 3B) and does not say whether a long
link fails more often. Here every link counts once.

### Sources of this section

Read for this record: Tero, Kobayashi and Nakagaki 2007 and Tero et al. 2010 (full text); Ma et
al. 2013 (the text around its equations, by a helper, in the copy at PubMed Central; the equations
there are pictures); R. Bridson, M. Müller-Fischer: Fluid Simulation, SIGGRAPH 2007 Course Notes,
Sec. 4.3.2 to 4.3.4 (conjugate gradients, incomplete Cholesky and its modified form; τ = 0.97 in
Fig. 4.2, the sweeps in Fig. 4.3). `docs/knowledge-base/flow-in-the-tubes.md` has the full
references of the papers.

Named as the usual source of a method, and not read for this record: M. R. Hestenes, E. Stiefel:
Methods of conjugate gradients for solving linear systems, J. Res. Natl. Bur. Stand. 49 (1952);
G. H. Golub, R. S. Varga: Chebyshev semi-iterative methods, successive overrelaxation iterative
methods, and second order Richardson iterative methods, Numerische Mathematik 3 (1961);
T. Y. Zhang, C. Y. Suen: A fast parallel algorithm for thinning digital patterns, Communications
of the ACM 27 (1984); D. H. Douglas, T. K. Peucker: Algorithms for the reduction of the number of
points required to represent a digitized line or its caricature, Cartographica 10 (1973). The
convergence factors of the section "Solver 2" are worked out here from the recurrence that the
section states.

## The prototype

A CPU prototype on the grid of the app (TypeScript, a copy of the agent model with the Maze's rules;
not bit-equal to the GPU) ran options 1 to 3 against each other. Since 2026-11-13 it is in the
repository with the logs of its runs, in `research/flow/` (decision 16). Tero's ring (2007,
Sec. 5.2: two tubes of length 10 and 16 between two nodes) checked the three solvers first: all
give D1 = 0.9297 and D2 = 0.1419 for μ = 0.8, the equilibrium of the paper, and (1, 0) for μ = 1
(`prototype/ring.ts`; the walkers are samples and give 0.9297 and 0.142, and 1.0002 and 0). The
closed form: in the equilibrium D_i = Q_i^μ and Q_i = D_i · Δp / L_i, so
Q_1 / Q_2 = (L_2 / L_1)^(1 / (1 − μ)), with Q_1 + Q_2 = 1.

### The pressure on a fixed network

The Maze's network at step 1,000 of seed 1, with the flux I0 = 8 between its two foods. The error
of a solver is the sum over all cells of |its flux − the exact flux|, over the sum of the exact
flux. The local solvers start from a pressure of 0. Measured again on 2026-11-13 with the code in
`research/flow/` (`prototype/static.ts`, `prototype/static-ma.ts` and `solvers.ts`); the first
numbers are in the note below.

| Solver                                                      | The two foods                             | Result                                                                  |
| ----------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Exact: conjugate gradients, MIC(0)                          | prototype: flux in, pressure 0 at the end | 496 iterations to a residual of 10⁻⁸ (47,544 cells)                     |
| Exact: conjugate gradients, diagonal                        | the same                                  | 3,109 iterations                                                        |
| Exact: conjugate gradients, diagonal                        | app: every open cell, ghost conductivity  | 3,068 iterations                                                        |
| Local, radius 0.99999                                       | prototype: fixed pressures, flux scaled   | 5 % error after 4,410 iterations, 1 % after 8,650                       |
| Local, radius 0.9999 and 0.999999                           | the same                                  | 5 % after 14,970 and 4,620; 1 % after 28,010 and 6,090                  |
| Local without the momentum                                  | the same                                  | 42.6 % error after 400,000 iterations                                   |
| Local, radius 0.99999: as the app runs it                   | app: a fixed flux at both foods           | 44 % error after 4,160 iterations, 20 % after 9,120, 6.7 % after 16,000 |
| Local, radius 0.9999 and 0.999999                           | the same                                  | 37 % after 16,000; 5 % after 5,568 and 1 % after 8,736                  |
| Local without the momentum                                  | the same                                  | 62 % error after 400,000 iterations                                     |
| Ma's walkers (Eq. 2.16; 2,000 new walkers per step, Δt 0.8) | prototype: walkers in and out             | 88.8 % error after 150,000 steps; no walker at the far food             |

The exact flux through the tube cells of the route's corridor is 0.39 per cell, and 0.023 in the
dead ends: a ratio of 17.

The table has two rules for the two foods, and they differ much. The prototype's local solver held
the foods at the pressures +1 and −1 and scaled the flux to I0 afterwards. Then only the shape of
the flux field has to settle. The app gives and takes the fixed flux I0 (decision 5). Then the
height of the pressure has to build up too, 2,494 units between the two foods here, and it builds
up at the pace of the smoothest mode ("Why the local solver is not exact"). The radius 0.99999 of
decision 3 was chosen with the first rule. With the rule of the app the radius 0.999999 is about
three times as fast on this network (decision 3, and an open point in the Consequences).

On the moving network the exact flux changes by 0.35 % per step (`prototype/vary.ts`). The
prototype's local solver with 16 iterations per step follows it within about 2 % (7 % at 300 steps
after a cold start; `prototype/track.ts`), when the conductivity changes slowly and every open cell
conducts a little (decisions 4 and 6).

Ma's walk on a grid is Tero's model with a slow pressure solver: the mean field of Eq. 2.16 with a
time step of 1 is one weighted Jacobi iteration of Tero's Poisson equation per step ("Solver 3").
The walkers add sampling noise to it. The Maze's route is about 750 cells long, and a diffusion
over 750 cells needs in the order of 750² steps.

The first numbers of this part, in the record as merged with PR #44: 443 to 490 iterations for
MIC(0) and 3,102 for the diagonal; 5 % after 4,150, 14,140 and 5,110 iterations for the radii
0.99999, 0.9999 and 0.999999; 40 % after 400,000 iterations without the momentum; 88.8 % for Ma's
walkers; an exact flux of 0.083 and 0.0049 per cell, with I0 = 2. They came from states of the
prototype of the evening of 2026-11-12 that no file holds. The state in the repository gives the
numbers of the table. No conclusion changes but the one about the radius.

### (a) The Maze: the route against the dead ends

The Maze scene on the CPU copy, 10 seeds each, the flow from step 500 on. "Ratio": trail in the
route's corridor over trail in the dead ends. "Below 10 %" and "below 2 %": the first step at which
the trail of the dead ends is below that share of the route's; median and range over the seeds.
"Tube": the length of the tube over the shortest route at step 10,000.

| Rule                              | Ratio at 2,500 | Ratio at 5,000 | Below 10 % at step     | Below 2 % at step      | Joined   | Tube |
| --------------------------------- | -------------- | -------------- | ---------------------- | ---------------------- | -------- | ---- |
| No flow (Jones)                   | 1.45           | 1.19           | never                  | never                  | 10 of 10 | 1.21 |
| Tero, exact solve every 8 steps   | 14.9           | 62             | 2,250 (2,250 to 2,500) | 4,875 (4,750 to 5,750) | 10 of 10 | 1.13 |
| Tero, local solver, 8 iterations  | 3.2            | 37             | 3,250 (2,750 to 4,500) | 5,625 (4,750 to 8,000) | 10 of 10 | 1.16 |
| Tero, local solver, 16 iterations | 12.2           | 85             | 2,500 (2,500 to 3,250) | 4,375 (2,750 to 6,750) | 10 of 10 | 1.13 |
| Tero, local solver, 32 iterations | 21.6           | 1,960          | 2,250 (2,250 to 2,500) | 3,625 (3,000 to 8,250) | 10 of 10 | 1.13 |
| Ma's walkers                      | 5.8            | (no network)   | (no network)           | (no network)           | 0 of 10  | none |

The 60 runs of this table ran again on 2026-11-13 with the code in the repository (decision 16;
`research/flow/logs/maze-pair/`). One entry changed: the range of the exact solve for "below 2 %",
which was 4,750 to 6,250.

With Ma's walkers the flux never reaches the far food, every tube starves, and 78 agents (63 to 97)
of 19,661 live at step 2,500: the foods are not joined in any seed. The local solver with 16
iterations ends where the exact solve ends, within the spread of the seeds; 8 iterations are slower,
and 32 gain little. These runs held the two foods at fixed pressures and scaled the flux to I0.
With a fixed flux at each food, as in the app (decision 5), the prototype gave, for 16, 8 and 32
iterations: below 10 % at step 2,125, 2,250 and 2,250 (each 2,000 to 2,250), below 2 % at step
3,625, 3,125 and 3,000, and a ratio of 28, 23 and 30 at step 2,500, in 10 of 10 seeds each
(`research/flow/logs/maze-sites/`).

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
from a full sheet; its results are below. The logs of these runs are in
`research/flow/logs/tokyo/`.

### (c) The cost on the GPU

Measured for the rule as built (decision 3), in the real engine on an M3 Pro (Chromium with Metal,
2026-11-13, commit `92a63e7`): the median time of a step over 21 batches of 50 steps, after 3,000
steps. The two runs of the table ran one after the other and agree within 0.02 ms.

| Scene                  | Backend | Without the flow | With the flow | The flow     |
| ---------------------- | ------- | ---------------- | ------------- | ------------ |
| Maze, 512 × 320 cells  | WebGPU  | 0.17 ms          | 1.66 ms       | 1.49 ms more |
| Maze, 512 × 320 cells  | WebGL2  | 0.33 ms          | 2.04 ms       | 1.71 ms more |
| Tokyo, 512 × 512 cells | WebGPU  | 0.36 ms          | 2.64 ms       | 2.28 ms more |
| Tokyo, 512 × 512 cells | WebGL2  | 0.64 ms          | 3.11 ms       | 2.47 ms more |

The cost follows the cells: about 9 ns per cell and step on WebGPU and 9 to 10 ns on WebGL2, for
the update and the 16 pressure passes.

The table holds within about a sixth, and not to its second digit (added on 2026-11-13). Six later
runs of the same measurement, on the same day and machine, are in
`research/flow/logs/engine/bench-3.jsonl` to `bench-8.jsonl`. In five of them the flow adds 1.26
to 1.75 ms per step for the Maze on WebGPU and 1.61 to 1.96 ms on WebGL2, and 2.09 to 2.64 ms for
the Tokyo scene on WebGPU and 2.27 to 2.68 ms on WebGL2: 8 to 12 ns per cell. In the sixth
(`bench-6.jsonl`) the batches of one run differ by a factor of up to 3.4, and its medians are up
to 4.94 ms. Other programs ran on the machine during the later runs, some of them on the GPU. What
else ran during the two runs of the table is not recorded.

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
   r = 0.99999. That radius reached 5 % error first in the prototype, which held the two foods at
   fixed pressures (table above). The measurement of 2026-11-13 with the rule of the app, a fixed
   flux, gives another order: on the fixed Maze network the radius 0.999999 reaches 5 % in a third
   of the iterations. The app keeps 0.99999. Reason: every result of this record is measured with
   it, and a larger ω lets a pressure swing three times as long (a factor e in 707 iterations in
   place of 224), which the rules of decision 6 would have to hold while the colony grows. Open
   point in the Consequences. The pressure of a step starts
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
   takes, the mean pressure is 18 after 6,000 steps, whatever the first site of the list is
   (`research/flow/bounded.ts scene=isolated` gives these numbers).

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
   the first version of the app did: see decision 6. (a) and (b) ran again on 2026-11-13 with the
   prototype in the repository (seed 1, a flux of 8, `research/flow/logs/alternatives/`): with (a)
   1,044 of 5,293 agents live at step 2,000 and 152 at step 3,000, and from then on no two food
   sources are joined; with (b) 301 agents live at step 2,000, and from then on at most two food
   sources are joined.

6. **Four rules keep the pressure bounded.** The first version of the app let the pressure of the
   Tokyo scene run away while the colony grew: about ±4 · 10⁶ on the tubes at step 250, up to
   10¹⁸ at step 1,000, and back to ±450 only at step 4,000, when the growth had ended (flux 1,
   seed 1, WebGPU). The flux was above 3 on every tube cell from step 500 to 2,000, so f was 1,
   the flow memory went to 1 on the whole colony, and dead agents came to life everywhere: the land
   filled with a sheet of agents that the model does not give. The Maze, with two covered foods and
   no growth, did not show it. The CPU mirror of the passes reproduced it (a growing mesh with four
   foods: 7 · 10⁷ at step 300 and 3 · 10²³ at step 500). The causes and the rules against them
   (the table below the rules has each rule alone):

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

   What each rule does alone, in a scene of that kind: a mesh of tubes that grows from one food
   over three more on 64 × 64 cells, with a margin that flickers (`research/flow/bounded.ts`,
   2026-11-13; `research/flow/rules.ts` has the rules as switches on a copy of the CPU mirror). The
   numbers are the largest pressure on the cells with a tube, with a flux of 1.

   | Rule that is off (the others are on)            | Step 50 | Step 150  | Step 200   | Step 400   | Step 600   |
   | ----------------------------------------------- | ------- | --------- | ---------- | ---------- | ---------- |
   | None: as built                                  | 0       | 42        | 37         | 33         | 43         |
   | A food without a tube does not conduct          | 0       | 40        | 39         | 35         | 44         |
   | Only covered sites give or take, in equal count | 14,848  | 5,266     | 22,853     | 14         | 32         |
   | The two rules above                             | 194     | 1,048     | 148        | 22         | 35         |
   | The pressure limit                              | 0       | 42        | 37         | 33         | 43         |
   | The momentum only on cells that conduct         | 0       | 415       | 2.8 · 10⁶  | 3.9 · 10²⁰ | 2.9 · 10³⁷ |
   | All four: the first version                     | 436     | 7.8 · 10⁷ | 1.8 · 10¹¹ | 5.9 · 10²³ | no number  |

   The momentum on every cell is the rule that lets the pressure grow without end, alone and with
   the others. Without the rule for the covered sites the pressure is in the thousands while a
   food gives or takes before the colony covers it, and in the hundreds to a thousand when a food
   without a tube conducts too. It falls when the colony has reached all foods (from step 300 in
   this scene), and the Tokyo scene is in that state for its first 2,000 steps. Alone, the rule
   that a food without a tube does not conduct changes little in this scene. The pressure limit
   changes nothing here, because every site of this scene joins the others; it stops a site that
   no tube joins (GPU test "stops a food at its pressure limit").

   Every open cell also has a conductivity of 0.00001 for the pressure iteration only: a cell
   beside the network then holds the pressure of its neighbours before it joins. With the four
   rules the pressure of the Tokyo scene stays within ±600 in all four fields from step 250 to
   step 12,000 (the scene's flux of 1.4, seed 1; ±770 with a flux of 2). While the colony grows,
   1 to 2 % of the tube cells carry a flux above 3, at most 40 in one cell at step 1,000. From
   step 2,000 on no cell carries more than 4.

   The flux of the local solver against an exact solution of Kirchhoff's law on the same network
   (conjugate gradients to a residual of 10⁻⁸; Tokyo scene, seed 1, two fields; the cells whose
   exact flux is above 5 % of I0; commit `92a63e7`):

   | Flux | Step                                   | Sum of the flux, local over exact | Error per cell, median | 90th percentile |
   | ---- | -------------------------------------- | --------------------------------- | ---------------------- | --------------- |
   | 1.4  | 500 (the colony grows, 28 sites)       | 178 % and 286 %                   | 47 % and 26 %          | 164 % and 371 % |
   | 1.4  | 2,000 (all 42 sites)                   | 97 % and 94 %                     | 9 % and 12 %           | 26 % and 31 %   |
   | 1.4  | 4,000 (100 and 175 steps after a draw) | 97 % and 90 %                     | 25 % and 17 %          | 71 % and 46 %   |
   | 1.4  | 8,000                                  | 102 % and 97 %                    | 7 % and 6 %            | 32 % and 16 %   |
   | 2    | 500 (the colony grows, 29 sites)       | 201 % and 363 %                   | 53 % and 30 %          | 200 % and 714 % |
   | 2    | 2,000 (all 42 sites)                   | 98 % and 97 %                     | 5 % and 7 %            | 16 % and 19 %   |
   | 2    | 4,000 (100 and 175 steps after a draw) | 94 % and 95 %                     | 25 % and 9 %           | 71 % and 20 %   |
   | 2    | 8,000                                  | 102 % and 98 %                    | 3 % and 3 %            | 17 % and 12 %   |

   So in a settled network the local solver is 3 to 7 % off the exact flux (median per cell), more
   with the weaker flux of the scene. It is 9 to 25 % off for about 100 steps after a field draws
   new roles. While the colony still grows it is far off: at step 500 the pressure of tubes that
   have just joined has not settled, and the flux of the local solver is two to four times the
   exact flux in sum. The results of the scene are measured with this solver as it is. A run with
   the code before the review (flux 2, seed 1) gave a sum of 132 % and 144 % and a median error of
   11 % and 21 % at step 500, and the values of this table from step 2,000 on: the error of the
   growth phase differs from run to run.

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
   starvation without births: the tube of the route dies out too, more slowly. Both ran again on
   2026-11-13 (seed 1, `research/flow/logs/alternatives/`): with (a), the deposit times 0.3 to 2.3
   by the flow memory, the dead ends never fall below a fifth of the route's trail in 6,000 steps;
   with (b) the dead ends are below 2 % at step 3,250, and 258 agents live at step 10,000, when
   the two foods are no longer joined.

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
    solver needs time after a draw: from a cold start the prototype's solver came within 5 % after
    4,150 iterations, 260 steps. Tero et al. state that the mean of the shuttle flow over a period
    acts as a direct current (2007, Sec. 6). Measured again on 2026-11-13: 4,410 iterations with
    the fixed pressures of the prototype. With the fixed flux of the app the cold start takes
    longer on the long route of the Maze, 20 % error after 570 steps ("The pressure on a fixed
    network"). In the Tokyo scene the foods lie closer: there the flux is 9 to 25 % off 100 to 175
    steps after a draw (decision 6). So 300 steps are not long against the solver; a longer hold
    was not measured.

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

16. **The research code and its logs are in the repository** (2026-11-13). The owner asked on
    2026-11-13 that a person can retrace how this decision came about, and test it with Node. The
    form is the coordinator's choice under the owner's delegation of 2026-11-12, but for two
    points that the owner decided on the same day, when he read the pull request and found it too
    much to take in: the `README.md` of the folder starts with the story of the decision on one
    page, in plain words, and the logs are one archive and not 125 files. `research/flow/` holds
    the CPU prototype as it ran, the scripts that measure the real engine, three scripts that
    were written for the section on the solvers (`solvers.ts`, `rules.ts`, `bounded.ts`), and the
    logs of the runs. After the story, its `README.md` has the commands, and the last section of
    this record says which command gives which table.

    - The prototype is kept as it was measured. What changed: the paths, which now point into the
      repository; 12 places that the linter asked for, none in the arithmetic; some names that the
      spelling check of the repository asked for (the threshold of the trail in `maze.ts` has the
      name `level` now, for example); a switch for the preconditioner in `flow.ts`, so that the
      diagonal can be measured again; a parameter for the two layouts of the Tokyo map, the
      campaign's and the app's; and the second half of `static.ts`, written again from the record
      of the session. The light on the mountains and lakes of the prototype's map is not in the
      copy: no run used it, and the source of its data is not recorded. The prototype's loops
      read typed arrays with `!`, so the lint rule `no-non-null-assertion` is off for
      `research/**/*.ts`; every other rule, the type check and the formatter hold. Rejected: a
      rewrite to that rule. It would change 538 places in code whose numbers this record quotes.
    - Node runs the TypeScript files through `research/flow/register.mjs`, with the TypeScript
      compiler that the repository has. Rejected: a build step or a new package.
    - The logs are in the repository as one archive, `research/flow/logs.tar.gz` (owner,
      2026-11-13): 125 files and 1.9 MB of text in 0.4 MB. `research/flow/logs.ts` unpacks it to
      `research/flow/logs/`, which git ignores; a path `research/flow/logs/…` in this record is a
      path in that folder. Reason for the logs: the tables come from them in a second
      (`summary.ts`), and the runs behind them take hours. Reason for the archive: the first form
      of this decision put the 125 files into the repository, and with them the research folder
      held 157 of the 448 files of the repository. No person reads these files. Rejected: the logs
      only in the history of the pull request, and no research code in the repository at all;
      then a number of this record could not be checked from `main`.
    - A unit test runs the first 750 steps of four prototype runs and compares them with the logs
      bit for bit, and it runs the checks of the three new scripts (`research.test.ts`; the
      reruns on CI and with `RESEARCH=full`, ADR 0010). So the code cannot drift from its
      record. The rows are the same on macOS (ARM) and on Linux (x64 and ARM) with Node 26. The
      test also holds the tools of the record: the runs of each campaign in
      `prototype/campaign.ts` have the names of the logs, and the comparison of a rerun with the
      record (`summary.ts compare`) fails for a log that is short, that differs, or that the
      record does not have. And it holds the archive: a digest of its 125 files, so that a change
      of the record is a change of the test too.
    - The Maze campaign of table (a) ran again on 2026-11-13 with the code in the repository.
      Reason: on 2026-11-12 it had started two minutes before the last change of `flow.ts`, a change
      that left the rule as it was and changed the order of some float operations. The runs that
      had started before the change used the older state. So 7 of the 60 logs differed from what
      the code in the repository gives: seed 1 with each of the five rules that have a flow, and
      seed 2 with the local solver at 16 and at 8 iterations. They differed from the row of step
      750 on, the first row with a flow: from the 11th digit on with the local solver and the
      walkers, with the same count of live agents in every row of seed 1, and from the 8th digit
      on with the exact solver, where the count of live agents of seed 1 differs from step 4,250
      on. The other 53 logs were equal bit for bit, among them all ten without a flow. In table
      (a) one entry changed. The other two campaigns ran again in full on 2026-11-13 and give
      their logs of 2026-11-12 again, bit for bit: all 30 logs of `maze-sites` and all 6 logs of
      `tokyo`.
    - The measurements of the real engine are test files for Vitest with a configuration of
      their own, `research/vitest.config.ts`. Only a command that names that configuration runs
      them: no script of `package.json`, no CI job, and no `npx vitest run` with the
      configuration of the repository. Rejected: a third project beside `unit` and `gpu`. Vitest
      runs every project when a command names none, so `npx vitest run` would start measurements
      that take minutes to hours and write gigabytes.

## Results in the app

All numbers are from the real engine (M3 Pro, Chromium with Metal, 2026-11-13), measured on dumps
of the trail with the scripts of the prototype (`research/flow/engine/`; the lines of every run
are in `research/flow/logs/engine/`). The tables are from the code after the review
(commit `92a63e7`). The same runs with the code before the review gave the same picture; where
they add something, the text names them. The review changed the random stream of the starvation
draw and the cell that the pressure is recentred by: single runs differ, the rule does not. One
check was not run again and is from the code before the review: the control without the growth
gate (decision 9).

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
| Agents alive at 15,000             | 4,467               | 4,187 (3,991 to 4,480)          | 4,137 (4,074 to 4,154)         |

Without the flow a mesh stays in every corridor. With it one tube remains, and it pulls tight:
1.20 times the shortest route at step 1,000 and 1.10 at step 15,000. Other flow strengths, two
seeds each: with 2 the tube dies out (about 60 agents left, foods not joined), because the Maze has
no growth and dead agents come to life only where the flow memory is above 0.5; with 4 a thinner
tube remains (about 2,060 agents, 1.04 to 1.06 times the shortest route); with 16 a thicker one
(about 9,600 agents, 1.03 to 1.04).

The local solver against the exact solution in the Maze (seed 1): the flux on the cells that carry
more than 5 % of I0 is 40 % off at step 500, while the pressure still builds up along the route,
and 1 to 6 % off from step 1,000 on (1 % at step 1,000 and at 3,000, 6 % at 1,500, 5 % at 2,000).

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
- Open: the radius of the momentum. It was tuned with the fixed pressures of the prototype
  (decision 3). With the fixed flux of the app, the radius 0.999999 brings the error on the fixed
  Maze network below 5 % after 5,568 iterations, where the radius of the app, 0.99999, is at 44 %
  after 4,160 iterations and at 6.7 % after 16,000. A larger radius also lets a pressure swing
  longer. A change needs the tests of decision 6 and every measurement of the results again
  (`TODO.md`).
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
- Cost: the flow takes 1.5 to 1.7 ms more per step on 512 × 320 cells and 2.3 to 2.5 ms on
  512 × 512 (M3 Pro; table (c), which holds within about a sixth from run to run), 5 to 10 times
  the step of these scenes without it. At the default speed of 120 steps per second the steps
  then take a fifth (Maze on WebGPU) to more than a third (Tokyo on WebGL2) of the time. The frame
  budget (ADR 0028) lowers the steps per second on a slower GPU, and the startup check can lower
  the grid.
- The time limits of the new GPU tests follow ADR 0010: each limit is at least four times the time
  of the test on GitHub. In the three green CI runs of PR #44 on GitHub (commits `6ffed4b`,
  `92a63e7` and `fa05359`) the file `flow.gpu.test.ts` took 51.0 to 64.3 s in the WebGPU job and
  57.7 to 66.5 s in the other job. Its slowest test took 22.4 to 24.1 s of its limit of 240 s
  (WebGL2 without float blending), the next 10.7 to 13.7 s of 240 s (Kirchhoff's law on WebGPU).
  So the slowest test used at most 10.1 % of its limit, the next at most 5.7 %, and every other
  test of the file at most 4.3 %. The hook that compiles the pipelines took less than 14.1 s of
  600 s: that is the time of the file without the tests that the log lists. The test that was
  added last (a change of the rule of one agent per cell, growth, the food or the flow itself
  during a run) ran only in the third run: 1.1 s on WebGPU and 2.4 s on WebGL2, of 240 s. Two
  tests of `sim.gpu.test.ts` now also compile the passes with the flow: each took less than 0.6 s
  of its limit of 60 s. In the CI image on an M3 Pro (SwiftShader, 4 CPUs, 16 GB) the slowest test
  took 13.6 s and the compile hook 45 s on WebGPU.

## Correction after the merge (2026-11-13)

Coordinator's choice under the owner's delegation of 2026-11-12. The last reading of the CI logs of
PR #44, after its checks were green, found that the text as merged was not exact in three places
of the Consequences. No decision changes.

- It gave 67 s for the file `flow.gpu.test.ts` in the other job in the CI run of `92a63e7`. The
  log gives 66.5 s.
- It gave "at least 10 times" for the limit of the slowest test against its time in that run. The
  log gives 9.97 times (24.1 s of 240 s). ADR 0010 allows a quarter of the limit.
- It gave "about 1.5 ms" for the cost of the flow on 512 × 320 cells. Table (c) gives 1.49 ms on
  WebGPU and 1.71 ms on WebGL2.

The two points on the cost and on the time limits now give the range of table (c) and the numbers
of all three green CI runs of PR #44, with the time of the test that was added last. The
correction is its own pull request: the merge of PR #44 was released when its checks were green,
and the correction changes no code and no decision.

## How to check this record (2026-11-13)

Every number of this record comes from a script or a log in `research/flow/` (decision 16), or
from a test. `research/flow/README.md` has the full command lines, the time that each one takes
and what it must print. A script starts with
`node --import ./research/flow/register.mjs research/flow/<script>`. The script `logs.ts` unpacks
the logs first: they are one archive, and the folder `logs/` of the table below comes from it.
The files `engine/*.gpu.test.ts` are runs of the real engine in a headless browser, and they
start with `npx vitest run --config research/vitest.config.ts research/flow/<file>`.

| Part of this record                            | Script or command                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tero's ring                                    | `prototype/ring.ts`                                                                   |
| The pressure on a fixed network                | `prototype/static.ts`, `solvers.ts`, `prototype/static-ma.ts`                         |
| The exact flux on the moving network           | `prototype/vary.ts`, `prototype/track.ts`                                             |
| Context (no flow) and table (a)                | `summary.ts maze-campaign` on `logs/maze-pair/` and `logs/maze-sites/`                |
| Table (b)                                      | `summary.ts tokyo-campaign` on `logs/tokyo/`                                          |
| The runs behind (a) and (b)                    | `prototype/campaign.ts`, then `summary.ts compare` against `logs/`                    |
| Table (c), the cost                            | `engine/bench.gpu.test.ts`; `logs/engine/bench-*.jsonl`                               |
| Decision 3, the reference cell                 | `bounded.ts scene=isolated`                                                           |
| Decisions 5 and 8, the rejected rules          | `prototype/campaign.ts alternatives`; `summary.ts` on `logs/alternatives/`            |
| Decision 6, each rule alone                    | `bounded.ts scene=grow`                                                               |
| Decision 6, the local solver against the exact | `engine/dump.gpu.test.ts` with `VITE_DUMP_P=1`, then `engine/exact-flux.ts`           |
| Results in the app: the Maze and Tokyo         | `summary.ts engine-maze`, `engine-tokyo` and `engine-tokyo-end` on `logs/engine/`     |
| One run of the real engine                     | `engine/dump.gpu.test.ts`, then `engine/measure-maze.ts` or `engine/measure-tokyo.ts` |
| With the flow off                              | `engine/digest.gpu.test.ts`, then `summary.ts digests`                                |
| The rule itself                                | `npm test` (`flow.test.ts`), `npm run test:gpu` (`flow.gpu.test.ts`, 27 tests)        |

Checked on 2026-11-13 with the code in the repository:

- The prototype gives its logs again, bit for bit. The campaigns `maze-sites` (30 runs), `tokyo`
  (6 runs) and `alternatives` (4 runs) ran again in full, and `summary.ts compare` finds every row
  equal. Of the first Maze campaign of 2026-11-12, 53 of the 60 logs equal the rerun, among them
  all ten without a flow. 7 logs differed in late digits, so the whole campaign ran again and is
  the record now (decision 16).
- The real engine gives its lines again on the same machine: the Maze with seed 1 (11 of 11 steps),
  the Tokyo scene with seed 1 (10 of 10 steps to step 48,000 with the flux 1.4, and 4 of 4 steps
  to step 8,000 with the flux 2), the Maze without the flow (3 seeds), and the table of decision 6
  (all 16 lines of its eight rows).
- The digests of all 34 runs with the flow off equal those of `main` at `377f428`. The steps of
  the guide that make the digests of `377f428` in a second checkout give the digests of the record
  (34 of 34).
- One line of the record before the review was not kept, seed 4 of the runs with the flux 1. It
  ran again with the code of that time (commit `6ffed4b`); with it the ten seeds give the numbers
  of this record (TL 1.64 ± 0.10, 70 of 80 samples).
- The time of a step, table (c): six more runs. They are within a sixth of the table, but for one
  run with large jumps (the note below the table).

Two readers tested the guide. Both were agents without the context of this work. The first ran
every command of the guide and compared what it printed with the guide and with this record. All
commands ran, and the numbers held. It found faults in 16 points of the guide and of its tools,
and in 3 points of this record. The ones that mattered: `npx vitest run` without a project
failed; the tool that compares a rerun with the record could not fail; two measure scripts took
their own pictures for dumps and printed every line twice in a second call; the four rejected
rules had no command that gives their logs; times in the guide were guesses. The second read the
corrected guide against this record and the scripts, and found 12 points: results that were not
exact, words without an explanation, and text that the tools print in another form. All are
fixed, and tests hold the fixes of the tools (`research.test.ts`).

Not in the record: the Tokyo run without the growth gate (decision 9). It needs a build without
the two lines of the gate.
