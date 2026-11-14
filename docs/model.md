# The model: the rules in force

Status: 2026-11-13, `main` at `f91dbc4` with the rules of ADR 0032. This file states what the simulation computes, as
mathematics, for both models, both orders of a step and both backends. The ADRs hold the reasons and the history; each
section names its ADR. How close the model comes to the organism: [fidelity.md](fidelity.md). The GPU implementation
(buffers, tiles, the sort of the agents): [design.md](design.md). Decision:
[ADR 0030](adr/0030-model-specification-and-fidelity.md).

The code is the truth. If this file and the code differ, one of them has a bug: fix it, and change this file in the
same pull request.

## 1. Notation

- **Grid**: W × H cells. A cell is x = (i, j) with integer i, j. A position is a point p in cells (floats); its cell is
  ⌊p⌋, the floor of each coordinate (`cellOf`, `shaders/common.wgsl`). Jones rounds to the nearest cell (p. 132): the
  same rule with the cell centres at i + ½.
- **Arena Ω**, by the boundary:
  - _wrap_: every cell, with indices taken modulo W and H (a torus);
  - _box_: every cell of the grid; a cell outside the grid is not in Ω;
  - _dish_: the cells whose centre lies within R = 0.945 · min(W, H) / 2 of the centre of the grid (`DISH_FILL`).
- **Walls 𝒲**: cells of Ω whose wall byte is at least 128. **Open cells** O = Ω ∖ 𝒲.
- **Sites S** of the diffusion: S = Ω in the Jones model, S = O in the extended model (section 6.3).
- **N(x)**: the 3 × 3 block around x, wrapped on the torus.
- **Step k**: the k-th call of the step; the counter is 0 after a reset.
- **Strains** s = 0 … 3, with the trail lane of the same number. **u** is a uniform random number in [0, 1).
- Angles are degrees in the panel and radians in the shaders. d(a) = (cos a, sin a) is the unit vector of a heading.

## 2. The two models

The setting Model picks the rule set (ADR 0022). `jonesFits()`, `asJones()` and `constrain()` in
`src/model/params.ts` and `packParams()` in `src/engine/pack.ts` hold the differences.

| Rule                     | Jones                                            | Extended                                               |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Strains                  | 1                                                | 1 to 4, each with a share of the population            |
| Weight of the trails     | own trail +1 (attraction) or −1 (chemorepulsion) | a table A[s][l] from −2 to +2                          |
| Weight of the food scent | the weight of the own trail                      | w_F per strain                                         |
| Light                    | none                                             | lit cells release a repellent; weight w_L per strain   |
| Scent decay              | the strain's decay                               | a setting of its own                                   |
| Source scale g           | 1                                                | keeps the plateau of a food at every scent decay (6.4) |
| Trail saturation K       | off                                              | optional, K ≥ 1                                        |
| Diffusion passes         | 1                                                | 0 to 4                                                 |
| One agent per cell       | on                                               | optional                                               |
| Walls in the diffusion   | part of the lattice: they diffuse and decay      | sinks that hold 0                                      |
| A wall on a sensor's way | not checked                                      | the sensor reads blocked                               |
| The cut tool             | moves agents, keeps trail and scent              | moves agents, clears trail and scent in the wound      |
| Flow in the tubes        | never                                            | optional, a flow for each strain                       |
| Growth and shrinkage     | optional                                         | optional                                               |

One strain, one agent per cell, one diffusion pass and an own weight of ±1 are required: a Jones model without one of
them becomes extended (`jonesFits()`). The other values of the Jones column are bound: `constrain()` resets them
(`asJones()`), and `packParams()` packs Jones' values whatever the settings hold. Walls, light and the cut change no
model. In the Jones model the trail plus the food scent is Jones' one trail map (section 6.4).

## 3. Units and scales

- Lengths are in cells, times in steps. Jones gives his lengths in cells too, so his scenes run on the lattice of their
  figure (ADR 0026).
- Only the flow defines a physical time: 30 steps are one minute, so a step is 2 s (ADR 0029, decision 10). The rules
  outside the flow have no time scale.
- Only the Tokyo scene defines a physical length: 0.537 mm per cell (17 cm on 316 cells, `src/model/tokyo.ts`).
- The trail and the scent are in units of deposit: an agent adds depT per successful move.

## 4. State

**An agent** has a position p (cells, float), a heading θ (radians, in [0, 2π)), a strain s, an alive bit and an id.
The id is its slot at the start and never changes. The model reads the id, never the slot in the buffer, so the sort
of the agents changes no result (ADR 0005). The buffer holds N agents, alive and dead: N = round(capacity · cells),
where cells is W · H, or min(W, H)² in a dish (`src/engine/sizing.ts`).

**The fields** (per cell):

