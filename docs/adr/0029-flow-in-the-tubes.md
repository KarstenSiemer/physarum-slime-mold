# 0029: Flow in the tubes

- Status: accepted. The owner decided on 2026-11-12 that the flow is an option of the extended model
  that is off by default (decision 1). Every other decision here is the coordinator's choice under
  the owner's delegation of 2026-11-12, with its date and reason. The sections on the solvers and
  the mathematics and on how to check this record came on 2026-11-13, at the owner's request,
  with the research code in the repository (decision 16).
- Date: 2026-11-12
- In short: [`research/flow/README.md`](../../research/flow/README.md) tells on one page, in plain
  words, how this decision came about. This record has the details.
- Changed by [ADR 0031](0031-a-flow-for-every-strain.md) (2026-11-13): every strain has a flow of
  its own. This record is written for one strain. In a scene with several strains, each line of
  it holds for one strain: its trail, its tubes, its foods, its agents.
- Changed by the amendment 2026-11-14 (2) at the end of this record: a food site is a painted stroke, a dab or every
  segment of one drag, with every cell that it paints, and its flux enters at the covered cell nearest the start of
  the stroke (decision 17). Decision 5 holds with the port of a site in place of the cell of a site.
- Changed by [ADR 0032](0032-scenes-for-the-flow.md) (2026-11-13): the levels of the trail of
  decision 4, 0.2 and 1 deposits, hold at Jones' decay of 0.1 and follow the decay of the strain.

## Context

Step 4 of the owner's plan of 2026-11-11: tubes that carry much flow get thicker, and tubes with
little flow decay. In the real slime mould this gives the shortest tube in a maze (Nakagaki, Yamada
and Tóth 2000) and the network of the Tokyo experiment (Tero et al. 2010). Jones' agent model has no
flow (Jones 2015, Sec. 3: the population stands for the structure and the flux; no flux is
computed).

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
  paper measures a network by its total length TL and its mean shortest distance MD, each over
  the value of the minimum spanning tree, and by its fault tolerance FT: one minus the chance
  that the loss of one link separates a part of the network (p. 440; "The measures of a network"
  below).
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
the strain, the tube body B_c (0 to 1), the flow memory D_c (Tero's conductivity, 0.0001 to 1),
the conductivity g_c, and one pressure p_c for each of four fields (decision 5). Every strain has
these values for itself (ADR 0031; until then T_c was the trail of all strains, in deposits of
strain A).

```text
presence_c = clamp((T_c − 0.2 · d) / (d − 0.2 · d), 0, 1)     d: the deposit of the strain
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
s_c       +1 at the cell of a food site that gives in this field, −1 if it takes, else 0
r_c = clamp((H − s_c · (p_c − p̄)) / (0.25 · H), 0, 1),   H = 4,096 · I0     (the pressure limit)
p̄         the mean pressure, in this field, of the sites that give or take in at least one field
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
- A tube without flux, while a flux runs between two food sites elsewhere (without one, no cell
  adapts). With f = 0 the memory falls as D · (1 − 0.003)^t. From 0.2 to the level h = 0.01 it
  takes 998 steps, 33 minutes of model time (decision 10): 0.2 · 0.997^997 is still 0.010002. The
  continuous form, ln(20) / 0.003, gives 999.
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
     = 1 − the chance that the loss of one link separates a part of the network
```

The minimum spanning tree joins the food sources by straight lines with the least total length.
It has TL = 1, MD = 1 and FT = 0: every link of a tree is needed. So FT is not a ratio to the
tree, as TL and MD are. The paper writes FT_MST and says that all three are "normalized to the
corresponding value for the MST" (p. 440), but its numbers are the plain FT: a cut link separates
a part of the rail network in 4 % of the cases and of the organism's networks in 14 % and in 20 %,
which is FT 0.96, 0.86 and 0.80, and its supplement lists FT 0.00 for a tree (Fig. S1). The paper
measures the fault tolerance by the "failure of a single link" (caption of Fig. 3B) and does not
say whether a long link fails more often. Here every link counts once. If the network does not
join all food sources, the measures are those of the part that holds the first food source: its
links, and the food sources that it joins (`measures()` in `research/flow/prototype/tokyo.ts`).

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
three times as fast on this network (decision 3). The amendment 2026-11-15 measured it in the app:
the app keeps 0.99999.

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

The Maze scene on the CPU copy, 10 seeds each (1 to 10), the flow from step 500 on. "Ratio": trail
in the route's corridor over trail in the dead ends. "Below 10 %" and "below 2 %": the first step at
which the trail of the dead ends is below that share of the route's; median and range over the
seeds. "Tube": the length of the tube over the shortest route at step 10,000.

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

| Rule (flux 8 per food site)             | Seeds  | Agents alive at step 2,000 | Joined of 33, steps 2,000 to 7,000 | TL           | MD           | FT           |
| --------------------------------------- | ------ | -------------------------- | ---------------------------------- | ------------ | ------------ | ------------ |
| Tero, local solver, all sites at once   | 1, 2   | 3,947 and 4,013 of 5,293   | 33, but 28 at one of 6 steps each  | 1.41 to 1.67 | 0.83 to 0.90 | 0.75 to 0.93 |
| Ma's walkers                            | 1 to 3 | 147 to 160                 | 1 (no network), in 3 of 3 seeds    | none         | none         | none         |
| The organism (Tero et al. 2010, p. 440) | 21     |                            | all                                | 1.75 ± 0.30  | 0.85 ± 0.04  | 0.80 to 0.86 |

With Ma's walkers the network dies here too: 57 to 94 agents live from step 3,000 on. With Tero's
rule a flux of 4 gives a tree within 5,000 steps (TL 1.05 to 1.13, FT 0 to 0.43, seed 1), and a
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
   place of 224), which the rules of decision 6 would have to hold while the colony grows. Measured
   on 2026-11-15 (the amendment at the end of this record): while the colony grows they do not, and
   the app keeps 0.99999. The pressure of a step starts
   from the pressure of the step before, and keeps the pressure of the iteration before as momentum.
   Only a cell that conducts takes the momentum (ω); a cell without a tube takes the plain damped
   iteration (decision 6).

   Kirchhoff's law fixes the pressure only up to a constant. So the first two iterations of a step
   take the pressure of one cell off the whole field: the cell of the first site that gives or takes
   in at least one field, a cell of the network. The first version took the first site of the list.
   A review of 2026-11-13 found its fault: that site can lie under a wall, and a closed cell holds
   no pressure, so nothing was taken off. In the CPU copy with four covered sites, one of them not
   joined to the others, the mean pressure of the network then went to −2.9 · 10⁴ in 3,000 steps,
   and the flux of a cell was up to 2.8 % of the largest flux off. With the cell of the first site
   that gives or takes, the mean pressure is 18 after 6,000 steps, whatever the first site of the
   list is (`research/flow/bounded.ts scene=isolated` gives these numbers).

4. **The network is the grid.** Every open cell is a node, and two cells that share a side are
   joined by an edge. A cell has a conductivity g = B (0.02 + D): B is the tube body, the trail of
   the strain smoothed over time (rate 0.02 per step; presence from 0.2 to 1 deposits of the
   strain; no tube below B = 0.05; until ADR 0031 the trail of all strains, in deposits of strain
   A), and D is the flow memory, Tero's conductivity, from 0.0001 to 1. The
   base 0.02 lets a new tube carry a first flux. A food cell with a tube has g = 4 B, so the flux of
   a site spreads over its food before it enters the tubes. The conductance of an edge is the
   harmonic mean of its two cells, two half cells in series. Reason: the app has no graph of tubes;
   the trail is the plasmodium. The slow body keeps the conductivity from changing faster than the
   solver follows.

5. **Every covered food site gives or takes the flux at once, and as many give as take.** A site
   is the cell at the start of a food stroke: for a food dot that is its centre, and every food of
   a scene is a dot (at most 64 sites; with more foods, sites spread evenly over the list). The
   plasmodium covers a site while the cell of the site holds a tube (B ≥ 0.05); a site reads this
   from the memory of the step before. So in the step in which its tube body falls below 0.05, a
   site gives or takes once more, into a cell that no longer conducts, and the pressure limit of
   decision 6 bounds what that does. Four
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
     pressure lies within 4,096 · I0 of the mean pressure of the sites, on the side it pushes to;
     the flux falls to nothing over the last quarter of that range. The mean of a field runs over
     every site that gives or takes in at least one field, so a site that rests in the field
     counts too. So a site that no tube joins to the others stops, as a pump does against a closed
     pipe, and its part of the network does not move away from the rest without limit.
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
   Ground that never held a tube has D = 0.2. Ground that lost its tube has at most D = 0.2: a
   larger memory falls to 0.2 at once, so that ground without a tube is never better than fresh
   ground. A smaller memory stays and recovers slowly, by the factor 1.00023 per step up to 0.2.
   Reason for the slow recovery: when starved ground was fresh again at once, agents came back at
   once, and faint strands lived for ever. Measured on 2026-11-15 with 12, 6, 3 and 1 h in place of
   18 h (decision 19, amendment 2026-11-15 (2)): each shorter time lets the mesh grow back between the
   tubes, and the factor stays.

8. **The flux decides where agents live.** An agent on a cell with the flow memory D dies with the
   chance 0.02 · h² / (D² + h²) per step, h = 0.01. A dead agent draws one random cell per step; if
   the cell is open, holds a tube and has D above 0.5, the agent comes to life there with the chance
   0.2 · (D − 0.5) / 0.5. With the rule of one agent per cell the cell must be empty, and the agent
   claims it as a move does (ADR 0008). An agent has one placement per step: an agent that a held
   tool places in a step (inoculate or cut, ADR 0023) does not come to life by the flow in that step
   too. Every other dead agent can come to life by the flow also while a tool is held. The tube
   and the flow memory are those of the agent's strain (ADR 0031; until then any tube gave life to
   the agents of every strain). So a tube
   that carries flux fills up and gets wider, until the flux per cell falls. Rejected, with the
   prototype: (a) a deposit scaled by the flow memory alone: the dead ends stay, because Jones'
   agents steer by the difference between their sensors and not by the amount of trail; (b)
   starvation without births: the tube of the route dies out too, more slowly. Both ran again on
   2026-11-13 (seed 1, `research/flow/logs/alternatives/`): with (a), the deposit times 0.3 to 2.3
   by the flow memory, the dead ends never fall below a fifth of the route's trail in 6,000 steps;
   with (b) the dead ends are below 2 % at step 3,250, and 258 agents live at step 10,000, when the
   two foods are no longer joined.

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
    | A tube without flux starves   | 998 (0.2 · 0.997ⁿ ≤ 0.01)       | 33 min     | veins vanish in 15 to 40 min       |
    | The foods keep their roles    | 300                             | 10 min     | (this app's choice)                |
    | Starved ground is fresh again | ln(2000) / ln(1.00023) = 33,050 | 18 h       | (measured, decision 19)            |

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
      2026-11-13): 126 files and 1.8 MB of text in 0.4 MB (146 files since ADR 0031, 157 since
      ADR 0032, 160 since ADR 0034, 182 since decision 17 and 194 since decision 18, in 0.5 MB).
      `research/flow/logs.ts` unpacks it to
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
      record does not have. And it holds the archive: a digest of its files, so that a change
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

The amendment 2026-11-14 (2) at the end of this record measures the Maze and the Tokyo scene again with the food sites
of decision 17, its numbers beside those of this section. The amendment 2026-11-15 measures them with another radius of
the solver, and the Tokyo scene with the fluxes 1 and 2 and the sites of decision 17.

All numbers are from the real engine (M3 Pro, Chromium with Metal, 2026-11-13), measured on dumps of
the trail with the scripts of the prototype. A seed is the setting Seed of the scene: the same seed
gives the same run on the same backend and GPU (`research/flow/engine/`; the lines of every run are
in `research/flow/logs/engine/`). The tables are from the code after the review (commit `92a63e7`).
The same runs with the code before the review gave the same picture; where they add something, the
text names them. The review changed the random stream of the starvation draw and the cell that the
pressure is recentred by: single runs differ, the rule does not. One check was not run again and is
from the code before the review: the control without the growth gate (decision 9).

Pictures from the app's own renderer (`npm run gallery`, seed 7): [maze-flow.jpg](../images/maze-flow.jpg) is
the Maze at step 5,000 without and with the flow, [tokyo-flow.jpg](../images/tokyo-flow.jpg) the Tokyo scene at
step 12,000 without and with the flow, and [tokyo-time.jpg](../images/tokyo-time.jpg) the Tokyo scene at step
1,000 and at step 48,000. They were made again on 2026-11-13 with the picture of the tubes
(ADR 0034), which draws every tube as wide as its flow memory says: `tests/pictures/readme.spec.ts`
makes the three files.

