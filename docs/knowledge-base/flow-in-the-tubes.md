# Flow in the tubes: what the papers say

Notes for ADR 0029, read on 2026-11-12. Each line names the paper and the section, equation or figure
that holds it. "[V]" marks a fact read in the full text. "[H]" marks a fact that a helper read in the
copy of the paper at PubMed Central (abstract, results and captions; not its methods). "[I]" marks an
inference of this project. The papers are copyrighted: this file holds facts and at most a few quoted
words, no figures.

## The organism

- The plasmodium is a network of tubes. Protoplasm streams back and forth in them (shuttle streaming),
  driven by contractions of the tube walls.
- Period of the contractions: "two minutes" (Tero, Kobayashi and Nakagaki 2007, Sec. 2) [V]; 1 to 2 min
  (Marbach et al. 2023, "Quantifying vein dynamics") [V]; 4 to 10 mHz measured, which is 100 to 250 s
  (Kramar and Alim 2021, caption of Fig. 4) [H].
- The flow reaches about 1 mm/s (Tero et al. 2007, Sec. 2) [V].
- Two rules from experiments (Tero et al. 2007, Sec. 2) [V]: a tube with an open end tends to
  disappear. Of two tubes between the same two food sources, the longer one tends to disappear.
- Tubes take apart and form again "within a period of a few hours" (Tero et al. 2007, Sec. 1) [V].
- Time scales of one vein (Marbach et al. 2023) [V]: the flow changes within 1 to 2 min. A vein answers
  to the shear rate with a delay of 1 to 3 min, 2 min on average ("Statistical analysis of the time
  delay"). It adapts within 10 to 100 min. Veins "typically vanish over 15 min to 40 min" ("Model with
  a time delay"). A vein shrinks when its resistance is above that of the rest of the network between
  its ends, and it is stable or grows below that ("Relative resistance and pressure control vein
  fate"). A dangling end vanishes or grows, and is never stable.
- After a food stimulus the tube diameters reorganise "within about 15 min". Tubes near the food
  dilate "up to twofold", and the tube volume falls farther away. The dilation spreads from the food
  at 15 μm/s, the speed of the flow. The pattern lasts to the end of the experiment, 45 min (Kramar
  and Alim 2021, Results) [H].
- In a maze only the shortest path was left after 12 h (Ma et al. 2013, Sec. 1, on the Towers of Hanoi
  maze) [V]; Nakagaki, Yamada and Tóth 2000 is the first maze experiment.

The owner's plan of 2026-11-11 named three facts. All three hold:

| Fact of the plan                                     | Source                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| The plasma shuttles back and forth every 2 minutes   | Tero et al. 2007, Sec. 2; Marbach et al. 2023: 1 to 2 min |
| Tubes with little flow vanish in 15 to 40 minutes    | Marbach et al. 2023, "Model with a time delay"            |
| Food makes the tubes toward it thicker in 15 minutes | Kramar and Alim 2021, Results [H]                         |

M. Kramar, K. Alim: PNAS 118: e2007815118 (2021). M. Marbach, N. Ziethen, L. Bastin, F. K. Bäuerle,
K. Alim: eLife 12: e78100 (2023).

## The model of Tero, Kobayashi and Nakagaki

A. Tero, R. Kobayashi, T. Nakagaki: Physica A 363: 115–119 (2006) and J. Theor. Biol. 244: 553–564
(2007).

- The network is a graph. A tube between the nodes i and j has the length L and the conductivity D.
  The flux follows Poiseuille's law: Q = D (p_i − p_j) / L (2006, Eq. 1; 2007, Eq. 1) [V].
- Kirchhoff's law holds at every node. One food source gives the flux I0 and the other takes it
  (2006, Eq. 2 and 3; 2007, Eq. 2 and 3) [V]. The total flux is fixed.
- The pressures are the solution of a linear system, a Poisson equation on the graph (2006, Eq. 5;
  2007, Eq. 6) [V]. The authors solve it with an incomplete Cholesky conjugate gradient method (2007,
  Sec. 3.3) [V].
- The conductivity adapts to the flux: dD/dt = f(|Q|) − D, with f increasing and f(0) = 0 (2007,
  Eq. 4 and 5) [V]. Type I: f(Q) = Q^μ. Type II: a sigmoid.
- A dead end carries no flux, so its D falls as exp(−t) (2007, Sec. 5.1) [V].
- With μ > 1, one of two competing paths survives; with μ = 1 always the shortest; with μ < 1 both
  (2007, Sec. 4.1 and 5.2) [V].
- The model takes the mean of the shuttle flow over a period as a direct current. With an alternating
  total flux the results were the same. For three or more food sources the authors say that the
  coupled oscillators of the organism belong in the model (2007, Sec. 6) [V].

## The Tokyo experiment

A. Tero, S. Takagi, T. Saigusa, K. Ito, D. P. Bebber, M. D. Fricker, K. Yumiki, R. Kobayashi,
T. Nakagaki: Science 327: 439–442 (2010), with a supplement of two figures.

- 36 food sources stand for the cities around Tokyo. The plasmodium grows out from Tokyo, fills much
  of the land and then thins to tubes between the food sources (p. 439, Fig. 1) [V]. Fig. 1 shows 0,
  5, 8, 11, 16 and 26 h on panels 17 cm wide.
- A second protocol, the plasmodium over all the land first and then all food sources at once, gave
  similar results (p. 439) [V].
- The measures (p. 440) [V]: the total length TL, the mean shortest distance MD between two food
  sources, and the fault tolerance FT, from the chance that a cut link separates a part. Each one is
  divided by the value of the minimum spanning tree (MST).
- The organism (21 runs): TL 1.75 ± 0.30, MD 0.85 ± 0.04. A cut link separates a part in 14 ± 4 % of
  the cases with light on the mountains and in 20 ± 13 % without. The rail network: TL about 1.8, MD
  0.85, 4 %.
- The model (p. 441) [V]: a fine random mesh over the land. At each time step one random food source
  gives I0 and another takes it. dD/dt = f(|Q|) − D with f(Q) = Q^γ / (1 + Q^γ). Typical values:
  I0 = 2 and γ = 1.8 (Fig. 4). In Fig. 4, Tokyo is seven food sources.
- More flux gives more links (supplement, Fig. S1, γ = 1.8): I0 0.2 gives TL 1.05 and FT 0.00; I0 2.2
  gives TL 1.39, FT 0.92 and MD 0.87; I0 3.0 gives TL 1.56, FT 0.97 and MD 0.85 [V].
- The paper and its supplement give no list of cities, no coordinates, no mesh size and no time step
  [V]. The positions in `src/model/tokyo.ts` are fitted to the figures (ADR 0024).

## Current-reinforced random walks

Q. Ma, A. Johansson, A. Tero, T. Nakagaki, D. J. T. Sumpter: J. R. Soc. Interface 10: 20120864
(2013).

- Particles walk on the graph. The number of particles on a node is the potential. The mean flow from
  i to j is (N_i − N_j) D / l, and the flow of a step is a Poisson sample of it (Eq. 2.4 to 2.8) [V].
- The conductivity grows with the flow of the step and decays: D ← D + q |I| − λ D dt (Eq. 2.8) [V].
- The mean field is the model of Tero et al. (Eq. 2.9 and 2.10). The walk is local: Tero's model
  solves Kirchhoff's law over the whole network at each update (Sec. 2.2) [V].
- The "biologically realistic" form divides the particles of a node by the sum of its conductances
  (Eq. 2.16) [V].
- [I] On a grid, the mean field of Eq. 2.16 with a time step of 1 is one weighted Jacobi iteration of
  Tero's Poisson equation per step. So the walk is Tero's model with a slow, local pressure solver
  and with sampling noise (measured in ADR 0029).
- A node has a capacitance C_i (Eq. 2.15), and in the "biologically realistic" model the particles
  of a node count against it (Sec. 2.4, Eq. 2.16). A solution of Kirchhoff's law needs "a global
  solution over all nodes" (Sec. 2.2) [H, read on 2026-11-13 in the copy at PubMed Central, where
  the equations are pictures].

## Solvers for the pressure

R. Bridson, M. Müller-Fischer: Fluid Simulation, SIGGRAPH 2007 Course Notes, chapter 4 ("Making
Fluids Incompressible"). Read on 2026-11-13 for ADR 0029. The pressure of a fluid on a grid is the
same kind of system as Tero's network Poisson equation.

- The matrix is symmetric, with one row per cell and an entry for each neighbour. It is positive
  definite, or positive semi-definite when nothing fixes the level of the pressure; then the
  right-hand side must add up to zero, and the solution is fixed up to a constant (Sec. 4.3.2) [V].
- Conjugate gradients: an iteration is one product of the matrix with a vector and a few sums
  over all cells (Fig. 4.1). Without a preconditioner the number of iterations grows with the
  width of the grid in cells (Sec. 4.3.2) [V].
- Incomplete Cholesky, IC(0): a lower triangle L with the sparsity of the matrix, of which only a
  diagonal is stored (Sec. 4.3.3, Eq. 4.29 to 4.31) [V].
- Modified incomplete Cholesky, MIC(0): the entries that L · Lᵀ adds are put on the diagonal, so
  that the row sums stay (Sec. 4.3.4, Eq. 4.33). The iteration count then grows with the square
  root of the grid width. A weight τ = 0.97 between the two forms works best (Fig. 4.2). To apply
  it, one sweep goes through the cells in order and one goes back (Fig. 4.3) [V].
- The notes recommend this preconditioner for "regular PC's", as opposed to massively parallel
  machines (Sec. 4.3.3) [V].
- [I] In a sweep each cell needs the result of the cells before it. So the preconditioner is no
  single pass on a GPU, where a pass computes all cells at once (ADR 0029, "Solver 1").

## Jones on flux

J. Jones: Parallel Processing Letters 25 (2015), arXiv:1511.05869.

- Jones describes Tero's model and says that it starts from a complete network (Sec. 2) [V].
- In Jones' model the population stands for both the structure and the flux; no flux is computed
  (Sec. 3) [V]. The text has no rule that reinforces a path by a flux.

## What this app takes from the papers

ADR 0029 has the decisions and the measurements. In short:

- The flux, Kirchhoff's law and the adaptation f(Q) = Q^γ / (1 + Q^γ) with γ = 1.8 are those of Tero
  et al. 2007 and 2010, on the cells of the grid in place of a graph.
- The agents and their growth are Jones'. The flux decides where agents starve and where dead agents
  come to life. That link is this app's own.
- Thirty steps stand for one minute. Then the times of the rule lie in the ranges of Marbach et al.
  2023: the tube body follows the trail in 1.7 min, a tube adapts in 11 min, and a tube without flux
  starves after about 33 min.