| Symbol  | Field                                                                                  | Range     |
| ------- | -------------------------------------------------------------------------------------- | --------- |
| T_l     | trail of lane l, l = 0 … 3                                                             | ≥ 0       |
| C_F     | food scent                                                                             | ≥ 0       |
| C_L     | light repellent                                                                        | ≥ 0       |
| w, f, λ | wall, food and light bytes of `env`, read as byte / 255                                | [0, 1]    |
| n_l     | agents of strain l whose move ended in the cell in this step                           | integers  |
| occ     | alive agents in the cell after the moves; on a growth step after its deaths and births | integers  |
| D_s     | flow memory of strain s (flow only, section 8)                                         | [1e-4, 1] |
| B_s     | tube body of strain s (flow only, section 8)                                           | [0, 1]    |
| G_s     | conductivity of the flow of strain s (flow only)                                       | [0, 4]    |
| P_s,k   | pressure of the flow of strain s in lane k = 0 … 3 (flow only)                         | float     |

Lanes without a strain have deposit and keep 0, so they hold 0 after one step. The flow has its fields for each strain
of the settings, at most 4 (`flowStrains()` in `src/engine/flow.ts`). Settings with another number of strains get a new
state of the flow at their next step: fresh ground for every strain, also for the strains that stay. The app resets the
run when the number of strains changes (`apply()` in `src/engine/engine.ts`).

## 5. One step

Each scene runs the order of its paper (ADR 0027): the eight scenes of Jones 2010 **move first** (Jones 2010, p. 133);
every other scene and the default settings **sense first** (Jones 2011, p. 1350; Fogleman 2020).

A step runs these passes (`encodeStep` in `src/engine/sim.ts` and `src/engine/gl/sim.ts`):

1. **Agent pass**, one thread per agent (section 7). It reads the fields as the last step left them, and the occupancy
   and the flow memory of the last step, each agent the flow memory of its own strain.
2. **Growth and shrinkage**, only on the steps of their intervals, only with one agent per cell (section 9).
3. **Diffusion**, one or more passes over the grid (section 6). It adds the deposits n_l of this step.
4. **Flow**, only while it is on (section 8). It runs once per strain and reads the trail of that strain after the
   diffusion.

The two orders differ in when the agents sense, and in where the diffusion adds the sources:

- **Move first**: X^k = keep · M^N(X^(k−1)) + Q^k. The fields then hold the map after the diffusion plus the deposits
  of the moves. In step k+1 the agents first sense and turn on this map, then move. So the code's step k is Jones'
  sensory stage of step k − 1 plus his motor stage of step k. In step 0 after a reset no agent senses: it moves with
  its start heading, as in Jones' first step.
- **Sense first**: X^k = keep · M^N(X^(k−1) + Q^k). Every step senses, the first one too.

Here X is a field, Q^k its sources in step k, M the 3 × 3 mean and N the number of passes (section 6.2).

## 6. The fields

ADR 0007, 0022, 0027. Code: `shaders/diffuse.wgsl`, `gl/glsl/diffuse.frag`, `sourceScale()` in `src/engine/pack.ts`.

### 6.1 The 3 × 3 mean

M f(x) = 1_S(x) · (1/9) · Σ_{y ∈ N(x)} 1_S(y) · f(y).

The divisor is 9 at every site. A cell outside S counts 0 and holds 0. So trail that reaches a closed edge, a dish's
rim, or a wall of the extended model is lost (absorbing edges, Jones 2011).

### 6.2 The update of one step

The diffusion runs N passes (the setting Diffusion passes; the Jones model always runs 1). The last pass multiplies by
keep_l = 1 − decay_l for the trail and keep_C = 1 − d_C for the scent. With N = 0 one pass runs without the mean.

The sources of step k, on open cells only:

- deposit: E_l^k(x) = 1_O(x) · depT_l · n_l^k(x);
- food: F^k(x) = 1_O(x) · f(x) · 255 · wProj · g · κ^k(x), with κ for covered food (section 6.5);
- light: L(x) = 1_O(x) · λ(x) · 255 · wLight · g, in the extended model only.

With the cut mask Z^k (0 in a wound of the extended model, 1 elsewhere, section 6.6):

- **Move first**: T_l^k = keep_l · M^N(Z^k · T_l^(k−1)) + Z^k · E_l^k, and C^k = keep_C · M^N(Z^k · C^(k−1)) +
  Z^k · (F^k, L). The sources come after the decay, in the last pass.
- **Sense first**: T_l^k = keep_l · M^N(Z^k · (T_l^(k−1) + E_l^k)), and the scent the same with F^k and L. The sources
  come before the mean, in the first pass.

Moving first, the last pass multiplies the sum by keep/9 in one factor, as Metal folds it, written out on both backends
(ADR 0027, decision 23). Sensing first, it takes the mean and then the decay, as the code before ADR 0027 did
(decision 28). The two orders therefore round apart in float32.