### The Maze (flux 8)

Ten seeds on WebGPU (1 to 10), three on WebGL2 (1 to 3), three without the flow (1 to 3). "Dead ends
over route": the mean trail in the dead ends over the mean trail in the corridor of the shortest
route. Median and range.

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

Without the flow a mesh stays in every corridor. With it one tube remains, and it pulls tight: 1.20
times the shortest route at step 1,000 and 1.10 at step 15,000. Other flow strengths, two seeds each
(1 and 2): with 2 the tube dies out (about 60 agents left, foods not joined), because the Maze has
no growth and dead agents come to life only where the flow memory is above 0.5; with 4 a thinner
tube remains (about 2,060 agents, 1.04 to 1.06 times the shortest route); with 16 a thicker one
(about 9,600 agents, 1.03 to 1.04).

The local solver against the exact solution in the Maze (seed 1): the flux on the cells that carry
more than 5 % of I0 is 40 % off at step 500, while the pressure still builds up along the route,
and 1 to 6 % off from step 1,000 on (1 % at step 1,000 and at 3,000, 6 % at 1,500, 5 % at 2,000).

### The Tokyo rail network

The scene as it loads (flux 1.4), ten seeds on WebGPU (1 to 10), measured as in the paper (p. 440)
on the 33 food sources of its Fig. 2: the trail above 1.5 is the network, thinned to lines; a link
is a line between two junctions or food sources. TL and MD are over the values of the minimum
spanning tree; FT is the share of the links whose loss separates no food source ("The measures of a
network"). Median and range over the seeds.

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
land in 11 to 16 h and has its network at 26 h. These times are a reading of the pictures of
Fig. 1, whose panels show 0, 5, 8, 11, 16 and 26 h; the paper states no time for these stages.
The scene is at these stages after about 1 h and after 7 to 13 h of model time: Jones' growth
rule has no speed of its own to set, and it is about ten times as fast as the organism against
the time of the adaptation.

Three flow strengths, ten seeds each (1 to 10) on WebGPU to step 48,000. The measures are the mean
and the standard deviation at step 48,000. "Samples" are the 8 measured steps from 4,000 to 48,000
of each seed, 80 in all.

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
Fig. S1): with a flux of 4 and of 8 (seeds 1 to 3 each, step 24,000) TL is 1.97 (1.89 to 2.25) and
2.34 (2.32 to 2.36), and FT is 0.95 and 0.97. With 1 and with 1.4 every measure lies within one
standard deviation of the organism's. With 2, TL is 0.4 standard deviations above, MD is one
standard deviation off, and FT one (without light) to two (with light). The strengths do not
differ in how often one food source is without a tube above the level of the measure: 7, 7 and 8
of 80 samples.

The scene uses 1.4: in both sets of runs its total length is the organism's (1.77 against 1.75). A
flux of 1 is as near to the organism in MD and FT, within the spread of the seeds, and a little
shorter in TL (1.71, and 1.64 before the review).

Without the flow (seed 1) the mesh of Jones' growth rule stays: TL 2.70 to 2.88 and FT 0.96 to 0.99
from step 2,000 to step 24,000, with 76 to 88 links. On WebGL2 (seeds 1 and 2) the scene gives TL
1.72 and 1.91, MD 0.82 and 0.83 and FT 0.90 and 0.92 at step 24,000, within the range of the ten
seeds on WebGPU.

### With the flow off

With `flow` off the branch gives the bytes of `main` (`377f428`): the 16 scenes of `main` and the
default settings, 500 steps from seed 12345, on WebGPU and on WebGL2; the Maze with its flow
switched off. The SHA-256 digests of the agents, the trail, the scent and the environment are equal
in 34 of 34 runs (M3 Pro, 2026-11-13, checked again with commit `92a63e7` after the review). The
sources of `agents.wgsl` and `growth.wgsl` without the lines of the flow equal the files of `main`
character for character (decision 13).

The Foraging maze with the flow switched on (flux 8, seeds 1 to 3; the scene itself keeps it off):
the colony grows from the first food and reaches the far food between step 4,000 and step 6,000.
From then on both foods are covered, the flux runs, and the mesh thins to one tube: 1.04 to 1.07
times the shortest route at step 12,000. The dead ends hold 37 to 63 % of the route's trail at
step 8,000 and 20 to 28 % at step 12,000.

### The tests against wrong rules

A test is worth what it catches. On 2026-11-13, 22 wrong rules were put into the code, one at a
time: 12 into the WGSL shaders, 9 into the GLSL shaders and 1 into the WebGPU backend. For each
one the GPU tests of the flow ran on the backend of that code (`src/engine/flow.gpu.test.ts`, 27
tests). Every wrong rule fails at least one test. `research/flow/engine/mutate.ts` has the 22
changes and runs them again; its log is `research/flow/logs/engine/mutations.txt`.

| Wrong rule                                       | In                 | Tests that fail                                                                                                  |
| ------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| The momentum on every cell                       | WGSL, GLSL         | follows the CPU reference                                                                                        |
| No pressure limit                                | WGSL, GLSL         | stops a food at its pressure limit                                                                               |
| Food without a tube conducts                     | WGSL, GLSL         | gives food without a tube no conductivity                                                                        |
| A tube adapts without a flux                     | WGSL, GLSL         | follows the CPU reference; lets a food give or take only when a tube covers it and one more food                 |
| Every food counts as covered                     | WGSL, GLSL         | lets a food give or take only when a tube covers it and one more food; gives food without a tube no conductivity |
| Give and take swapped                            | WGSL               | follows the CPU reference; obeys Kirchhoff's law; stops a food at its pressure limit                             |
| No ghost conductivity                            | WGSL               | follows the CPU reference; stops a food at its pressure limit                                                    |
| The pressure is not recentred                    | WGSL               | follows the CPU reference, and four more tests                                                                   |
| The first site of the list as the reference cell | WGSL, GLSL         | follows the CPU reference                                                                                        |
| The bind group of `settle` without the variant   | the WebGPU backend | keeps stepping when the trail saturation or the walls change during a run with the flow                          |
| No starvation                                    | WGSL, GLSL         | lets agents starve on cells that the flux passed by, and brings dead agents to life on fed cells                 |
| A birth at any flow memory                       | WGSL, GLSL         | the test of starvation and births; lets no agent divide on a cell that the flux passed by                        |
| An agent divides on a starved cell               | WGSL, GLSL         | lets no agent divide on a cell that the flux passed by                                                           |

Two of these rules fail only the test that compares a backend with the CPU copy of the passes,
step by step: that test holds a rule only as long as the CPU copy has it. What the tests did not
hold on that day: no test brought a dead agent to life while a tool is held (decision 8). ADR 0031
has that test, and the wrong rules of the flow of each strain.

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
- Closed on 2026-11-15 (the amendment of that day): the radius of the momentum. It was tuned with
  the fixed pressures of the prototype (decision 3). With the fixed flux of the app, the radius
  0.999999 brings the error on the fixed Maze network below 5 % after 5,568 iterations, where the
  radius of the app, 0.99999, is at 44 % after 4,160 iterations and at 6.7 % after 16,000. A larger
  radius also lets a pressure swing longer. A change needed the tests of decision 6 and every
  measurement of the results again (`TODO.md`). They were made, and the app keeps 0.99999.
- A fault, fixed in ADR 0031 (the owner saw it on 2026-11-13): the flow brought dead agents of
  every strain to life. In a scene with several strains, a strain without a living agent appeared
  on the tubes of another strain as soon as a flux ran (the Foraging maze with the flow and a
  second strain switched on). The rule of decision 8 did not look at the strain of the agent.
- Open (the owner, 2026-11-13): the picture does not show how strong a tube is. It shows the
  trail of the agents, and a tube of Jones' agents has about the same width everywhere. The flow
  memory holds how strong a tube is, and no view draws it (`TODO.md`).
- The pressure lags the roles after each draw (decision 10), and it lags more across a weak tube.
  The four fields and the slow adaptation (333 steps) average over this. The results in the app are
  measured with this lag.
- Starved ground stays closed to the colony for hours of model time. A colony that lost a region
  does not grow back into it soon. Measured on 2026-11-15 on the Tokyo map (amendment 2026-11-15 (2)):
  the colony grows back into a region whose network was taken off, and to foods that were taken away
  and come back, within minutes to half an hour of model time; the ground between the tubes stays closed.
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
| The tests against wrong rules                  | `engine/mutate.ts`; `logs/engine/mutations.txt`                                       |

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

## Amendment 2026-11-14: four open points, a fault of painted food, and the plan

### Context

The owner asked on 2026-11-14 about four open points of `TODO.md`: where a strain has a food site, the radius of the
pressure solver, how long starved ground stays closed, and light on the Tokyo map. A reader went through the code,
this ADR, the text of Tero et al. 2010 and a web search; the coordinator checked the main numbers again. The web
sources were read as summaries only, as marked below.

### What is true today

- **Food sites.** `Engine.syncSites()` takes the start point (`from`) of every painted food stroke, and `flowSites()`
  (`src/engine/flow.ts`) makes each one a site of one cell, each cell once, at most `FLOW_SITES` = 64. A strain covers a
  site while that cell holds food and the strain's tube body there is at least 0.05 (`covered()` in `flow.wgsl`).
  Several strains on the same cell each give or take the full I0 in their own flow (ADR 0031): the flux is not split.
  The setting Covered food ([model.md](../model.md), section 6.5) is another rule: it lowers the scent of a food cell
  next to an agent of any strain, it reads nothing of the flow, and it is off in every scene.
- **The radius of the solver** (decision 3) is a number of the local solver only. Tero et al. solve the linear system
  exactly with conjugate gradients (Solver 1 above). Today r = 0.99999 gives ω = 1.9911. The slowest mode measured on
  the fixed Maze network, μ ≈ 1 − 6.5·10⁻⁷ (above both radii below), falls to 1/e in about 6,770 iterations, 423
  steps, while the roles of a lane hold 300 steps (`FLOW_HOLD`). With r = 0.999999 it takes about 1,730 iterations, 108
  steps. The coordinator computed both from the recurrence of the iteration. The only measured data are the cold starts
  of `research/flow/solvers.ts` on the fixed Maze network (TODO.md has them); no run on Tokyo or on a network that
  moves.
- **Starved ground** comes back by the factor 1.00023 per step from the floor 10⁻⁴ to 0.2: ln(2000) / ln(1.00023) =
  33,051 steps, 18.4 h of model time (decision 7). The reason for a slow return is in decision 7: faint strands lived
  for ever when starved ground was fresh again at once. That observation has no log, and no run varied the factor.
  The organism avoids ground with its own extracellular slime (Reid et al. 2012, PNAS; a Y-maze and a U-shaped trap,
  read as a summary). The slime is a cue that the ground likely holds no food, and the plasmodium enters it when it
  perceives food (Reid et al. 2013, Behavioral Ecology; abstract only). No source found says how long the effect lasts.
- **Light on the Tokyo map.** Tero et al. 2010 (p. 440, captions of Fig. 2 and 3) lit the map with a mask: brighter
  with the altitude of the land, and bright light on the ocean and the inland lakes, so that the plasmodium grew in the
  lowlands. The lit networks looked closer to the rail network. One number: a cut of one link isolated a part in
  14 ± 4 % of the lit networks and in 20 ± 13 % of the networks without light; the rail network has 4 %. The app's
  Tokyo scene has the coast as walls and no light, so Lake Kasumigaura is open land (`src/model/tokyo.ts`). None of
  the 36 cities lies in the mountains. The rail lines run on the plain and along the foot of the mountains, and the few
  that cross them use tunnels, for example the Chūō line through the Sasago tunnel; the Jōban line passes west of
  Kasumigaura (web search, summaries). A light shape of the app has one strength only (`src/model/presets.ts`).

### A fault: a dragged food line gives many sites

The brush records a segment each time the pointer has moved half a brush radius (`BrushDrag`, `src/ui/drag.ts`), and
each segment is a stroke of the edit list. So a dragged line of food gives one site for every half radius of its
length, and each site gives or takes the full I0: a long line pulls more flux than a dab. Above 64 sites `flowSites()`
takes an even spread of them, which can drop the food of a scene (the Tokyo map has 42 sites, ADR 0032). Not measured
in a run; it follows from the code. `TODO.md` has it.

### Decision

The coordinator's choices under the owner's delegation of 2026-11-12, told to the owner on 2026-11-14. Each one is
built and measured in a pull request of its own, which records its numbers here.