**Mass.** On the torus M keeps the sum, so Σ T^k = keep · Σ T^(k−1) + depT · Σ n^k moving first, and keep · (Σ T^(k−1) +
depT · Σ n^k) sensing first. Closed edges and walls of the extended model take mass away.

**Steady state.** Inside a large food, C* = F / d_C moving first and (1 − d_C) · F / d_C sensing first.

### 6.3 Boundaries and walls

- _wrap_: the mean, the sources and every window wrap.
- _box_ and _dish_: cells outside Ω are sinks (they count 0 and hold 0).
- **Walls, Jones model**: part of the lattice. They take the mean and the decay like any cell, but no deposit, food or
  light. A sensor on a wall cell reads blocked.
- **Walls, extended model**: sinks.
- Food or light painted onto a wall has no effect: the wall byte wins.

### 6.4 Food and light scent

- The source scale g: g = 1 in the Jones model. In the extended model g = d_C / 0.1 moving first and g = (d_C / (1 −
  d_C)) / (0.1 / 0.9) sensing first (`emissionScale()` in `src/model/params.ts`). So a large food reaches the same
  plateau at every scent decay: 255 · wProj · 10 moving first and 255 · wProj · 9 sensing first. At d_C = 0.1, g = 1 in
  both orders.
- Scent decay: d_C is the setting Scent decay in the extended model, and the decay of the strain in the Jones model.
- **Jones' one map.** In the Jones model the trail and the food scent have the same mean, the same sites, the same
  decay and the same pass for their sources, and the agent weighs both with its own weight ±1. The update is linear, so
  T_0 + C_F follows Jones' update of one trail map with the sources depT · n + f · 255 · wProj. Light has weight 0 and
  source 0. A GPU test steps a float64 map of Jones' rule beside the GPU and finds trail plus scent within a relative error of 1e-5 of it
  (`sim.gpu.test.ts`, "keep trail + scent equal to Jones' one trail map").

### 6.5 Covered food

Adamatzky and Jones 2010. While the setting is on, a food cell releases φ times its scent while any cell of its 3 × 3
block holds an agent after the moves (on a growth step: after its deaths and births): κ(x) = φ if f(x) > 0 and occ(y) > 0 for some y ∈ N(x) ∩ Ω, else κ(x) = 1. φ is
the setting Covered food factor (default 0.001). Light is never reduced. The factor applies in the pass that adds the
sources. The rule is off in every scene.

### 6.6 The cut in the fields

The wound is the disc of the brush: cells whose centre lies closer to the tool than its radius (the nearest copy on the
torus). In the extended model every trail lane and both scent fields of the wound are set to 0 before the step's
diffusion, and the wound takes no source, in every step while the tool is held. Neighbours then diffuse back in. In the
Jones model the cut leaves the fields as they are (Jones 2010, p. 148).

### 6.7 Painted food, light and walls

A brush stroke paints the cells of Ω whose centre lies within its radius r of the stroke (r ≥ 0.75 cells; a stroke of the user on
steps of 1/16 cell). Wall: the wall byte 255, food and light 0. Food: the food byte 255. Light: max(old, 255 ·
t² (3 − 2t)) rounded to a byte, with t = clamp((d − r) / (0.3 r − r), 0, 1) at the distance d from the stroke: 255
within 0.3 r, 0 at r. The shaders write this step out, because GLSL ES 3.00 leaves smoothstep undefined with its first
edge above its second (ADR 0007, amendment of 2026-11-13). Erase: all bytes 0 (`shaders/paint.wgsl`,
`gl/glsl/paint.frag`, CPU reference `lightByte()` in `brush.ts`).

### 6.8 Trail saturation K

In the extended model with K ≥ 1, a sensor reads each trail lane as σ_K(t) = t / (1 + t / K) before it weighs it. K
acts on the sensors only: not on the deposit, the diffusion or the scent (ADR 0022, decisions 15 to 17). K is 0 in
every scene.

## 7. The agents

ADR 0007, 0008, 0020, 0022, 0023, 0027. Code: `shaders/agents.wgsl`, `gl/glsl/agents.frag`, `gl/glsl/tools.glsl`.

The agent pass runs these parts in order for each agent.

### 7.1 Death

1. **Random shrinkage**: an agent alive at the start of the step dies if u < p_remove (the setting Random shrinkage;
   Jones 2010, Fig. 21 uses 0.00025).
2. **Starvation** (flow on): a survivor of strain s dies if u < 0.02 · h² / (D_s² + h²), with h = 0.01 and D_s the flow
   memory of its own strain on its cell from the last step (section 8.5).

A dead agent neither moves nor deposits in this step.

### 7.2 Placement by a tool or by the flow

A dead agent, and an agent that the cut reaches, may be placed instead of moving (ADR 0023). A placed agent makes no
move and no deposit in its step.