17. **A food site is one painted food stroke of the user or the scene: a dab, or every segment of one drag together.**
    A strain covers it while its tube holds any cell of it, and its flux enters at the covered cell nearest the centre
    of the stroke, so the roles, the pressure limit and the zero point keep working on one cell. Every strain keeps
    the full I0: a share of the food between strains would be a rule without a source. Food dots that touch stay
    sites of their own, or the seven dabs of Tokyo itself (`TOKYO_DABS`, seven sources as in Fig. 4 of the paper)
    would become one site. This also ends the fault above. The edit list must then know which segments form one drag,
    and a link must carry that (ADR 0021). The Maze and the Tokyo scene change their bytes, so their measurements of
    this ADR are run again.
18. **The radius 0.999999 is the candidate, and it is taken only after measurements:** `solvers.ts` on a dump of
    Tokyo and with a new draw of roles on a warm network; the tests of the bounded pressure (decision 6); the local
    flux against the exact one on Tokyo dumps at steps 500, 2,000, 4,000 and 8,000; and the campaigns of the Maze and
    of Tokyo with 10 seeds and the flow strengths 1, 1.4 and 2, because 1.4 was chosen with the old radius. The largest
    radius that keeps the pressure bounded and lowers the error is taken.
19. **The time until starved ground is fresh again is measured, not set:** 18, 6, 3 and 1 h on Tokyo with 10 seeds, and
    a test in which the network grows back into a cut region. The shortest time at which the faint strands of decision
    7 do not come back is taken. A later option, closer to the organism: the scent of food lifts the mark.
20. **A second Tokyo scene, with light on the lakes and the mountains.** The scene of today stays unchanged: it is the
    protocol without light, and every number of this ADR is measured on it. The new scene needs an elevation map and
    the lakes under licences that fit the project, checked first, and a decision between light of one strength and
    light that grows with the altitude, which is a new rule.

### Consequences

- The order of the work: decision 17 first, as it also ends the fault; then 18, 19 and 20.
- `TODO.md` names this amendment in the four items and has an item for the fault.

## Amendment 2026-11-14 (2): a site is a stroke, as built

Decision 17 as built and measured. The design is the coordinator's, under the owner's delegation of 2026-11-12. The
points marked "own choice" came up while it was built; they are the builder's choices, each with its reason.

### The rule

1. **A site is one stroke.** In the edit list a food edit goes on with the stroke of the edit just before it when that
   edit is food too, both have the same radius, grid and arena, and the new edit starts exactly where that edit ends
   (`continues()` and `foodStrokes()` in `src/engine/sites.ts`). `BrushDrag` makes such chains: its first call is a
   dab, and every later segment starts at the end of the one before. The rule reads only the geometry of the list.
   Decision 17 said that the edit list must learn which segments form one drag; it need not, and the link format
   stays as it is. A link holds every position in whole steps of 1/16 cell, so it holds the end of a segment and the
   start of the next exactly, and a link made before this amendment gives the same sites as a new one (ADR 0021).
   - Own choice: on a periodic grid the new edit may also start one or more whole periods of its grid away from the
     end of the edit before. The list moves an edit that starts on a copy of the grid into the grid (`fromStroke()`),
     so each segment of a drag over the edge of the grid starts a period away from the end of the one before. Without
     this a drag over the edge would split into two sites, on the arena of the default settings.
   - Where the rule differs from the drag. A drag splits where the view moves or zooms during it (`BrushDrag` maps its
     last pixel onto the view of now), where the grid changes during it (the edit names its grid), where the brush
     radius changes, where a segment paints no cell of a closed arena and is not recorded, and where the sweep deletes
     a segment in the middle because later erases cleared all of it. A new dab exactly at the end of a drag, with the
     same radius on the same grid, joins the drag; so does a dab exactly on another dab of the same radius.
2. **The cells of a site** are the cells that its segments paint with food on the grid of the simulation, by the rule
   of the paint passes (`someCell()` in `brush.ts` without slack; `paintReference()` and both paint passes have the
   same rule). Float32 on the GPU can judge a cell at the very edge of a brush the other way; such a cell then holds
   no food and never covers its site. The engine maps every segment onto the grid as it paints it (`strokeOn()`), so
   a site follows its stroke onto every grid. The **centre** of a site is the start of its first segment on that
   grid: for a dab, its centre.
   - Own choice: a cell that two strokes paint belongs to the one whose centre is nearer, on a tie to the one earlier in
     the list, among all strokes of the list, and a stroke left without a cell is no site. So no cell is in two sites,
     and no two sites can share a port. A shared port would hold the roles of two sites in one cell, and the balance of
     decision 6, as many give as take, would break. It also bounds the list by the grid: one index of 4 B per cell at
     most, which the memory fit now counts once for all strains (`SITE_BYTES_PER_CELL` in `sizing.ts`). Two dabs that
     touch or overlap stay two sites, each with the cells nearer its own centre: the seven dabs of Tokyo stay seven
     sites, and the map has 42 sites as before. Rejected: the cell to the later stroke, as the order of painting would
     give it; and the cell in both sites, with the second port given to the first site, so that the second loses its
     role for no reason that it can see.
   - Then, with more than 64 strokes that keep a cell, 64 of them spread evenly over those take part, the first one
     always, as before. The first build picked the 64 among all strokes that paint a cell and gave out the shared cells
     among those 64 only, so a picked stroke that lost every cell left its place empty: 70 dabs, the second a smaller
     twin at the centre of the first, gave 63 sites while 6 strokes that were not picked kept cells. A review found it
     on 2026-11-15; `sites.test.ts` holds the case, and the wrong rule C7 of `mutate.ts` puts it back.
3. **Covered, and the port.** A strain covers a site while one of the cells of the site is open and holds food and a
   tube of the strain (B ≥ 0.05 in the memory before the step). Its **port** is the covered cell nearest the centre,
   on a tie the one with the lower index y · W + x; on a periodic grid the distance is to the nearest copy of the
   centre. The engine sorts the cells of a site in this order on the CPU, in float64, so the port is the first covered
   entry of the list of the site, the same on both backends and in the CPU copy. The flux of the strain enters and
   leaves the site at its port. The roles, the pressure limit (P̄ is the mean at the ports) and the zero point read the
   ports. Every strain keeps the whole I0: no share.
   - Own choice: a cell under a wall does not cover. Food painted over a wall stays under it, and a wall painted over a
     tube keeps its tube body for one step: a food painted in the same frame would make that closed cell a port. A
     closed cell takes no role in `update`, so the roles would no longer balance.
   - Own choice: "at least two sites had a role in the step before" (decision 5, `fed`) reads the roles at the ports of
     the step before, where `update` wrote them: the pass keeps them beside the ports of the step. At the ports of the
     step it would miss the role of a site whose port moved.
   - Own choice: while no site gives or takes, the zero point is the first cell of the first site, where it was the
     cell of the first site.
   - A consequence of the tie rule: a dab whose centre lies on the edge between two cells, as both foods of the Maze on
     512 × 320 cells do (y = 32 and y = 288), has its port in the upper cell while both cells are covered; the cell of
     the site was the lower one.
4. **The passes of the ports** run once per step, before the update of the first strain. A pass that looks at the
   cells of a site one after the other is too slow: a dab of 250,000 cells that no tube covers took 128 ms more per
   step on WebGPU, about 0.5 µs per cell (`research/flow/engine/sites-bench.gpu.test.ts`, a first build). So the list
   is cut into blocks of 64 entries: each run of a site starts at a block and ends with "no cell" up to the next block,
   so a block holds one site (`SITE_BLOCK` and `NO_CELL` in `sites.ts`). The first pass finds in every block and for
   every strain the first entry that covers its site (`blocks` in `flow.wgsl`, PASS 2 of `flow.frag`). The second
   looks at the blocks of each site in 64 lanes, each lane every 64th block from its own, up to its first block with a
   hit, and takes the least hit of the lanes (`sites` in `flow.wgsl`, a workgroup per site and strain; PASS 3 and 4 of
   `flow.frag`, a texel per site, strain and lane, then a texel per site and strain). The port of the step before stays
   beside the port of the step, for `fed`. The cells and the hits are a storage buffer each on WebGPU and a target of
   R32F each, as wide as the grid, on WebGL2; they are made again only when the list outgrows them. The uniform block
   keeps its size: a site holds its first cell, the start of its run and its count, and the block holds the number of
   blocks, all whole numbers below 2^24 and so exact in float32. The CPU copy finds the same port by looking at the
   list in order (`flowPorts()` in `flow-reference.ts`).
5. With the flow off no pass runs, nothing is allocated, and the engine does not map the sites.

The start layout Food (ADR 0032) put strain B on the second food edit of the list, so after a drag on the second
segment of that drag. Own choice: it now takes the strokes of decision 17, strain A at the start of the first food
stroke and strain B at the start of the second (`seedAtFood()`). Every scene has dabs only, so no scene changes.

The research scripts of decisions 3 and 6 (`bounded.ts`, `solvers.ts`) keep the sites of their record: each food is
a site of one cell, a dab of radius 0.5 at the centre of a cell. With one cell, a site of decision 17 is covered while
that cell is, and that cell is its port: `bounded.ts` still finds `rules.ts`, which has the rule of the record, equal
to the CPU copy bit for bit, and `research.test.ts` (`RESEARCH=full`) passes.

### Cost

On the GPU, per step, from `research/flow/engine/bench.gpu.test.ts` (table (c)): two runs of `main` and two of this
build, one after the other on the same evening with no other run on the GPU (M3 Pro; the medians of 21 samples of 50
steps after 3,000 steps).

| Scene and backend | `main`, ms per step | This build, ms per step |
| ----------------- | ------------------- | ----------------------- |
| Maze, WebGPU      | 2.31 and 2.36       | 2.27 and 2.30           |
| Tokyo, WebGPU     | 3.71 and 3.59       | 3.58 and 3.57           |
| Maze, WebGL2      | 2.76 and 2.85       | 2.75 and 2.73           |
| Tokyo, WebGL2     | 4.19 and 4.26       | 4.29 and 4.23           |

So the passes of the ports cost less than the spread of the bench, about 0.1 ms: two dispatches per step on WebGPU and
three draws on WebGL2, on lists of 212 cells (the Maze) and 2,613 cells (Tokyo, 42 sites of 59 to 65 cells,
`research/flow/sites.ts`). These runs of the bench are slower than table (c) of 2026-11-13 on both sides; the machine
ran other programs that evening, and the cause is not known. A large site that no tube covers costs no time above the
noise either (`sites-bench.gpu.test.ts`; the default grid of 1,536 × 960 cells, where a step with the flow takes 22.5
ms): 23.0, 23.2 and 23.0 ms per step with a dab of 10,029, 100,121 and 249,773 cells on WebGPU, 22.4, 22.3 and 22.7 ms
on WebGL2. The first build looked at the cells of a site one after the other: there the same three dabs took 27.9, 73.6
and 150.7 ms per step on WebGPU, which is why the passes work in blocks.

On the CPU, after a paint, the engine keeps the cells of each stroke between calls (`SiteCells`), so a drag costs its
new segment and one pass over the cells of the other strokes (`research/flow/sites.ts`, Node 26, M3 Pro): on the default
grid, beside 40 dabs, a drag with a brush of 6, 30 and 90 cells costs 0.12, 0.50 and 4.1 ms per segment (35,000, 82,000
and 238,000 cells in the end), a call with nothing new 0.05 to 0.08 ms, and a new grid 13, 31 and 87 ms
(`logs/engine/sites-cpu.jsonl`). The memory: at most 4 B per cell for the cells and 4 B per 64 cells and strain for the
hits of the blocks.

### The tests and the wrong rules

New unit tests in Node: `src/engine/sites.test.ts` (the strokes of a list: a drag, what `BrushDrag` records, dabs that
touch, another radius, grid, arena or kind, a drag over the edge of a periodic grid, a dab at the end of a drag, an old
link, a row of straight lines with Shift as `StraightLine` makes them (ADR 0035); the cells: the paint rule in every
arena, the order, a shared cell, a shared cell of two dabs whose cells meet in one column, a stroke without a cell, the
spread over more than 64 strokes, the shared cells given out before the 64 are taken, the cells kept between calls,
another grid, the blocks of the list) and in `src/engine/engine-env.test.ts` (the sites of the engine are its strokes
with every food cell, a drag of the brush is one site, a link gives the sites of its list, and the start layout Food
puts each strain on a stroke of its own).