- **Inoculate**: a dead agent of the tool's strain is taken with a chance per step of 1 − exp(−rate · Δt), so the
  tool places the same number per second at every frame rate (`inoculateRate()` and `stepChance()` in
  `src/engine/pack.ts`). It goes to
  a uniform point of the brush disc, with a random heading. Its cell must be open, and, with one agent per cell, empty
  at the start of the step.
- **Cut**: an alive agent whose position lies within the radius of the tool takes the first of 8 uniform random points
  of the grid whose cell is open and that lie outside the radius. It keeps its heading. If none fits, it moves as usual.
- **Respawn** (flow on, for every agent that no tool places): a dead agent of strain s draws one uniform point of the
  grid. It comes to life there with the chance 0.2 · (D_s − 0.5) / 0.5 if the cell is open, holds a tube of its own
  strain (B_s ≥ 0.05) and has D_s > 0.5 (section 8.5; ADR 0031). A tube of another strain gives it no life. With one
  agent per cell the cell must also be empty at the start of the step, whatever the strain of the agent in it, and the
  agent claims it like a move (7.6).

### 7.3 Sensing

The agent senses only if the step senses: always sensing first; moving first in every step but step 0.

- The three sensors lie at p_F = p + SO · d(θ), p_L = p + SO · d(θ − SA) and p_R = p + SO · d(θ + SA). The code and the
  tests call the sensor at θ + SA the right one.
- A sensor reads the one cell ⌊p⌋ of its point. Sensor width is one cell; the model has no threshold sMin.
- It reads **blocked** (−1e30) if its cell is outside Ω or a wall, and in the extended model with walls also if a wall
  lies on the line from the agent to the sensor (ADR 0020).
- Otherwise it reads V = Σ_l A[s][l] · σ_K(T_l) + w_F[s] · C_F − w_L[s] · C_L, with σ_K(t) = t without saturation
  (section 6.8).

### 7.4 Turning

With the readings F, L and R (Jones 2010, Fig. 3):

1. If F > L and F > R: keep the heading.
2. Else if F < L and F < R: turn by +RA or −RA, each with the chance 1/2.
3. Else if L < R: turn by +RA (toward R).
4. Else if R < L: turn by −RA (toward L).
5. Else keep the heading.

So F = L > R turns by −RA, F = R > L by +RA, F > L = R keeps, F < L = R turns at random, and F = L = R keeps. Then, with
the chance pCD (Random turn), the heading becomes a uniform random angle. The heading is kept in [0, 2π).

### 7.5 Moving

The target is p' = p + SS · d(θ), with SS the step size. The move succeeds if the target's cell is open and, while
walls exist, no wall lies on the way: a walk over every cell that the segment crosses, both cells beside a corner that
it passes within 0.001 cells (ADR 0019, ADR 0020). On the torus p' wraps.

- **Success**: the agent moves to p' and counts once in n_s of the target's cell, its deposit (section 6.2).
- **Blocked**: the agent stays, takes a uniform random heading in place of the one it turned to, and deposits nothing
  (Jones 2010, p. 133).

A move inside the agent's own cell succeeds unless that cell is a wall. The start cell is never checked on the way, so
an agent under a wall that was painted onto it can step out of it.

### 7.6 One agent per cell

Jones' rule (Jones 2010, p. 132; ADR 0008). The agents update at the same time, not in Jones' random order, with
claims:

1. **Claim**: each agent senses, turns and claims its target cell with `atomicMax(claims[cell], key)`. A key is unique
   in a step: a bijective hash of the id, the step and the seed. It may claim only an open cell other than its own that
   was empty at the start of the step, with no wall on the way. A tool's placement claims its cell the same way.
2. **Settle**: the agent whose key won moves and deposits. A loser is blocked (7.5). A placement that loses stays dead
   (inoculate, respawn) or stays where it was (cut).

A cell that an agent leaves in this step stays closed to others until the next step. Without the rule, agents share
cells without a limit.

### 7.7 Random numbers

Every random number comes from a PCG hash of (id, step, seed, stream): rng = pcg(id ^ pcg(step ^ pcg(seed ^ stream))),
then u = (pcg(state) >> 8) / 2^24 (`shaders/common.wgsl`). The streams: steer 0, tool 1, shrink 2, blocked heading 3,
growth 4 to 6, start round k 7 + 65536 · k, respawn 8, starve 9. So a run is the same for the same seed on one backend.
For one agent and step the streams differ by construction, because pcg is a bijection. A start round's stream can
equal another stream at a later step: for seeds 0 to 999, start rounds 0 to 64 and steps below 10^6, this happens at
one step in each of 134 (seed, round, stream) cases.

## 8. Flow in the tubes