New GPU tests on both backends (`src/engine/flow.gpu.test.ts`): a dragged line of eleven segments, held in a link, is
one site with its port at the covered cell nearest its start and the flux I0; a strain covers a dab from a cell two
cells from its centre, and the port moves to the centre when the tube grows there; two strains on the same two dabs,
each from its own side, each carry I0; two dabs that overlap stay two sites; the CPU copy while a port moves; the port
of a dab of about 11,300 cells that a tube covers only from 38 to 60 cells from its centre, with hits in lanes before
and after the lane of the port; two strains on that site from its two sides, each in the rows of the hits of its own
strain on WebGL2; a change of the sites during a run; the CPU copy while the list of sites gets shorter; 64 sites of 65
strokes, all covered, against the CPU copy; a cell that an erase cleared holds no port; and the pressure limit with
ports off the centre. The test of the CPU copy holds a food under a wall, a food half under a wall, a food painted over
the wall, and a food at the edge of a block without a tube.

`research/flow/engine/mutate.ts` has 34 new wrong rules, and runs the unit tests of their file for a rule on the CPU.
All 75 wrong rules of the flow ran (`logs/engine/sites-mutations.txt`): two survived, the mean pressure of the pressure
limit at the first cells of the sites in place of their ports (P9, Q9), because every site of the test of the limit had
its port at its first cell. The test of the limit with ports off the centre catches them. The 38 rules of the passes of
the ports ran again with the passes in blocks and every test (`logs/engine/sites-mutations-blocks.txt`): 37 of the 38
failed a test. The port at the hit of any lane in place of the least (P11) did not on WebGPU: in the test of the large
site every farther hit lay in a later lane than the port, and the store of the earliest lane won on this GPU. That test
now covers cells of the site in lanes before and after the lane of the port, and P1, P11, Q1 and Q11 ran once more (at
the end of the same log). A review on 2026-11-15 asked for four more tests: the shared cells given out before the 64
sites are taken, two strains on a large site, a list of sites that gets shorter, and 64 sites. With them come 8 more
wrong rules: C7, C8 and C3 to C6 again on `sites.ts`, and P13, P14, Q13 to Q15 and R1 on the passes and the CPU copy
(`logs/engine/sites-mutations-review.txt`). Every one fails a test, so all 83 wrong rules of the flow do.

| Wrong rule                                                                   | In            | A test that fails                                    |
| ---------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| Every food cell counts as covered (W5, F5, in the new pass)                  | WGSL, GLSL    | follows the CPU reference, and 11 more               |
| Only the first block of a site covers it (P1, Q1)                            | WGSL, GLSL    | finds the port of a large site                       |
| The hit of a block at its last covered entry (P2, Q2)                        | WGSL, GLSL    | follows the CPU reference                            |
| A cell without food covers its site (P3, Q3)                                 | WGSL, GLSL    | lets no cell of a site that an erase cleared hold it |
| A cell under a wall covers its site (P4, Q4)                                 | WGSL, GLSL    | follows the CPU reference                            |
| The roles of the step before read at the ports of this step (P5, Q5)         | WGSL, GLSL    | follows the CPU reference while a port moves         |
| The port of the step before not kept (P6, Q6)                                | WGSL, GLSL    | follows the CPU reference while a port moves         |
| The roles at the first cell of a site (P7, Q7)                               | WGSL, GLSL    | makes one food site of a dragged line                |
| The pressure recentred by the first cell of a site (P8, Q8)                  | WGSL, GLSL    | follows the CPU reference                            |
| The mean pressure of the limit at the first cells (P9, Q9)                   | WGSL, GLSL    | stops a food at its pressure limit, off the centre   |
| The ports of every strain from the memory of the first strain (P10, Q10)     | WGSL, GLSL    | gives each of two strains its whole flux             |
| The port at the hit of any lane, not the least (P11, Q11)                    | WGSL, GLSL    | finds the port of a large site                       |
| The hits of every strain from those of the first strain (P12, Q12)           | WGSL, GLSL    | gives each of two strains its whole flux             |
| The cells not taken to the GPU after a change of the sites (S4, L4)          | both backends | follows a change of the food sites during a run      |
| A site for every segment; a drag over the edge splits (C1, C2)               | `sites.ts`    | the strokes of a drag over the edge of the grid      |
| A shared cell to the later site on a tie; sites share cells (C3, C4)         | `sites.ts`    | a shared cell to the nearer centre                   |
| The cells in the order of their index; the centre at the end (C5, C6)        | `sites.ts`    | the order of the cells                               |
| A site for every food edit; the second colony on the second segment (E1, E2) | `engine.ts`   | a drag is one site; the start layout Food            |
| A stroke left without a cell takes one of the 64 places (C7)                 | `sites.ts`    | the shared cells first, then the 64                  |
| Two boxes that meet in one column of cells do not meet (C8)                  | `sites.ts`    | a shared cell of dabs that meet in one column        |
| `fed` reads the ports of the sites of now only (P13, Q14, R1)                | all three     | the CPU copy while the list of sites gets shorter    |
| No port for the 64th site (P14, Q15)                                         | WGSL, GLSL    | 64 sites of 65 strokes                               |
| The hits of strain s from row s, not from row s · hitRows (Q13)              | GLSL          | two strains on a large site                          |

### The measurements again

The campaigns of "Results in the app", with the commands of `research/flow/README.md` (part 11), from commit
`ad84ee7` of this pull request, on 2026-11-14 (M3 Pro, Chromium with Metal). The record of before is that of
`92a63e7`; `main` at `5195079` still gives its lines bit for bit (the Maze with seed 1 to step 15,000 and the Tokyo
scene with seed 1 to step 8,000, checked the same evening). Median and range over the seeds.

**The Maze** (flux 8; dead ends over route as in "The Maze (flux 8)"):

| Step                               | WebGPU, 10 seeds, before | WebGPU, 10 seeds, now  | WebGL2, 3 seeds, before | WebGL2, 3 seeds, now   |
| ---------------------------------- | ------------------------ | ---------------------- | ----------------------- | ---------------------- |
| Dead ends over route at 1,000      | 0.54 (0.50 to 0.59)      | 0.53 (0.48 to 0.59)    | 0.54 (0.51 to 0.55)     | 0.54 (0.47 to 0.56)    |
| at 1,500                           | 0.089 (0.064 to 0.127)   | 0.083 (0.052 to 0.138) | 0.104 (0.088 to 0.105)  | 0.090 (0.066 to 0.101) |
| at 2,000                           | 0.025 (0.003 to 0.070)   | 0.020 (0.015 to 0.045) | 0.020 (0.008 to 0.032)  | 0.020 (0.010 to 0.020) |
| at 3,000                           | 0.012 (0.000 to 0.045)   | 0.006 (0.000 to 0.035) | 0.004 (0.004 to 0.006)  | 0.006 (0.001 to 0.017) |
| at 5,000                           | 0.000 (0.000 to 0.006)   | 0.000 (0.000 to 0.011) | 0.000 (0.000 to 0.000)  | 0.000 (0.000 to 0.000) |
| at 15,000                          | 0.000 (0.000 to 0.000)   | 0.000 (0.000 to 0.000) | 0.000 (0.000 to 0.003)  | 0.000 (0.000 to 0.000) |
| First measured step below 10 %     | 1,500 (1,500 to 2,000)   | 1,500 (1,500 to 2,000) | 2,000 (1,500 to 2,000)  | 1,500 (1,500 to 2,000) |
| First measured step below 2 %      | 2,500 (2,000 to 4,000)   | 2,250 (2,000 to 4,000) | 2,500 (2,000 to 2,500)  | 2,000 (2,000 to 2,000) |
| Foods joined from step 1,000 on    | 10 of 10                 | 10 of 10               | 3 of 3                  | 3 of 3                 |
| Tube over shortest route at 15,000 | 1.10 (1.09 to 1.14)      | 1.10 (1.09 to 1.13)    | 1.11 (1.10 to 1.13)     | 1.11 (1.09 to 1.13)    |
| Agents alive at 15,000             | 4,187 (3,991 to 4,480)   | 4,114 (3,967 to 4,426) | 4,137 (4,074 to 4,154)  | 4,158 (4,025 to 4,225) |

The Maze has two dabs of 106 cells each. Its runs differ from step 500 on (17,018 agents alive at step 500 against
16,923 on WebGPU, median), and every row lies within the spread of the seeds of before; 9 of 10 seeds join the foods
at step 500, as before. The dead ends empty a little sooner in the median (below 2 % at step 2,250 against 2,500 on
WebGPU, 2,000 against 2,500 on WebGL2), within the range of the seeds.

**The Tokyo scene** (flux 1.4; measured as in "The Tokyo rail network", on the 33 food sources of Fig. 2), 10 seeds
on WebGPU, median and range over the seeds:

| Step   | All 36 joined, before | now      | TL before           | TL now              | MD now              | FT now              |
| ------ | --------------------- | -------- | ------------------- | ------------------- | ------------------- | ------------------- |
| 1,000  | 0 of 10               | 2 of 10  | 2.12 (1.72 to 2.32) | 2.12 (1.88 to 2.54) | 0.84 (0.82 to 1.00) | 0.94 (0.87 to 0.98) |
| 2,000  | 10 of 10              | 9 of 10  | 2.73 (2.56 to 2.85) | 2.75 (2.59 to 2.96) | 0.82 (0.81 to 0.83) | 0.98 (0.97 to 0.99) |
| 4,000  | 10 of 10              | 10 of 10 | 2.46 (2.15 to 2.59) | 2.38 (2.16 to 2.54) | 0.83 (0.81 to 0.92) | 0.96 (0.92 to 0.97) |
| 8,000  | 10 of 10              | 9 of 10  | 2.05 (1.87 to 2.28) | 2.09 (1.90 to 2.18) | 0.82 (0.81 to 0.84) | 0.94 (0.89 to 0.97) |
| 12,000 | 9 of 10               | 10 of 10 | 1.90 (1.58 to 2.05) | 1.83 (1.69 to 2.01) | 0.82 (0.81 to 0.84) | 0.91 (0.84 to 0.94) |
| 16,000 | 9 of 10               | 10 of 10 | 1.88 (1.67 to 2.02) | 1.85 (1.60 to 2.10) | 0.82 (0.81 to 0.84) | 0.92 (0.87 to 0.95) |
| 24,000 | 9 of 10               | 10 of 10 | 1.77 (1.63 to 1.99) | 1.79 (1.62 to 1.94) | 0.82 (0.81 to 0.84) | 0.93 (0.88 to 0.94) |
| 32,000 | 10 of 10              | 9 of 10  | 1.81 (1.45 to 2.00) | 1.87 (1.54 to 1.98) | 0.82 (0.81 to 0.91) | 0.89 (0.80 to 0.93) |
| 40,000 | 8 of 10               | 10 of 10 | 1.84 (1.53 to 1.91) | 1.77 (1.64 to 2.07) | 0.83 (0.81 to 0.85) | 0.91 (0.81 to 0.94) |
| 48,000 | 8 of 10               | 10 of 10 | 1.77 (1.51 to 1.98) | 1.94 (1.64 to 2.03) | 0.82 (0.80 to 0.94) | 0.93 (0.83 to 0.95) |

At step 48,000, mean and standard deviation: TL 1.89 ± 0.13, MD 0.84 ± 0.05 and FT 0.91 ± 0.04, where it was TL 1.77 ±
0.15, MD 0.84 ± 0.03 and FT 0.90 ± 0.05. At step 24,000: TL 1.81 ± 0.10, MD 0.82 ± 0.01 and FT 0.92 ± 0.02 (1.80 ± 0.11,
0.83 ± 0.01 and 0.91 ± 0.04). TL at step 48,000 is 0.12 higher; over all 50 samples from step 16,000 to 48,000 the mean
TL is 1.84 ± 0.13 against 1.80 ± 0.13 before, MD 0.83 and FT 0.91 on both sides (`summary.ts engine-tokyo-end`, which
now prints this line). So the step 48,000 alone moved more than the network as a whole; the ADR saw two sets of ten
seeds differ by up to 0.07 in the mean TL at that step. Against the organism (TL 1.75 ± 0.30, MD 0.85 ± 0.04, FT 0.80 ±
0.13 without light or 0.86 ± 0.04 with light on the mountains), TL is 0.5 standard deviations above the mean, MD 0.3
below, and FT 0.8 above without light and 1.3 with light (before: 0.1, 0.3, 0.8 and 1.0). The check of the specification
(TL from 1.45 to 2.05 and MD from 0.77 to 0.93 in 7 of 10 seeds, FT at least 0.66) holds: 10 of 10 at step 24,000, 9 of
10 at step 48,000 (one seed with MD 0.94), and FT in 10 of 10. All 36 food sources are joined in 78 of the 80 samples
from step 4,000 on (73 before), all 33 in 80 of 80 (79), and no gap lasts two samples. The flux 1.4 was chosen for its
TL with the sites of before (decision 12); decision 18 measures the fluxes 1, 1.4 and 2 again.

On WebGL2, now with 3 seeds (1 to 3) where the record had 2, at step 24,000: TL 1.93, 2.04 and 1.77, MD 0.83, 0.83 and
0.91, FT 0.94, 0.93 and 0.92; all 33 joined in every sample, all 36 in 16 of the 18 samples from step 2,000 on. The
record had TL 1.72 and 1.91, MD 0.82 and 0.83, FT 0.90 and 0.92. The TL of 2.04 lies above the ten WebGPU seeds at step
24,000 (1.62 to 1.94) and within their samples from step 16,000 on (1.54 to 2.10).

**With the flow off** every scene keeps its bytes: the default settings and the 20 scenes, 500 steps from seed 12345,
WebGPU and WebGL2, flow switched off in each; the SHA-256 digests of the agents, the trail, the scent and the
environment equal those of `main` at `5195079` in 42 of 42 runs (`logs/engine/digest-sites-flow-off.jsonl` against
`digest-main-flow-off.jsonl`, made on the same machine that evening). With the flow as each scene has it, the four
scenes with the flow on change on both backends at step 500: Tokyo, Food ring, Rival networks and Tokyo, two
networks. The Maze with seed 12345 is still equal at step 500; the runs of its campaign above differ from step 500 on.
The digests of the build with the passes in blocks equal those of the first build, whose pass looked at the cells one
after the other, in 42 of 42 runs.

**The scenes of ADR 0032** (seed 1, WebGPU, `research/flow/engine/strains.gpu.test.ts`, the commands of part 9 of the
guide): Food ring keeps all 9 sites from step 2,001 on, with 3,003 agents at step 12,001 (3,162 before). In Rival
networks each strain holds all ten sites from step 4,002 on, as before, with 3,749 and 2,994 agents at step 12,002
(2,993 and 2,730). On the Tokyo map with two networks each strain holds 40 to 42 of the 42 sites in every sample from
step 2,002 on, and both hold all 42 at step 14,002 (38 to 42, and 38 and 41, before): a strain covers a food from any
of its cells now.

### Consequences

- A dragged line of food is one site with the flux I0, as a dab is; the fault of the amendment before is closed. A
  long line no longer pulls more flux than a dab, and its segments no longer fill the 64 places of the sites.
- A strain covers a food from any of its cells, so two strains on one food each cover it where their own tube is
  (ADR 0031): the open point of `TODO.md` and of `docs/model.md`, section 14, is closed.
- A link keeps its sites: the rule needs nothing in the link that the list does not hold.
- The memory fit counts 4 B per cell more while the flow is on, once for all strains. On a device near its budget a
  scene with the flow can get a smaller grid than before.
- Not measured again, and so from the sites of before: the Tokyo scene with the fluxes 1 and 2 ("Three flow strengths",
  decision 12), the Maze with the fluxes 2, 4 and 16, the table of decision 6 (the local flux against the exact one),
  the Foraging maze with the flow, and the Tokyo scene without the flow (which keeps its bytes). Decision 18 runs the
  Tokyo scene with the fluxes 1, 1.4 and 2 again in any case.

## Amendment 2026-11-15: the radius of the solver, measured

Decision 18 as measured. The plan is the coordinator's, under the owner's delegation of 2026-11-12. The points marked
"own choice" came up while it was measured; they are the builder's choices, each with its reason. The code is `main` at
`3f579ff` (decision 17). The runs are on an M3 Pro, Chromium with Metal, on WebGPU unless a line names WebGL2. The
commands are part 12 of `research/flow/README.md`, and the logs are `research/flow/logs/engine/radius/`.

### The result

The app keeps the radius 0.99999 (ω = 1.9911). Every larger radius lowers the error of the local solver on a network
that holds still, and raises it while the colony grows. With 0.999993, the growth of the Tokyo scene gives about 190 to
560 tube cells a flow memory above 0.5, where dead agents come to life (decision 8), in 4 of 5 seeds; with 0.99999 at
most 10. From 0.999995 on, this is 3 to 34 % of the tube cells in every seed. With the candidate 0.999999 it is 40 to 51
% at step 500, the pressure reaches 1.1 · 10⁵ in one seed (19 times the pressure limit of a site), and a GPU test and a
unit test of decision 6 fail. So no radius above 0.99999 both keeps the pressure as bounded as 0.99999 does and lowers
the error, and the radius stays; 0.999993 is the case at the border, and the own choices below say why it does not
pass. The Maze with 0.999999 empties its dead ends no sooner than with 0.99999: there
the faster solver does not reach what the agents build. The Tokyo scene keeps its flux of 1.4: with the sites of
decision 17 the flux 1 is a little nearer to the organism, but not by more than two sets of ten seeds differ.

Why the two sides differ. The momentum makes every pattern of the error fall by the factor √(ω − 1) per iteration,
unless the pattern is smoother than the radius ("Solver 2" above): by a factor e in 224 iterations (14 steps) with
0.99999, and in 707 iterations (44 steps) with 0.999999. A larger radius lets the smoothest patterns fall faster, the
ones that carry the flux between far foods, and every other pattern more slowly. On a fixed network only the smooth
patterns are left after some steps, so the larger radius wins. While the colony grows, cells join the network in every
step with a pressure that does not fit, and cells at its margin switch the momentum on and off; each change brings new
rough patterns, and with the larger radius they live three times as long and add up. Not measured: how much of this
comes from the cells that join and how much from the cells that switch.

### 1. Fixed networks

The Maze network of "The pressure on a fixed network" (seed 1, step 1,000 of the prototype, flux 8), with the rule of
the app, from a pressure of 0 (`solvers.ts` with `radii=`). The rows of 0.99999 and 0.999999 are those of the table
there.

| Radius                   | ω       | Error at step 260 | At step 500 | At step 1,000 | First step below 5 % |
| ------------------------ | ------- | ----------------- | ----------- | ------------- | -------------------- |
| 0.9999                   | 1.97211 | 67.6 %            | 55.6 %      | 37.2 %        | after 1,000          |
| 0.99999 (the app)        | 1.99110 | 43.7 %            | 23.9 %      | 6.7 %         | after 1,000          |
| 0.999993                 | 1.99254 | 38.7 %            | 18.8 %      | 4.1 %         | 937                  |
| 0.999995                 | 1.99370 | 33.7 %            | 14.3 %      | 2.4 %         | 794                  |
| 0.999997                 | 1.99511 | 26.0 %            | 8.5 %       | 0.8 %         | 616                  |
| 0.999998                 | 1.99601 | 19.9 %            | 5.0 %       | 0.3 %         | 502                  |
| 0.999999 (the candidate) | 1.99718 | 10.4 %            | 1.4 %       | 0.0 %         | 348                  |

A network of the Tokyo scene: the dump of seed 1 at step 8,000 (flux 1.4, radius 0.99999), with its 42 covered sites and
their roles. `research/flow/engine/radius.ts` runs the iteration of the app on that fixed network with the omega of each
radius, and compares each field with an exact solution. It checks first that its loop gives the bits of `flowPressure()`
of the CPU copy. "Cold": from a pressure of 0, with the roles of the dump. "Draw": from the exact pressure of the roles
of the dump, the roles of 300 steps later in every field: a new draw on a warm network. Before the draw, the flux of the
old roles is 57 to 80 % off that of the new ones. The table gives the steps at which the error of the four fields is
first below 5 % and below 1 %, looked at every 50 steps.

- Own choice: a new script, and not `solvers.ts` with a dump. `solvers.ts` builds its network with the prototype's
  agents on the Maze, and it has one field and two sites; a dump has four fields, 42 sites and the roles of a draw.

| Radius   | Cold: below 5 % | Cold: below 1 % | Draw: below 5 % | Draw: below 1 %  | Largest pressure on a tube, draw |
| -------- | --------------- | --------------- | --------------- | ---------------- | -------------------------------- |
| 0.99999  | 250 to 350      | 400 to 600      | 250 to 450      | 400 to above 600 | 1,088                            |
| 0.999993 | 200 to 300      | 350 to 500      | 200 to 400      | 350 to 550       | 1,098                            |
| 0.999995 | 150 to 250      | 300 to 400      | 150 to 300      | 300 to 500       | 1,103                            |
| 0.999999 | 150             | 200             | 100 to 150      | 200 to 250       | 1,127                            |

So on the fixed Tokyo network the candidate takes about half the steps after a draw, and on the Maze network it reaches
5 % in a third of the iterations. The roles of a field hold 300 steps (`FLOW_HOLD`): with 0.99999 a field is below 5 %
only in the last part of its hold.

### 2. The bounded pressure (decision 6)

The three tests of decision 6 that hold the pressure, with each radius. "Grow": the scene of `bounded.ts scene=grow` as
built, the largest pressure on a tube at the steps of its table from step 150 on. "Mesh": the growing mesh of the unit
test "stays bounded while a mesh of tubes grows over the foods and flickers" (`flow.test.ts`), to step 600: the largest
pressure on the grid in the first 200 and in all 600 steps (`bounded.ts scene=mesh`, a new scene with the numbers of the
test). Its disc of tubes fills the grid at about step 100; from then on only the flicker changes the network. "GPU": the
test "stops a food at its pressure limit when no tube joins it to the other food, so both tubes starve" of
`flow.gpu.test.ts` on WebGPU, which asks for a flow memory below 0.06 on the two pieces of tube at step 600.

| Radius   | Grow | Mesh, 200 steps | Mesh, 600 steps | GPU test                       |
| -------- | ---- | --------------- | --------------- | ------------------------------ |
| 0.99999  | 43   | 435             | 435             | passes                         |
| 0.999993 | 42   | 462             | 462             | passes                         |
| 0.999995 | 48   | 555             | 555             | passes                         |
| 0.999997 | 71   | 728             | 728             | fails: a flow memory of 0.0625 |
| 0.999998 | 92   | 1,987           | 2,702           | fails: 0.0639                  |
| 0.999999 | 131  | 4,706           | 4,706           | fails: 0.0872                  |

The pressure limit of a site is 4,096 in the scenes grow and mesh (flux 1). With 0.999999 the mesh passes it between
steps 151 and 200, after its disc has filled the grid, and its pressure is below 500 again only after step 300. In the
GPU test the two pieces of tube starve later with 0.999997 and above. Probable cause, not measured: the pressure swings
longer before it rests at the limit, and while it swings a flux passes the pieces of tube. The other 34 tests of the
flow on WebGPU pass with every radius. On WebGL2 the 36 tests of the flow give the same: 0.999993 and 0.999995 pass all
of them, and 0.999997 and 0.999999 fail the same test with the same flow memory, 0.0625 and 0.0872.

### 3. The local flux against the exact one while the colony grows

The Tokyo scene, flux 1.4, seeds 1 to 5: dumps at steps 250, 500, 1,000 and 2,000 with each radius, and `exact-flux.ts`
on all four fields (`summary.ts exact-flux`, a new table). "Error per cell" is the median error per cell over the cells
whose exact flux is above 5 % of I0, as in decision 6. "Share above 0.5" is the share of the tube cells whose flow
memory is above 0.5. Each entry is the median over the five seeds of the median over the four fields (the largest
pressure: of the largest over the fields), and in brackets the least and the most over the seeds.

| Radius   | Step 250: largest pressure | Share above 0.5       | Error per cell              | Step 500: share above 0.5 | Error per cell             | Step 2,000: error per cell |
| -------- | -------------------------- | --------------------- | --------------------------- | ------------------------- | -------------------------- | -------------------------- |
| 0.99999  | 267 (172 to 588)           | 0.0 % (0 to 0.1)      | 193 % (23 to 860)           | 0.0 % (0 to 0.1)          | 24 % (15 to 61)            | 19 % (16 to 30)            |
| 0.999993 | 282 (182 to 717)           | 1.4 % (0 to 5.8)      | 224 % (91 to 1,331)         | 0.3 % (0 to 6.8)          | 45 % (7 to 76)             | 15 % (12 to 24)            |
| 0.999995 | 569 (259 to 1,721)         | 8.6 % (3.2 to 11.1)   | 390 % (318 to 2,446)        | 7.1 % (3.3 to 15.6)       | 41 % (25 to 199)           | 11 % (8 to 20)             |
| 0.999997 | 1,952 (838 to 3,130)       | 13.7 % (7.6 to 19.5)  | 2,061 % (1,537 to 13,692)   | 16.5 % (10.7 to 33.9)     | 355 % (23 to 804)          | 9 % (3 to 11)              |
| 0.999999 | 10,506 (1,834 to 69,989)   | 21.3 % (12.1 to 30.9) | 45,792 % (14,976 to 57,681) | 46.7 % (39.5 to 50.6)     | 7,521 % (6,511 to 246,460) | 4 % (4 to 6)               |