Extended model only, off by default (ADR 0029). Tero, Kobayashi and Nakagaki 2007 and Tero et al. 2010 on the grid
cells in place of a graph. Code: `shaders/flow.wgsl`, `gl/glsl/flow.frag`, constants in `src/engine/flow.ts`, a CPU
copy of both passes in `src/engine/flow-reference.ts`.

**Every strain has a flow of its own** ([ADR 0031](adr/0031-a-flow-for-every-strain.md)). The rules below run once per
strain s, on the trail T_s of that strain alone, with the fields B_s, D_s, G_s and P_s,k of that strain; below, B, D, G
and P are those of the strain of the pass. The strains share the food sites, the flow strength I0 and every constant of
`FLOW`; only the trail levels of the tube body are in the unit of the trail of each strain (8.1). No flux passes from
the tubes of one strain into the tubes of another: the app has no fusion of strains. With one strain a run keeps the
bytes that it had with the flow of ADR 0029 (18 runs checked, ADR 0031).

### 8.1 The network on the grid

- Every open cell is a node; its 4 neighbours are its edges.
- **Tube body**: B ← B + 0.02 · (π − B), with π = clamp((T_s − 0.2 · u_s) / (0.8 · u_s), 0, 1) from the trail of the
  strain after this step's diffusion. A cell holds a tube of the strain while B ≥ 0.05.
- **The unit of the trail** u_s = depT_s · κ(decT_s) / κ(0.1), with depT_s the deposit of the strain (at least 1e-6)
  and decT_s its decay (ADR 0032). κ(d) is the trail that a cell holds in the end when an agent enters it at every
  step, in deposits: (1 − d) / d when a step senses first, and 1 / d when it moves first (section 5), with d kept
  inside [1e-4, 0.9]. At Jones' decay of 0.1 the unit is one deposit. A strain whose trail decays faster holds less
  trail, and its levels are lower in the same ratio: at a decay of 0.6, sensing first, a thirteenth (`trailLevels()`
  in `src/engine/flow.ts`).
- **Conductivity**: G = B · (0.02 + D) on a tube, 4 B on a tube on food, 0 elsewhere.
- **Edge conductance**: the harmonic mean H(a, b) = 2ab / (a + b), 0 if a or b is 0. The pressure solve uses
  Ĝ = H(G_a + 1e-5, G_b + 1e-5), so a cell holds a pressure before it joins the network.
- **Flow memory** D ∈ [1e-4, 1], 0.2 at the start and on closed cells.

### 8.2 Food sites and their roles

- A site is the cell of the start point of a painted food stroke, in the order of the list. Each cell counts once, cells
  outside the grid are dropped, and with more than 64 the sites spread evenly over the list (`flowSites()`).
- A site is **covered** by the strain while its cell holds food and a tube of the strain (B ≥ 0.05 in the last step).
  Two strains can cover the same site.
- The roles of the strain in each of the 4 lanes: with fewer than 2 sites that the strain covers, none. With exactly 2,
  the first gives and the other takes. With m ≥ 3, the covered sites are shuffled by a hash, ⌊m/2⌋ give, ⌊m/2⌋ take and
  an odd one rests; lane k draws again at steps where ⌊(t + 75 k) / 300⌋ changes, so every 300 steps, the lanes 75 steps
  apart. The hash is the same for every strain, so strains that cover the same sites draw the same roles.
- A site that gives adds I0 (the setting Flow strength), one that takes removes I0, scaled by a pressure limit h_c: full
  while σ (P_c − P̄) ≤ 0.75 L, then falling linearly to 0 at σ (P_c − P̄) = L, with L = 4096 · I0. P̄ is the mean
  pressure, in the lane, of every site that has a role in any lane of the flow of the strain, and σ is +1 to give and −1
  to take. Two strains that cover the same two sites carry I0 each.

### 8.3 The pressure

Kirchhoff's law Σ_n Ĝ_cn (P_c − P_n) = σ_c · I0 · h_c, solved with 16 iterations per step of damped Jacobi with
momentum, in each lane, from the pressure of the last step:

- P* = (Σ_n Ĝ_cn P_n + σ_c I0 h_c) / Σ_n Ĝ_cn;
- J = P + 0.9 (P* − P);
- P_new = ω J + (1 − ω) P_old, with ω = 2 / (1 + √(1 − 0.99999²)) ≈ 1.991 on cells that conduct, and ω = 1 elsewhere.

P_old is the input of the iteration before. The zero point is the first site with a role in the flow of the strain, or
the first site of the list while none has one: the first two iterations of a step subtract its pressure at the start of
the step, the first from its result and the second from its momentum term. That shifts the whole history and changes no
difference.

### 8.4 Flux and adaptation