The tube cells with a flow memory above 0.5, in field 0 of seeds 1 to 5: with 0.99999 0, 0, 0, 1 and 6 at step 250, and
10, 0, 0, 0 and 0 at step 500; with 0.999993 14, 0, 39, 203 and 189, and 407, 0, 564, 23 and 29. A network that has
settled holds 0.2 to 1.1 % of its tube cells above 0.5 with every radius (steps 4,000 to 12,000 of seed 1): its strong
tubes. With 0.999999, seed 4 has a pressure of 1.1 · 10⁵ on a tube at step 500, and at step 1,000 the flux of the local
solver is up to 1,800 times the exact flux in sum. With 0.99999 the sum is 7.8 (2.0 to 32) times the exact one at step
250 and 3.0 (1.2 to 4.5) times at step 500: the error of the growth that decision 6 describes. After the growth every
radius settles, and at step 2,000 the error per cell falls with the radius, from 19 % to 4 %.

What the colony does with it, the agents alive at step 1,000 (seeds 1 to 5, median and range): 6,870 (5,272 to 7,431)
with 0.99999, 6,355 (5,256 to 7,044) with 0.999993, 6,178 (5,864 to 6,650) with 0.999995, 6,344 (5,321 to 6,918) with
0.999997, and 9,072 (7,893 to 10,189) with 0.999999. So with 0.999999 a third more agents live: dead agents came to life
on the cells with a high flow memory, the sheet of decision 6 in part. With 0.999993 and 0.999995 the cells above 0.5 of
steps 250 and 500 have gone by step 1,000 (0.0 to 0.2 % of the tube cells), with 0.999997 most of them (0.2 to 4.5 %),
and none of the three leaves more agents than 0.99999 does.

The flux 2 (seed 1) gives the same order: the share above 0.5 at step 500 is 1.8 % with 0.99999, 5.5 % with 0.999993,
8.3 % with 0.999995, 21.9 % with 0.999997, 25.9 % with 0.999998 and 42.4 % with 0.999999, and the largest pressure on a
tube is 473, 425, 1,033, 752, 1,313 and 8,918.

### 4. The table of decision 6, again

The table of decision 6 came from the sites of before decision 17 (commit `92a63e7`). Here it is again with the sites of
decision 17 and both radii: the Tokyo scene, seed 1, all four fields. The steps since the last draw of the fields 0 to 3
are 200, 275, 50 and 125 at steps 500, 2,000 and 8,000, and 100, 175, 250 and 25 at step 4,000. Each radius is a run of
its own, so the networks differ too.

| Flux | Step  | 0.99999: sum, fields 0 and 1 | Error per cell, fields 0 to 3 | 0.999999: sum, fields 0 and 1 | Error per cell, fields 0 to 3      |
| ---- | ----- | ---------------------------- | ----------------------------- | ----------------------------- | ---------------------------------- |
| 1.4  | 500   | 221 % and 245 %              | 30, 17, 26 and 15 %           | 24,662 % and 15,950 %         | 9,991, 5,720, 3,520 and 7,301 %    |
| 1.4  | 2,000 | 97 % and 96 %                | 8, 10, 54 and 21 %            | 100 % and 101 %               | 3, 3, 24 and 6 %                   |
| 1.4  | 4,000 | 95 % and 90 %                | 31, 19, 15 and 56 %           | 103 % and 102 %               | 8, 3, 2 and 46 %                   |
| 1.4  | 8,000 | 100 % and 97 %               | 5, 5, 52 and 30 %             | 102 % and 99 %                | 2, 2, 44 and 6 %                   |
| 2    | 500   | 203 % and 289 %              | 20, 32, 39 and 26 %           | 58,040 % and 24,198 %         | 27,048, 10,242, 5,418 and 22,726 % |
| 2    | 2,000 | 100 % and 97 %               | 5, 7, 53 and 16 %             | 98 % and 99 %                 | 3, 2, 14 and 3 %                   |
| 2    | 4,000 | 95 % and 97 %                | 21, 10, 6 and 54 %            | 106 % and 100 %               | 9, 2, 2 and 46 %                   |
| 2    | 8,000 | 101 % and 100 %              | 4, 2, 51 and 26 %             | 101 % and 101 %               | 2, 1, 27 and 7 %                   |

With the radius of the app and the sites of decision 17, the fields 200 and 275 steps after their draw are 2 to 5 % off
at step 8,000 (3 to 7 % in the record) and 5 to 10 % at step 2,000. The fields 100 and 175 steps after their draw are 10
to 31 % off (9 to 25 % in the record). The record had the fields 0 and 1 only; the fields 2 and 3 add what it did not
show: a field 25 to 50 steps after its draw is 51 to 56 % off, and 125 steps after it 16 to 30 %. With 0.999999 a field
is 1 to 9 % off from 100 steps after its draw on, and 14 to 46 % in the first 50 steps.

### 5. The campaigns

**The Maze** (its flux of 8, 10 seeds; "dead ends over route" as in "The Maze (flux 8)"). The ten runs with 0.99999 give
the lines of the record of the amendment 2026-11-14 (2) (`logs/engine/maze-webgpu-flux8-sites.txt`) bit for bit, but for
the time.

| Step                               | 0.99999                  | 0.999999                  |
| ---------------------------------- | ------------------------ | ------------------------- |
| Dead ends over route at 1,000      | 0.53 (0.48 to 0.59)      | 0.57 (0.52 to 0.65)       |
| at 1,500                           | 0.083 (0.052 to 0.138)   | 0.104 (0.080 to 0.134)    |
| at 2,000                           | 0.020 (0.015 to 0.045)   | 0.029 (0.019 to 0.054)    |
| at 3,000                           | 0.006 (0.000 to 0.035)   | 0.009 (0.000 to 0.038)    |
| at 5,000                           | 0.000 (0.000 to 0.011)   | 0.000 (0.000 to 0.001)    |
| First measured step below 10 %     | 1,500 (1,500 to 2,000)   | 2,000 (1,500 to 2,000)    |
| First measured step below 2 %      | 2,250 (2,000 to 4,000)   | 2,500 (2,000 to 4,000)    |
| Agents alive at 1,000              | 10,039 (9,840 to 10,400) | 11,647 (10,959 to 12,172) |
| Tube over shortest route at 15,000 | 1.10 (1.09 to 1.13)      | 1.11 (1.08 to 1.14)       |
| Agents alive at 15,000             | 4,114 (3,967 to 4,426)   | 4,122 (3,964 to 4,424)    |

The Maze has no growth, but its first sheet of agents thins to a network in its first 2,000 steps. With 0.999999 more
agents live in that time (16 % more at step 1,000), and the dead ends empty a little later; from step 5,000 on the two
radii give the same network. So the faster solver of a fixed network does not bring the result of the Maze sooner.

**The Tokyo scene** (10 seeds; measured as in "The Tokyo rail network", on the 33 food sources of Fig. 2, with the sites
of decision 17). The radius of the app with the fluxes 1, 1.4 and 2, where 1.4 is the record of the amendment 2026-11-14
(2), and the candidate with the flux 1.4 of the scene. Mean and standard deviation at step 48,000 and over the 50
samples from step 16,000 on; "all 36 joined" over the 80 samples from step 4,000 on, and the longest run of samples
without all 36 in one seed.

| Flux and radius | TL at 48,000 | MD          | FT                         | TL from 16,000 | MD   | FT   | All 36 joined | Longest gap |
| --------------- | ------------ | ----------- | -------------------------- | -------------- | ---- | ---- | ------------- | ----------- |
| 1, 0.99999      | 1.69 ± 0.08  | 0.82 ± 0.01 | 0.87 ± 0.05                | 1.71 ± 0.13    | 0.84 | 0.87 | 71 of 80      | 4 samples   |
| 1.4, 0.99999    | 1.89 ± 0.13  | 0.84 ± 0.05 | 0.91 ± 0.04                | 1.84 ± 0.13    | 0.83 | 0.91 | 78 of 80      | 1 sample    |
| 2, 0.99999      | 1.98 ± 0.09  | 0.81 ± 0.00 | 0.93 ± 0.03                | 1.95 ± 0.12    | 0.81 | 0.93 | 73 of 80      | 1 sample    |
| 1.4, 0.999999   | 1.90 ± 0.14  | 0.82 ± 0.02 | 0.92 ± 0.03                | 1.90 ± 0.14    | 0.82 | 0.92 | 75 of 80      | 1 sample    |
| The organism    | 1.75 ± 0.30  | 0.85 ± 0.04 | 0.80 ± 0.13 or 0.86 ± 0.04 |                |      |      | all           |             |

The check of the specification (TL from 1.45 to 2.05 and MD from 0.77 to 0.93 in 7 of 10 seeds, FT at least 0.66) at
step 48,000: 10 of 10 with the flux 1, 9 of 10 with 1.4, 8 of 10 with 2, 8 of 10 with 1.4 and 0.999999; FT holds in
every seed of every run. With the sites of decision 17, more flux still gives a longer network with more loops, as with
the sites of before (decision 12: TL 1.71, 1.77 and 1.88 at step 48,000): now 1.69, 1.89 and 1.98. With 0.999999 the
colony has 29 % more agents at step 1,000 (8,519 against 6,608, median), and its network stays longer while it thins: TL
2.24 against 2.09 at step 8,000 and 2.05 against 1.83 at step 12,000 (medians). From step 24,000 on the two radii lie
within the spread of the seeds of each other: at step 48,000 TL 1.90 against 1.89 (means). So the candidate leaves the
end of the experiment as it is; what the measures show of it is the larger colony of the growth and the longer mesh
while it thins.

**The flux of the Tokyo scene** stays 1.4. Every measure of 1 and of 1.4 lies within one standard deviation of the
organism's, at step 48,000 and from step 16,000 on. The flux 1 is nearer to the organism's TL (1.69 and 1.71 against
1.89 and 1.84; the organism 1.75) and FT (0.87 against 0.91; the organism 0.80, or 0.86 with light), a little nearer in
MD from step 16,000 on (0.84 against 0.83; the organism 0.85), but farther at step 48,000 (0.82 against 0.84). It leaves a
food source without a tube above the level of the measure in 9 of 80 samples, once in 4 samples in a row, where 1.4 does
in 2, never in 2 in a row. The flux 2 is farther in all three measures.

- Own choice: a flux fits clearly better if it is nearer to the organism's TL than 1.4 by more than 0.07, the most that
  two sets of ten seeds differed by in the mean TL (decision 12), both at step 48,000 and from step 16,000 on, and if it
  is not farther in MD and FT. The flux 1 is nearer in TL by 0.08 at step 48,000 (0.06 against 0.14 from 1.75) and by
  0.05 from step 16,000 on (0.04 against 0.09), and farther in MD at step 48,000. So it does not fit clearly better, and
  the scene keeps its flux. The organism's spread of TL, 0.30, is four to six times these differences.

### Decision 18, as measured

The app keeps r = 0.99999. Reason: the measurements above. 0.999999 does not keep the pressure bounded: while the Tokyo
colony grows, its pressure and its flux run far off, about half of the tube cells get a flow memory above 0.5 (the sheet
of decision 6, in part), and a GPU test and a unit test of decision 6 fail. The radii between trade in the same way, and
the share of the tube cells above 0.5 while the colony grows rises from the first radius of the scan on.

- Own choice: radii between 0.99999 and 0.999999. Decision 18 named 0.999999 only; the brief allowed a value between, if
  measured. The scan has 0.999993, 0.999995, 0.999997 and 0.999998.
- Own choice: what "keeps the pressure bounded" means here. The growth of the Tokyo scene as with the radius of the app:
  the largest pressure on a tube, the sum of the local flux over the exact flux, and the share of the tube cells with a
  flow memory above 0.5, each within the range of the five seeds of 0.99999 at steps 250 and 500; and the three tests of
  section 2. Reason: decision 6 names as the fault a pressure that grows while the colony grows, with its sign in the
  model: the flow memory near 1 on the whole colony, and dead agents that come to life everywhere.
- 0.999993 is the case at the border, and it does not pass. It passes the three tests, and the medians of its largest
  pressure and of its sum are near those of 0.99999 (282 against 267, 9.8 against 7.8 times the exact flux at step 250),
  with one seed above the range of 0.99999 in each. But it gives about 190 to 560 tube cells a flow memory above 0.5 in
  4 of 5 seeds (up to 6.8 % of them), where 0.99999 gives at most 10 in the ten samples of steps 250 and 500 (field 0),
  and its error per cell while the colony grows is higher (45 % against 24 % at step 500). Its gain after the growth, 15
  % against 19 % at step 2,000, lies within the spread of the seeds (12 to 24 % against 16 to 30 %), and it leaves as
  many agents alive. So "lowers the error" holds for it on the fixed networks of section 1, and not beyond the spread of
  the seeds in the app. The Maze shows that even 0.999999 does not change what the agents build there. To take 0.999993
  after all would need its own campaigns of the Maze and of the Tokyo scene, which did not run.
- Own choice: the candidate's campaign on the Tokyo scene only with the scene's flux of 1.4, and the Maze only with its
  flux of 8. The fluxes 1, 1.4 and 2 of decision 18 are those of decision 12, the choice of the flux of the scene, which
  runs with the radius that is taken. 0.999999 fails on the measures of the solver, and its campaign at the flux of the
  scene shows what that does to the network.