- Flux of a cell: Q = ½ · Σ_{n ∈ N4} H(G_c, G_n) · |P_c − P_n|, per lane, with G and P of the last step.
- f(Q) = Q^1.8 / (1 + Q^1.8) (Tero et al. 2010, γ = 1.8), averaged over the 4 lanes.
- On a tube, while at least 2 sites had a role in the flow of the strain in the last step:
  D ← max(1e-4, D + 0.003 · (f − D)), Tero's dD/dt = f(|Q|) − D at a rate of 0.003 per step. On a tube without roles
  D stays. On ground without a tube: D ← min(0.2, max(D, 1e-4) · 1.00023), so starved ground comes back to 0.2 in
  about 33,000 steps.

### 8.5 The flow and the agents

An agent follows the flow of its own strain: D and B below are those of the agent's strain (ADR 0031).

- **Starvation** (7.1): the chance 0.02 · h² / (D² + h²) per step, h = 0.01: 2 % at D = 0, 1 % at D = 0.01, 0.005 % at
  D = 0.2.
- **Respawn** (7.2): never for D ≤ 0.5, 20 % per step and dead agent at D = 1 on the cell it draws.
- **Growth**: an agent does not divide on a cell with D < 0.01 (section 9).
- The agent and growth passes of step k read D of step k − 1.
- A strain that covers fewer than 2 sites has no flux, and none of its cells adapts (8.4): its agents follow the memory
  that its cells hold.

### 8.6 Time scale

30 steps are one minute. The constants give: body 50 steps (1.7 min), adaptation 333 steps (11 min), a tube without flux
falls from D = 0.2 to 0.01 in 998 steps (33 min) while the flow of its strain has two sites with a role, roles 300 steps
(10 min), recovery of starved ground about 33,000 steps (18 h). The time scale, 30 steps per minute, was set so that
these constants give the organism's times (ADR 0029, decision 10; Marbach et al. 2023); see [fidelity.md](fidelity.md),
row 4.

## 9. Growth and shrinkage

Jones 2011, Sec. 5.1; ADR 0025. Only with one agent per cell. Code: `shaders/growth.wgsl`, `gl/glsl/growth.frag`, a CPU
copy in `src/engine/growth-reference.ts`.

- **When**: the shrinkage test runs on steps with t mod Sf = 0, the growth test on steps with t mod Gf = 0, both from
  step 0, after the moves of the step. A step without a test runs no pass.
- **Windows**: n_G(c) is the number of agents in the Gw × Gw block around c, n_S(c) in the Sw × Sw block, both after
  the moves and with the agent's own cell. Wrap wraps; in a box and a dish, cells outside count 0.
- **Shrinkage**: an agent dies if n_S < Smin or n_S > Smax.
- **Growth**: a survivor divides if it moved in this step, Gmin ≤ n_G ≤ Gmax, at least one of its 8 neighbours is
  free, and (flow on) D_s ≥ 0.01 for its strain s on its cell after the moves, from the last step. A neighbour is free
  if it is open and was empty after the moves. A diagonal neighbour is free only if the two cells beside the corner
  between it and the agent's cell are not both walls: with one wall a move from the agent's cell can reach it through
  the other cell, with two walls no move can (7.5). A cell outside a box or the dish is no wall here, as for a move.
  The agent claims one of the free neighbours at random, with the key of a move (ADR 0025, decision 35).
- **Births**: the winners' births are matched to dead agents of the same strain by rank, in a new random order of the
  cells each step. A birth without a dead agent is dropped. The capacity limits the population.
- **The child**: a uniform random position in its cell, a uniform random heading, no deposit in its step.

Defaults (Jones 2011): Gf 3, Gw 9, Gmin 1, Gmax 10; Sf 3, Sw 5, Smin 0, Smax 20.

## 10. Start layouts

`shaders/init.wgsl`, `gl/glsl/init.frag`. Every agent draws a heading. The layouts: mixed (uniform; with one agent per
cell a random permutation of the cells), bands (the strains side by side), sectors, colonies (one disc per strain),
ring, center, empty (every agent dead) and food (every agent dead; for each strain one inoculate step places about 50
agents of the strain on a food of its own, a disc of about 100 cells at half the density of a full sheet: strain A on
the first food of the scene, strain B on the second, and so on, and a strain without such a food starts without
agents; ADR 0025, ADR 0032). With one agent per cell,
claim rounds give each alive agent its own cell: 1 round for the mixed layout on a periodic grid or a box, without walls; else 64
(`startRounds()` in `src/engine/pack.ts`); a loser
of the last round starts dead. Without the rule an agent draws again up to 32 times while its cell is not open. With a
capacity above Agents per cell, only the first agents of each strain start alive.

## 11. Parameters

Every parameter of the model, with its key in `src/model/params.ts`. The unit test `src/model/model-doc.test.ts`
checks that this table names every key.