- Own choice: the ten Tokyo runs with 0.99999 and the flux 1.4 are those of the record of the amendment 2026-11-14 (2)
  (`logs/engine/tokyo-flux1.4-sites.txt`, made with the code of PR #71 before its merge). `main` gives their lines bit
  for bit: seed 1 to step 48,000, and the ten Maze runs above.
- Own choice: on WebGL2 the GPU tests of the flow with each radius, the wrong rule M4, and the growth of the Tokyo scene
  with 0.99999 and 0.999999 (seed 1, flux 1.4), after the WebGPU runs and with no other run of this work on the GPU. The
  growth gives the picture of WebGPU: with 0.99999 no tube cell above 0.5 at steps 250 to 1,000; with 0.999999 13, 58
  and 74 % of them, and a pressure of up to 17,727 on a tube. No campaign ran on WebGL2: the radius stays, and the
  campaigns of the record on WebGL2 are those of the amendment 2026-11-14 (2).

### The tests and the wrong rules

The unit test of the growing mesh now runs 200 steps in place of 150, and it asks for a pressure below a quarter of the
pressure limit of a site, where it asked for a pressure below the limit. With 0.99999 the pressure is 435 of 1,024. The
text of the test gave 433, and 1.3 · 10⁹ with the momentum on every cell, numbers of 2026-11-13 from before the sites of
decision 17; with them the run gives 435, and 1.9 · 10⁹ by step 150 (`flowPressure()` with `const om = omega;` for a
moment, `bounded.ts scene=mesh`; the record is `logs/engine/radius/bounded.txt`). The text now has these numbers. With
0.999998 and 0.999999 the test fails (1,987 and 4,706). `mutate.ts` has four new wrong rules: the momentum tuned for
0.999999 and for 0.999998 (M1, M2), which the unit test catches, and for 0.999997 with the tests of each backend (M3,
M4), which the GPU test of the pressure limit catches (`logs/engine/radius/mutations.txt`). No test catches 0.999995 or
0.999993: they pass the tests of decision 6, and what rules them out is the growth of the Tokyo scene, which no test
runs.

### Consequences

- The open point of the Consequences, "the radius of the momentum", is closed: the radius stays (`TODO.md`). The words
  of decision 3 and of "The pressure on a fixed network" stay true: 0.999999 is faster on a fixed network.
- The table of decision 6 is now measured with the sites of decision 17 too (section 4).
- The local solver stays about half off in a field for the first 50 steps after its draw, and 10 to 31 % off 100 to 175
  steps after it. A larger radius would cut that, if the growth of a colony did not bring its errors. An option, not
  built and not measured: a cell that joins the network, or whose tube body crosses its limit, takes the momentum only
  some steps later (`TODO.md`).
- The Tokyo scene keeps its flux of 1.4 (section 5). With the sites of decision 17 its TL at step 48,000, 1.89, is 0.5
  standard deviations of the paper above the organism's; with the flux 1 it would be 0.2 below.

## Amendment 2026-11-15 (2): the time until starved ground is fresh again, measured

Decision 19 as measured. The plan is the coordinator's, under the owner's delegation of 2026-11-12. The points marked
"own choice" came up while it was measured; they are the builder's choices, each with its reason. The code is `main` at
`623fb36`, with the radius 0.99999 of decision 18. The runs are on an M3 Pro, Chromium with Metal, on WebGPU unless a
line names WebGL2. The commands are part 13 of `research/flow/README.md`, and the logs are
`research/flow/logs/engine/recover/`.

### The result

The app keeps the factor 1.00023: starved ground is fresh again after 18.4 h of model time, as before. Every shorter
time that was measured brings back the faint strands of decision 7 on the Tokyo map. The ground between the tubes opens
again, Jones' growth rule fills it with a mesh, the flux does not feed the mesh, and it starves and grows again. Over
the samples from step 16,000 on, TL is 1.84 with 18 h, the record of the amendment 2026-11-14 (2); 1.95 with 12 h, 2.29
with 6 h, 2.45 with 3 h and 2.55 with 1 h (the organism: 1.75 ± 0.30). With 6 h and less the network stops thinning by
step 8,000, at a TL of 2.3 to 2.5. The Maze shows the strands with 1 h only, while its dead ends empty: one seed of ten
fills them above 10 % of the route again, and six still hold trail there at step 5,000.

The concern that led to decision 19, a colony that does not grow back into a region that it lost, does not hold on the
Tokyo map with 18 h. Where the network of a region with four cities is taken off at step 24,000, its tubes leave ground
with the memory of fresh ground at once (a larger memory falls to 0.2, decision 7), and the network joins the four
cities again 200 to 400 steps later (7 to 13 min of model time). Where the foods of those cities are taken away for
3,000 steps (100 min), so that their tubes starve, and are then painted again, the network joins them again 300 to 1,000
steps (10 to 33 min) after they come back. What stays closed for hours is the ground between the tubes, where no tube is
needed.

### Faint strands, as a number

- Own choice: the faint strands are measured by the network that the paper measures (Tero et al. 2010, p. 440, "The
  measures of a network"): TL and the links, over the 50 samples from step 16,000 on (steps 16,000, 24,000, 32,000,
  40,000 and 48,000 of ten seeds; `summary.ts engine-tokyo-end`), and in the Maze by the trail in the dead ends over
  that on the route (table (a)). Reason: decision 7 names strands of agents on ground that the flux left, which live for
  ever. Where they come back, the network holds more strands than the flux keeps: it is longer and has more links than
  the network with 18 h, in which, by decision 7, they do not come back. A strand of agents is trail above the level of
  the measure. In the Maze every trail in a dead end is such a strand: no flux runs there.
- Two measures of the flow memory were tried first, and neither separates the times. The share of the tube cells with a
  flow memory below h = 0.01 is 55 % with 18 h and 38 % with 1 h over the samples from step 16,000 on (`faint` of
  `strands.ts`): the margins of every band of a tube hold such cells. And the lines of the thinned network with no tube
  of a memory of at least h within 2 cells (`faintLine`) are 173 of 1,992 line cells with 18 h and 73 of 2,620 with 1 h
  (means over the same samples). A mesh that grows again on fresh ground starts at the memory of fresh ground, 0.2, and
  falls below h only after about 1,000 steps (decision 10), so most of it is not faint by its memory. It is faint in the
  picture of the tubes (ADR 0034), which draws it thinner than the tubes that carry the flux.
- Own choice: a time passes when its mean TL from step 16,000 on is at most 0.07 above that of 18 h, the most that two
  sets of ten seeds of one rule differed by in the mean TL (decision 12), and when no seed of the Maze fills its dead
  ends again: once they are below 10 % of the route, no later sample above 10 %, and from step 5,000 on every sample
  below 2 %. These criteria were set after the first seed of each time, and before the other runs.

### What was measured

- The shares per step 0.00023 (the app), 0.0007, 0.0014 and 0.0042: 18.4, 6.0, 3.0 and 1.0 h from the floor 10⁻⁴ to
  fresh ground. Own choice: round shares, so that the number measured is the number that would ship. `VITE_RECOVER` of
  `dump.gpu.test.ts` sets the share for a run (`strains.gpu.test.ts` has it too); the app keeps its constant.
- The Tokyo scene (its flux of 1.4) and the Maze (its flux of 8), seeds 1 to 10 each, to step 48,000, 26.7 h of model
  time. Own choice: the Maze to step 48,000 too, where its record ends at step 15,000. With 18 h, ground that starved to
  the floor in the first 2,000 steps is fresh again only near step 35,000; a run to step 15,000 cannot show whether its
  dead ends fill again.
- Own choice: 12 h (the share 0.00035, 12.1 h), on the Tokyo scene with ten seeds. Decision 19 allows a time between,
  and 6 h failed by far (seed 1 first: TL 2.31 against 1.76 with 18 h). 12 h failed on the Tokyo scene, so the Maze,
  where 6 h passes, and the regrowth did not run with it.
- The runs with 18 h give the lines of the record of the amendment 2026-11-14 (2) bit for bit at its steps, but for the
  time: the ten Maze runs and the ten Tokyo runs (`logs/engine/maze-webgpu-flux8-sites.txt`, `tokyo-flux1.4-sites.txt`).
  So `main` at `623fb36` gives the record of PR #71, and the rows of 18 h below are that record, with the steps that it
  did not have.

### The Tokyo scene

The flux 1.4 of the scene, seeds 1 to 10 on WebGPU, measured as in "The Tokyo rail network" on the 33 food sources of
Fig. 2. "From 16,000": the mean and the deviation over the 50 samples of steps 16,000, 24,000, 32,000, 40,000 and
48,000. "All 36 joined": of the 80 samples from step 4,000 on. "Closed ground": the cells of the land without a tube
whose flow memory is below h = 0.01, where no agent divides and an agent dies with at least 1 % per step, as the mean
over the same 50 samples (`strands.ts`; the land has 70,868 cells). Check: TL from 1.45 to 2.05 and MD from 0.77 to 0.93
at step 48,000 (the specification of 2026-11-11).

| Time (share per step)     | TL at 48,000 | MD at 48,000 | FT at 48,000               | TL from 16,000 | Links from 16,000 | Agents from 16,000 | All 36 joined | Closed ground | Check   |
| ------------------------- | ------------ | ------------ | -------------------------- | -------------- | ----------------- | ------------------ | ------------- | ------------- | ------- |
| 18.4 h (0.00023, the app) | 1.89 ± 0.13  | 0.84 ± 0.05  | 0.91 ± 0.04                | 1.84 ± 0.13    | 53.9              | 4,010              | 78 of 80      | 22,338        | 9 of 10 |
| 12.1 h (0.00035)          | 1.96 ± 0.13  | 0.83 ± 0.04  | 0.91 ± 0.04                | 1.95 ± 0.15    | 58.0              | 4,259              | 72 of 80      | 18,956        | 8 of 10 |
| 6.0 h (0.0007)            | 2.25 ± 0.14  | 0.82 ± 0.01  | 0.95 ± 0.01                | 2.29 ± 0.13    | 68.2              | 4,775              | 74 of 80      | 10,919        | 0 of 10 |
| 3.0 h (0.0014)            | 2.45 ± 0.11  | 0.82 ± 0.01  | 0.96 ± 0.02                | 2.45 ± 0.15    | 72.3              | 5,275              | 72 of 80      | 4,580         | 0 of 10 |
| 1.0 h (0.0042)            | 2.54 ± 0.13  | 0.84 ± 0.04  | 0.95 ± 0.03                | 2.55 ± 0.12    | 74.7              | 5,664              | 76 of 80      | 1,323         | 0 of 10 |
| The organism              | 1.75 ± 0.30  | 0.85 ± 0.04  | 0.80 ± 0.13 or 0.86 ± 0.04 |                |                   |                    | all           |               |         |

The shorter the time, the less ground stays closed, the more agents live, and the longer the network is, with more
links and a higher fault tolerance: the mesh of the growth rule stays. While the colony grows the times do not differ
(TL 2.70 to 2.76 at step 2,000, medians). With 18 h the network then thins to TL 1.83 at step 12,000 and stays near
1.8 to 1.9; with 12 h it thins more slowly, to 2.02 at step 12,000 and 1.85 at step 24,000, and ends at 1.96; with 6, 3
and 1 h it stops thinning by step 8,000, at 2.29, 2.38 and 2.48, and stays there to step 48,000 (medians). With 6 h
and less no seed passes the check of the specification at step 48,000. The 12 h runs are within one deviation of the
organism's TL too, but their mean TL from step 16,000 on is 0.11 above that of 18 h, more than the 0.07 by which two
sets of ten seeds of one rule differed, and they leave a food source out in 8 of 80 samples, where 18 h leaves 2. So 12
h, 6 h, 3 h and 1 h fail. 18 h is the reference of the criterion: its network thins to TL 1.83 by step 12,000, and
its mean from step 16,000 on, 1.84, is no longer, so within the 26.7 h of the experiment its strands do not come back.

### The Maze

The flux 8 of the scene, seeds 1 to 10 on WebGPU; dead ends over route as in "The Maze (flux 8)", median and range over
the seeds. "Fill again": a sample above 10 % of the route after one below it. "Not empty from 5,000": a sample from
step 5,000 on above 2 %.

| Step                               | 18.4 h (the app)       | 6.0 h                  | 3.0 h                  | 1.0 h                   |
| ---------------------------------- | ---------------------- | ---------------------- | ---------------------- | ----------------------- |
| Dead ends over route at 1,500      | 0.083 (0.052 to 0.138) | 0.093 (0.076 to 0.161) | 0.115 (0.089 to 0.169) | 0.152 (0.115 to 0.198)  |
| at 2,000                           | 0.020 (0.015 to 0.045) | 0.032 (0.014 to 0.052) | 0.041 (0.027 to 0.051) | 0.069 (0.051 to 0.093)  |
| at 3,000                           | 0.006 (0.000 to 0.035) | 0.017 (0.002 to 0.040) | 0.018 (0.003 to 0.042) | 0.057 (0.023 to 0.108)  |
| at 5,000                           | 0.000 (0.000 to 0.011) | 0.000 (0.000 to 0.016) | 0.000 (0.000 to 0.014) | 0.021 (0.001 to 0.049)  |
| First measured step below 2 %      | 2,250 (2,000 to 4,000) | 2,750 (2,000 to 4,000) | 3,500 (2,500 to 5,000) | 6,250 (4,000 to 10,000) |
| Seeds that fill again              | 0 of 10                | 0 of 10                | 0 of 10                | 1 of 10 (at 2,500)      |
| Seeds not empty from 5,000         | 0 of 10                | 0 of 10                | 0 of 10                | 6 of 10                 |
| Tube over shortest route at 48,000 | 1.06 (1.05 to 1.09)    | 1.06 (1.05 to 1.08)    | 1.06 (1.05 to 1.09)    | 1.07 (1.05 to 1.10)     |
| Agents alive at 48,000             | 3,818 (3,702 to 4,048) | 3,817 (3,735 to 3,923) | 3,849 (3,750 to 3,928) | 3,817 (3,674 to 4,004)  |

With a shorter time the dead ends empty later: the ground of the tubes that starved first opens again while the network
still thins, and agents that stray from the route live there longer. With 1 h one seed fills its dead ends above 10 %
again, and six seeds hold more than 2 % at a sample from step 5,000 on, one of them again at step 10,000 after it was
below. From step 15,000
on all four times give the same network: one tube, 1.06 to 1.07 times the shortest route at step 48,000, and the same
number of agents. The Maze has no growth: no agent divides into opened ground, and only agents that stray from the route
reach it. That is why only 1 h fails here. So 6 h and 3 h pass the Maze, and 1 h fails it.

### The regrowth

The Tokyo scene, seeds 1 to 3 with each time but 12 h. The region is a disc with a radius of 43.5 cells (25 km) around
the four cities in the north-west, Maebashi, Takasaki, Kiryu and Ashikaga, all of the 33 of Fig. 2; its centre is the
mean of the four. At step 24,000 (13.3 h) two things are done to it, each in runs of its own:

- **Taken off**: every agent in the disc dies, its trail is 0, and its cells hold no tube (tube body 0); the flow memory
  stays, and the next step treats it as decision 7 says for ground that lost its tube (`VITE_REMOVE`).
- **Starved**: the foods of the four cities are erased, and painted again at step 27,000, 100 min later
  (`VITE_EDITS`). In between their tubes carry no flux and starve.

- Own choice: the network is taken off by the research test and not by the Cut tool. The Cut tool moves the agents of
  its wound to random open points of the grid, and on this map they start colonies in the sea and on the land (the next
  section), so a run with it measures those colonies.
- Own choice: the foods are away for 3,000 steps. That is three times the 998 steps in which a tube without flux
  starves (decision 10), and it is the hard case for the return: ground that starved a short time ago is the most
  closed.

"Joined again": the first measured step at which all 33 food sources are joined, from step 24,001 for the network
taken off, and from step 27,000, when the foods are back, for the starved one; the steps measured are 24,050, 24,100,
24,200, 24,400, 24,700, 25,000 and 26,000, and 27,300, 27,600, 28,000 and 29,000. Median and range of the three seeds.
"In the disc": the cells of the network of the measure in the disc over those at step 24,000.

| Time   | Taken off: joined again   | In the disc at 25,000 | Closed in the disc at 24,000 | Starved: joined again     | In the disc at 27,000 | At 28,000           |
| ------ | ------------------------- | --------------------- | ---------------------------- | ------------------------- | --------------------- | ------------------- |
| 18.4 h | 24,400 (24,200 to 24,400) | 1.10 (0.71 to 1.26)   | 2,119 (2,098 to 2,394)       | 27,600 (27,300 to 28,000) | 0.53 (0.00 to 0.61)   | 1.24 (0.78 to 1.26) |
| 6.0 h  | 24,200 (24,050 to 24,400) | 0.97 (0.65 to 1.12)   | 1,040 (932 to 1,379)         | 27,600 (27,300 to 27,600) | 1.07 (0.68 to 1.07)   | 0.83 (0.83 to 1.10) |
| 3.0 h  | 24,050 (24,050 to 24,200) | 1.01 (0.61 to 1.52)   | 307 (136 to 323)             | 27,300 (27,300 to 27,300) | 1.13 (0.73 to 1.15)   | 1.27 (0.91 to 1.30) |
| 1.0 h  | 24,050 (24,050 to 24,050) | 0.87 (0.82 to 1.11)   | 81 (62 to 147)               | 27,300 (27,300 to 27,300) | 0.99 (0.78 to 1.30)   | 0.92 (0.78 to 1.16) |

With 18 h the network joins the four cities again 200 to 400 steps (7 to 13 min of model time) after it was taken off,
and by step 25,000 the disc holds as much network as before. The tubes of the region carried flux, so their memory was
above that of fresh ground, and it fell to fresh ground at once; the growth rule fills them again from the edge of the
disc. With 1 and 3 h the network is back within 50 to 200 steps. With 18 h the network in the disc is down to half after
the foods were away for 100 min (in one seed to nothing at all); with the shorter times the mesh on the opened ground
keeps it near its size. 300 to 1,000 steps after the foods come back (10 to 33 min), the network joins them again with
every time, and with 18 h it then holds more of the disc than before. So the time of decision 7 slows the return by
minutes, not by hours. What it keeps closed is the ground between the tubes: 2,100 of the 5,807 cells of the disc with
18 h before the event, 80 with 1 h.

### WebGL2

Seeds 1 to 3 on WebGL2, after the WebGPU runs, with no other run of this work on the GPU: the Tokyo scene with 18 h
and with 6 h, the next shorter time of the four of decision 19, and the Maze with 18 h, each to step 48,000.

| WebGL2, 3 seeds | TL at 48,000 | TL from 16,000 | Links from 16,000 | Agents from 16,000 | All 36 joined | Closed ground | Check  |
| --------------- | ------------ | -------------- | ----------------- | ------------------ | ------------- | ------------- | ------ |
| 18.4 h          | 1.71 ± 0.19  | 1.79 ± 0.16    | 51.7              | 3,931              | 22 of 24      | 22,217        | 3 of 3 |
| 6.0 h           | 2.03 ± 0.04  | 2.21 ± 0.14    | 64.6              | 4,669              | 23 of 24      | 11,112        | 2 of 3 |

The picture of WebGPU: with 6 h the network is longer by 0.42 from step 16,000 on (0.45 on WebGPU), with more links,
more agents and half the closed ground. In the Maze with 18 h the dead ends are below 2 % from step 2,000 in all three
seeds and stay there to step 48,000 (at most 0.4 % from step 5,000 on); the tube is 1.07 (1.05 to 1.07) times the
shortest route and 3,838 (3,807 to 3,851) agents live at step 48,000. The runs with 18 h give the lines of the record of
the amendment 2026-11-14 (2) on WebGL2 at its steps (`logs/engine/maze-webgl2-flux8-sites.txt` to step 15,000,
`tokyo-webgl2-flux1.4-sites.txt` to step 24,000), bit for bit but for the time.

### The Cut tool on the Tokyo map

Decision 19 names a cut region. One run (seed 1, 18 h) holds the Cut tool of the app over the same disc from step
24,000 to 24,100, as `Engine.agentTool()` takes it from the pointer (`VITE_CUT`). The tool moves every agent of its
wound to the first of 8 random open points of the whole grid outside the wound (ADR 0023), and on the Tokyo map the
dish around the land is open: the sea beyond the coast walls. With growth the moved agents start colonies wherever they
land. 100 steps later 19,946 agents live where 3,997 lived, and 50,001 cells of the sea hold trail above the level of
the measure, where every run of the scene has none. The colony in the sea shrinks slowly: 18,155 cells at step 27,000,
7,681 at step 30,000, and 6,475 at step 48,000. On the land the network joins the four cities again by step 25,000,
as after the network was taken off. So a test with the Cut tool would measure the colonies that it starts, and the
regrowth above takes the network off by itself. Not changed here: where a cut agent goes is the rule of ADR 0023,
which ADR 0038 also uses for an agent under a painted wall.

### The tests and the wrong rules

No test held the recovery of starved ground. The only test that compares it with the CPU copy step by step starts every
cell at the memory of fresh ground, which the recovery leaves as it is. A new GPU test on both backends, "lets starved
ground recover by the factor of the rule, up to the memory of fresh ground" (`flow.gpu.test.ts`), writes ten memories
from 0 to 1 into ground without a tube and compares them after 1, 100 and 500 steps with the rule computed in float32.
`research/flow/engine/mutate.ts` has six new wrong rules, D1 to D6: starved ground fresh again at once, never fresh
again, and no cap at fresh ground, in WGSL and in GLSL. Without the new test (it skipped, in a copy of the code at
`623fb36` with the changes of this record) four of them pass every test of the flow on their backend: D1, D2, D4 and D5;
D3 and D6 fail 8 tests, those that compare with the CPU copy. With it each of the six fails it, on the code after the
merge of `main` at `71b0161` (`logs/engine/recover/mutations-before.txt` and `mutations.txt`). `mutate.ts check`: 194
of 194 wrong rules fit their files.

### Decision 19, as measured

The factor stays 1.00023, 18.4 h from the floor to fresh ground. Reason: the measurements above. It is the shortest of
the times measured at which the faint strands do not come back; 12 h, the next shorter, makes the network of the Tokyo
scene longer by more than two sets of seeds differ.

- Own choice: no time between 12 and 18 h. What a shorter time could bring, a faster return into a region that the
  colony lost, is not needed: the colony returns within half an hour with 18 h already (the regrowth above).

- Own choice: the decision rests on the Tokyo scene. It has growth, which fills the opened ground with a mesh; the Maze
  has no growth, and its agents leave the route for open ground only while the network thins. So the Maze separates
  only 1 h from the rest.
- Own choice: the regrowth with three seeds for each time, and not ten. It answers whether and when the network grows
  back, and in every run it did, within 1,000 steps of the event; the spread of three seeds does not change that.

### Consequences

- The app, its scenes and their bytes do not change. No file of the app changed but a test file, so the digests of the
  scenes did not run again, and the scenes of ADR 0032 keep their record.
- The open point of `TODO.md` is closed: starved ground stays closed for 18 h, and the colony grows back where a tube
  is needed. What the 18 h keep closed is the ground between the tubes, where the mesh of Jones' growth rule would grow
  again. Row 16 of `docs/fidelity.md` has the numbers of the regrowth.
- Decision 7 now has its measurement. The words "lived for ever" hold for 6 h and less: there the network stops thinning
  by step 8,000.
- Open, not built: the scent of food lifts the mark (decision 19). The organism avoids ground with its own slime and
  enters it when it perceives food (Reid et al. 2012 and 2013; "What is true today" of the amendment 2026-11-14). A rule
  of that kind would open starved ground near a food and keep it closed elsewhere (`TODO.md`, Later).
- Found on the way, not changed: the Cut tool moves the agents of its wound to random open points of the whole grid
  (ADR 0023), and the rule for an agent under a painted wall does the same (ADR 0038). On the Tokyo map these points lie
  also in the sea beyond the coast and on starved land, and with growth they become colonies there ("The Cut tool on the
  Tokyo map" above). Where a cut agent goes is an owner decision (`TODO.md`).