| Key                 | Symbol   | Unit, range                                                          | Default           | Model    | Section |
| ------------------- | -------- | -------------------------------------------------------------------- | ----------------- | -------- | ------- |
| `sensorAngle`       | SA       | degrees, 0 to 180                                                    | 22.5              | both     | 7.3     |
| `sensorOffset`      | SO       | cells, 1 to 64                                                       | 9                 | both     | 7.3     |
| `rotationAngle`     | RA       | degrees, 0 to 180                                                    | 45                | both     | 7.4     |
| `stepSize`          | SS       | cells, 0.1 to 8                                                      | 1                 | both     | 7.5     |
| `deposit`           | depT     | per move, 0 to 50                                                    | 5                 | both     | 6.2     |
| `decay`             | decayT   | fraction lost per step, 0.0001 to 0.9                                | 0.1               | both     | 6.2     |
| `randomTurn`        | pCD      | chance per step, 0 to 0.5                                            | 0                 | both     | 7.4     |
| `share`             |          | share of the population, 0.05 to 1                                   | 1                 | extended | 4       |
| `food`              | w_F      | weight, −2 to 2                                                      | 1                 | extended | 7.3     |
| `light`             | w_L      | weight, −2 to 2                                                      | 1                 | extended | 7.3     |
| `attraction`        | A[s][l]  | weight, −2 to 2; Jones: own weight ±1 only                           | +1 own, −1 others | both     | 7.3     |
| `density`           | %p / 100 | agents per cell, 0.01 to 8 (≤ 1 with one agent per cell)             | 1                 | both     | 4, 10   |
| `capacity`          |          | agents per cell, 0.01 to 8; 0: as density                            | 0                 | both     | 4, 9    |
| `diffusion`         | N        | passes, 0 to 4                                                       | 1                 | extended | 6.2     |
| `foodStrength`      | wProj    | 0 to 0.5                                                             | 0.05              | both     | 6.4     |
| `lightStrength`     | wLight   | 0 to 0.5                                                             | 0.05              | extended | 6.4     |
| `scentDecay`        | d_C      | fraction lost per step, 0.0001 to 0.9                                | 0.1               | extended | 6.4     |
| `coveredFoodFactor` | φ        | 0.0001 to 1                                                          | 0.001             | both     | 6.5     |
| `trailSaturation`   | K        | trail units, 0 to 1000; 0 is off                                     | 0                 | extended | 6.8     |
| `shrink`            | p_remove | chance per step, 0 to 0.002                                          | 0                 | both     | 7.1     |
| `growthEvery`       | Gf       | steps, 0 to 100                                                      | 3                 | both     | 9       |
| `growthWindow`      | Gw       | cells, 3 to 15, odd                                                  | 9                 | both     | 9       |
| `growthMin`         | Gmin     | agents, 0 to 225                                                     | 1                 | both     | 9       |
| `growthMax`         | Gmax     | agents, 1 to 225                                                     | 10                | both     | 9       |
| `shrinkEvery`       | Sf       | steps, 0 to 100                                                      | 3                 | both     | 9       |
| `shrinkWindow`      | Sw       | cells, 3 to 15, odd                                                  | 5                 | both     | 9       |
| `shrinkMin`         | Smin     | agents, 0 to 225                                                     | 0                 | both     | 9       |
| `shrinkMax`         | Smax     | agents, 1 to 225                                                     | 20                | both     | 9       |
| `flowStrength`      | I0       | the flux of each strain at a site, 0.1 to 32                         | 8                 | extended | 8.2     |
| `model`             |          | jones, extended                                                      | extended          |          | 2       |
| `stepOrder`         |          | move-first, sense-first                                              | sense-first       | both     | 5       |
| `boundary`          |          | wrap, box, dish                                                      | wrap              | both     | 1, 6.3  |
| `collisions`        |          | one agent per cell, on or off                                        | off               | both     | 7.6     |
| `coveredFood`       |          | on or off                                                            | off               | both     | 6.5     |
| `growth`            |          | on or off (needs one agent per cell)                                 | off               | both     | 9       |
| `flow`              |          | on or off                                                            | off               | extended | 8       |
| `layout`            |          | section 10                                                           | mixed             | both     | 10      |
| `seed`              |          | integer                                                              | 1                 | both     | 7.7     |
| `resolution`        | W or H   | cells on the long side of a grid shaped like the screen, 256 to 4096 | 1536              | both     | 1       |
| `lattice`           | W × H    | a grid of fixed size in place of `resolution` (ADR 0026)             | none              | both     | 1, 3    |

"Model: both" means the parameter acts in both models with every value of its range. The Jones model requires one
strain, one agent per cell, one diffusion pass and the own weight ±1 (`jonesFits()`), and binds the food weight to the
own weight, the scent decay to the strain's decay, the share to 1, light and K to off, and the flow to off
(`asJones()`). `speed`, `exposure`, `bloom`, `style`, `gelColor`, `showScent` and `showTubes` change only the view and
the playback, not the model. `showTubes` draws the picture of the tubes from the trail and the flow memory of each strain,
and grains that move with the flux of each strain; its rule is in [design.md](design.md), section 5, and in ADR 0034.

## 12. The two backends

WebGPU (`*.wgsl`) and WebGL2 (`*.frag`, `*.glsl`) compute the same rules. The GPU tests run every rule on both. They
differ in these points:

- The keys of a claim and of a start round are different hash functions (32 bits on WebGPU, 24 bits on WebGL2). So
  runs with one agent per cell differ between the backends wherever claims conflict.
- The id is a bit field on WebGPU and the texel index on WebGL2. The rules read the same id.
- WebGL2 without float blending has no rule of one agent per cell, so neither the Jones model nor growth: there the
  backends differ in a rule.
- The light byte of a stroke may differ by ±1, a difference in a source.

No test compares the bytes of the two backends; the ADRs quote digests of runs made off-line.

## 13. Tests of the rules

All in `src/engine/sim.gpu.test.ts` on both backends unless another file is named.

| Rule                                    | Test                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Order of a step, both orders, step 0    | "the order of a step" (four tests)                                                                                              |
| Turning (7.4)                           | the agent rule: keeps, turns right, turns left, random turn, all sensors equal                                                  |
| Moving and walls (7.5)                  | blocked by a wall; a step of 3 and of 8 cells; no slip through a corner                                                         |
| Walls block sensors (7.3)               | "walls block sensors"; sensor wall check in the extended model only                                                             |
| The 3 × 3 mean and the decay (6.1, 6.2) | "apply a periodic 3 × 3 mean, then × (1 − decay)"; rounding per order                                                           |
| Mass balance (6.2)                      | "balance mass with deposits"                                                                                                    |
| Edges and walls in each model (6.3)     | "diffuse trail, food and light at the edges and walls as the CPU reference does"                                                |
| Jones' one map (6.4)                    | "keep trail + scent equal to Jones' one trail map"                                                                              |
| Scent plateau and g (6.4)               | the plateau tests in each order; the scent against a CPU reference                                                              |
| Covered food (6.5)                      | the covered food tests, also WebGL2 without float blending                                                                      |
| Cut in the fields (6.6)                 | the cut clears the chemicals in the extended model only                                                                         |
| K (6.8)                                 | turns with saturation against a CPU reference                                                                                   |
| One agent per cell (7.6)                | at most one agent per cell, none lost; determinism                                                                              |
| Tools (7.2)                             | inoculate onto free cells; dead agents only; cut to free cells                                                                  |
| Growth (9)                              | growth against the CPU copy in each arena; no child between two walls at a corner; intervals; one agent per cell                |
| Flow (8)                                | `flow.gpu.test.ts`: both passes against the CPU copy, Kirchhoff, the dead end, the pressure limit, starvation and respawn rates |
| The unit of the trail (8.1)             | `flow.test.ts`: κ, and the levels at Jones' decay; `flow.gpu.test.ts`: a tube on a weak trail that decays fast                  |
| A colony for each strain (10)           | `engine.gpu.test.ts`: three strains in the Foraging maze start two colonies on the two foods                                    |
| A flow per strain (7.1, 7.2, 8, 9)      | `flow.gpu.test.ts`: no flux between two strains; starvation, respawn and growth by the memory of the own strain                 |
| Scale grows with SO                     | the network scale test (Jones 2010, Fig. 10)                                                                                    |

`flow.gpu.test.ts` also tests the flow of each strain (ADR 0031) on both backends: each strain its whole I0 on its own
route between the same foods; the CPU copy for the strains s = 1 to 3 (the second of two, the third and the fourth of
four); a change of the number of strains during a run.

Not tested: the random turn pCD (no test uses pCD > 0), the rate of random shrinkage, the value of the blocked heading
(a test checks only that it changes), and agents under a painted wall.

## 14. Open points in the code

Each one is open, not a rule. The first two were found while this file was written, the last one in ADR 0031:

- An agent under a wall that was painted onto it is not moved off the wall, and can step out (7.5).
- A start round's stream of random numbers can equal another stream at a later step (7.7).
- A site is one cell (8.2). Where strains share a food dot, only the strains whose tube holds its cell cover it
  (ADR 0031 and `TODO.md`).

Closed on 2026-11-13: respawn (7.2) brought a dead agent of any strain to life, so with the flow a strain appeared that
nobody had inoculated (found by the owner). Every strain has a flow of its own now (ADR 0031). And the flow did
nothing for a strain whose trail stayed below 0.2 deposits, as in the start scene Three strains with one agent per
cell. The levels follow the decay of the strain now (8.1, ADR 0032). A child of the growth rule could land between two
wall cells that touch at a corner, where no move can go (9); it no longer can (ADR 0025, decision 35).
