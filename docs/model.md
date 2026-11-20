# The model: the rules in force

Status: the rules of `main`; a pull request that changes a rule changes this file too (ADR 0030). This file states what the simulation computes, as
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
- **N(x)**: the 3 × 3 block around x, wrapped on the torus. **N_w(x)**: the block of w × w cells around x, for an odd
  side w; N_3 = N.
- **Step k**: the k-th call of the step; the counter is 0 after a reset.
- **Strains** s = 0 … 3, with the trail lane of the same number. **u** is a uniform random number in [0, 1).
- Angles are degrees in the panel and radians in the shaders. d(a) = (cos a, sin a) is the unit vector of a heading.

## 2. The two models

The setting Model picks the rule set (ADR 0022, ADR 0044). `jonesFits()`, `asJones()` and `constrain()` in
`src/model/params.ts` and `packParams()` in `src/engine/pack.ts` hold the differences.

| Rule                     | Jones                                            | Extended                                               |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Strains                  | 1                                                | 1 to 4, each with a share of the population            |
| Weight of the trails     | own trail +1 (attraction) or −1 (chemorepulsion) | a table A[s][l] from −2 to +2                          |
| Weight of the food scent | the weight of the own trail                      | w_F per strain                                         |
| Light                    | a repellent source, weighed as the own trail     | lit cells release a repellent; weight w_L per strain   |
| Scent decay              | the strain's decay                               | a setting of its own                                   |
| Source scale g           | 1                                                | keeps the plateau of a food at every scent decay (6.4) |
| Trail saturation K       | off                                              | optional, K ≥ 1                                        |
| Diffusion passes         | 1                                                | 0 to 4                                                 |
| Mean window              | 3 to 15 cells a side, odd (ADR 0046)             | 3 × 3                                                  |
| One agent per cell       | on                                               | optional                                               |
| Walls in the diffusion   | part of the lattice: they diffuse and decay      | sinks that hold 0                                      |
| A wall on a sensor's way | not checked                                      | the sensor reads blocked                               |
| The cut tool             | moves agents, keeps trail and scent              | moves agents, clears trail and scent in the wound      |
| Flow in the tubes        | never                                            | optional, a flow for each strain                       |
| Growth and shrinkage     | optional                                         | optional                                               |
| The rules of stage 4     | never                                            | optional, with growth and the flow (6.10)              |

One strain, one agent per cell, one diffusion pass and an own weight of ±1 are required: a Jones model without one of
them becomes extended (`jonesFits()`). The other values of the Jones column are bound: `constrain()` resets them
(`asJones()`), and `packParams()` packs Jones' values whatever the settings hold. The mean window is bound the other
way: the extended model resets it to 3 (`asExtended()`), and `meanWindowOf()` gives 3 there whatever the settings
hold. Walls, light and the cut change no
model. In the Jones model the trail plus the food scent minus the repellent is Jones' one trail map, and drawn light
is a repellent source of it (section 6.4). In both models the cut
moves the agents of its wound only while growth does not run; while growth runs it kills them (7.1, ADR 0039).

## 3. Units and scales

- Lengths are in cells, times in steps. Jones gives his lengths in cells too, so his scenes run on the lattice of their
  figure (ADR 0026).
- The flow defines a physical time: 30 steps are one minute, so a step is 2 s (ADR 0029, decision 10). The life time
  of the slime has the same scale, with the flow and without it (section 6.9). The other rules have no time scale.
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
| ε⁺, ε⁻  | 1 where the electrode byte of `env` holds a cathode (ε⁺) or an anode (ε⁻), section 6.7 | 0 or 1    |
| n_l     | agents of strain l whose move ended in the cell in this step                           | integers  |
| occ     | alive agents in the cell after the moves; on a growth step after its deaths and births | integers  |
| D_s     | flow memory of strain s (flow only, section 8)                                         | [1e-4, 1] |
| B_s     | tube body of strain s (flow only, section 8)                                           | [0, 1]    |
| G_s     | conductivity of the flow of strain s (flow only)                                       | [0, 4]    |
| P_s,k   | pressure of the flow of strain s in lane k = 0 … 3 (flow only)                         | float     |
| S       | stamp of the slime, one for all strains (extended model only, section 6.9)             | integers  |
| A       | amount of slime, one for all strains (extended model only, section 6.9)                | 0 … 4095  |
| Θ       | territory: bit s while the cell lies in the territory of strain s (section 6.10)       | bits 0–3  |
| O       | owners: bit s for an alive agent of strain s after the moves and births (6.10)         | bits 0–3  |

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
4. **Stamps and amounts of the slime**, only in the extended model while the Slime life time is above 0 (section 6.9).
   It reads the trail of every strain after the diffusion.
5. **Flow**, only while it is on (section 8). It runs once per strain and reads the trail of that strain after the
   diffusion.
6. **The push of the territory**, only while the rules of stage 4 run (section 6.10). It reads the owners, which a
   pass fills from the agents after the moves and the births of the step.

The two orders differ in when the agents sense, and in where the diffusion adds the sources:

- **Move first**: X^k = keep · M^N(X^(k−1)) + Q^k. The fields then hold the map after the diffusion plus the deposits
  of the moves. In step k+1 the agents first sense and turn on this map, then move. So the code's step k is Jones'
  sensory stage of step k − 1 plus his motor stage of step k. In step 0 after a reset no agent senses: it moves with
  its start heading, as in Jones' first step.
- **Sense first**: X^k = keep · M^N(X^(k−1) + Q^k). Every step senses, the first one too.

Here X is a field, Q^k its sources in step k, M the mean (3 × 3, or the mean window of the Jones model, section 6.1)
and N the number of passes (section 6.2).

## 6. The fields

ADR 0007, 0022, 0027, 0046. Code: `shaders/diffuse.wgsl`, `gl/glsl/diffuse.frag`, `sourceScale()` in
`src/engine/pack.ts`, `diffusePlan()` in `src/engine/sizing.ts`.

### 6.1 The mean

M f(x) = 1_S(x) · (1/w²) · Σ_{y ∈ N_w(x)} 1_S(y) · f(y).

The side w of the window is 3 in the extended model. In the Jones model it is the setting Mean window: 3, 5, 7, 9, 11,
13 or 15. It is 15 in the scene Electrotaxis (ADR 0047), 5 in the scene Voronoi diagram (ADR 0048) and 3 in every
other scene (ADR 0046). Jones 2010 uses 3 × 3; his later papers use larger windows (5 × 5 as a rule: Jones and
Adamatzky 2015, arXiv:1503.06973, p. 7; 15 × 15: Tsuda, Jones et al. 2011, arXiv:1204.1752, p. 10).

The divisor is w², the number of cells of the window, at every site. A cell outside S counts 0 and holds 0. So trail
that reaches a closed edge, a dish's rim, or a wall of the extended model is lost (absorbing edges, Jones 2011). A
site within (w − 1) / 2 cells of a closed edge loses trail in every step.

The same mean feeds the trail and both scents, so in the Jones model the food scent spreads with the window of the
trail (section 6.4). The window does not stop at a wall of the Jones model: the wall is a site, and so are the cells
behind it. A window above 3 crosses a wall that is thinner than (w − 1) / 2 cells in one step.

**How the code sums.** For w = 3 one dispatch sums the 9 cells (entry point `diffuse`), the code before ADR 0046.
For w > 3 two dispatches run (entry point `box`): the first writes, at every cell of the grid's rectangle, a sink
too, the sum of 1_S · f along the row of the window; the second sums those sums along the column of the window and
multiplies by 1/w². A row outside a closed grid counts 0. In exact arithmetic that is the sum over N_w(x); in float32
it rounds apart from a sum over the window cell by cell, by a few units in the last place.

### 6.2 The update of one step

The diffusion runs N passes (the setting Diffusion passes; the Jones model always runs 1). The last pass multiplies by
keep_l = 1 − decay_l for the trail and keep_C = 1 − d_C for the scent. With N = 0 one pass runs without the mean.

The sources of step k, on open cells only:

- deposit: E_l^k(x) = 1_O(x) · depT_l · n_l^k(x);
- food: F^k(x) = 1_O(x) · f(x) · 255 · wProj · g · κ^k(x), with κ for covered food (section 6.5);
- light: L(x) = 1_O(x) · λ(x) · 255 · wLight · g. In the Jones model it is the source of a repellent (section 6.4).
- electrodes (ADR 0047): X⁺(x) = 1_O(x) · ε⁺(x) · 255 · wElec · g for a cathode and X⁻(x) = 1_O(x) · ε⁻(x) · 255 ·
  wElec · g for an anode. The cathode releases into the food scent and the anode into the repellent: where the
  formulas below say (F^k, L), the code adds (F^k + X⁺, L + X⁻). Covered food does not reduce X⁺ (section 6.5).

With the cut mask Z^k (0 in a wound of the extended model, 1 elsewhere, section 6.6):

- **Move first**: T_l^k = keep_l · M^N(Z^k · T_l^(k−1)) + Z^k · E_l^k, and C^k = keep_C · M^N(Z^k · C^(k−1)) +
  Z^k · (F^k, L). The sources come after the decay, in the last pass.
- **Sense first**: T_l^k = keep_l · M^N(Z^k · (T_l^(k−1) + E_l^k)), and the scent the same with F^k and L. The sources
  come before the mean, in the first pass.

Moving first, the last pass multiplies the sum by keep/9 in one factor, as Metal folds it, written out on both backends
(ADR 0027, decision 23). Sensing first, it takes the mean and then the decay, as the code before ADR 0027 did
(decision 28). The two orders therefore round apart in float32. With a mean window above 3 both orders multiply the
sum by keep/w² in one factor (ADR 0046).

**Mass.** On the torus M keeps the sum, so Σ T^k = keep · Σ T^(k−1) + depT · Σ n^k moving first, and keep · (Σ T^(k−1) +
depT · Σ n^k) sensing first. Closed edges and walls of the extended model take mass away.

**Steady state.** Inside a large food, C* = F / d_C moving first and (1 − d_C) · F / d_C sensing first.

### 6.3 Boundaries and walls

- _wrap_: the mean, the sources and every window wrap.
- _box_ and _dish_: cells outside Ω are sinks (they count 0 and hold 0).
- **Walls, Jones model**: part of the lattice. They take the mean and the decay like any cell, but no deposit, food or
  light. A sensor on a wall cell reads blocked. A mean window above 3 reads the cells behind a thin wall (6.1).
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
  T_0 + C_F follows Jones' update of one trail map with the sources depT · n + f · 255 · wProj.
- **A repellent in Jones' one map** (ADR 0044). Jones' papers project a repellent, such as salt or a current source,
  as a source below 0 onto the same lattice (Jones and Adamatzky 2015, Sec. 4.1; Tsuda et al. 2012, p. 10). In the
  Jones model a lit cell is such a source. The app keeps the repellent above 0 in its own field C_L, with the mean, the
  sites, the decay and the pass of the trail, and the sensors subtract it with the own weight (7.3). So
  J = T_0 + C_F − C_L follows Jones' update of one map with the sources depT · n + f · 255 · wProj − λ · 255 · wLight,
  and a sensor reads A[0][0] · J. J falls below 0 near a repellent: no field is clamped. The panel calls wLight
  Repellent strength in the Jones model. Jones' own rule for light is another one (Jones and Adamatzky 2012, p. 7: a
  lit agent's sensors read less), and the app does not have it.
- **Electrodes** (ADR 0047). Tsuda, Jones et al. 2011 (p. 10) model an electric current in the same map: a current
  sink projects +255 and a current source −255 at every step, and the map takes the mean of 15 × 15 cells. A cathode of
  the Electrode tool is such a sink and an anode such a source: in the Jones model J takes + ε⁺ · 255 · wElec −
  ε⁻ · 255 · wElec, and wElec = 1 (the setting Electrode strength) gives the paper's ±255. The app keeps the cathode's
  part in C_F and the anode's part in C_L, as it keeps food and the repellent. In the extended model that is this
  app's reading: the two parts have the source factor g and the scent decay, and a strain weighs them with w_F and
  w_L. An electrode is no food: it is no site of the flow (8.2), covered food does not reduce it (6.5), and the start
  layout Food does not count it (10). An electrode on a wall cell releases nothing, as food there.
- A GPU test steps a float64 map of Jones' rule beside the GPU and finds J within a relative error of 1e-5 of it
  (`sim.gpu.test.ts`, "keep trail + scent − repellent equal to Jones' one trail map"). With Jones' values (scent decay
  0.1, w_F = w_L = the own weight) the extended model gives the same bytes as the Jones model with a repellent ("run a
  repellent in the Jones model as the extended model with Jones' values does").

### 6.5 Covered food

Adamatzky and Jones 2010. While the setting is on, a food cell releases φ times its scent while any cell of its 3 × 3
block holds an agent after the moves (on a growth step: after its deaths and births): κ(x) = φ if f(x) > 0 and occ(y) > 0 for some y ∈ N(x) ∩ Ω, else κ(x) = 1. φ is
the setting Covered food factor (default 0.001). Light and electrodes are never reduced. The factor applies in the pass that adds the
sources. The rule is off in every scene.

### 6.6 The cut in the fields

The wound is the disc of the brush: cells whose centre lies closer to the tool than its radius (the nearest copy on the
torus). In the extended model every trail lane and both scent fields of the wound are set to 0 before the step's
diffusion, and the wound takes no source, in every step while the tool is held. Neighbours then diffuse back in. In the
Jones model the cut leaves the fields as they are (Jones 2010, p. 148).

### 6.7 Painted food, light, walls and electrodes

A brush stroke paints the cells of Ω whose centre lies within its radius r of the stroke (r ≥ 0.75 cells; a stroke of the user on
steps of 1/16 cell). Wall: the wall byte 255, food and light 0. Food: the food byte 255. Light: max(old, 255 ·
t² (3 − 2t)) rounded to a byte, with t = clamp((d − r) / (0.3 r − r), 0, 1) at the distance d from the stroke: 255
within 0.3 r, 0 at r. The shaders write this step out, because GLSL ES 3.00 leaves smoothstep undefined with its first
edge above its second (ADR 0007, amendment of 2026-11-13). Erase: all bytes 0 (`shaders/paint.wgsl`,
`gl/glsl/paint.frag`, CPU reference `lightByte()` in `brush.ts`). The Slime tool writes no byte of `env`: it paints the
slime field, and an erase and a wall also clear that field in their cells (6.9). A start spot of a scene paints
nothing (section 10).

A dab of light with a radius of 2.5 cells on the centre of a cell holds bytes that sum to 2,243: 0.977 of 3 × 3 cells
of the full byte. The scene Voronoi diagram paints its repellent dots so, in place of the hard dots of 3 × 3 cells of
its paper (ADR 0048).

An electrode (ADR 0047) has the fourth byte of the cell: an anode writes 128 and a cathode 255, with the hard edge of
food, and leaves the other bytes. So a cell holds one pole at most, and the pole painted last. A wall and an erase set
the byte to 0. The passes read a byte above 191 as a cathode and any other byte above 0 as an anode (`POLE_BYTE` in
`src/engine/types.ts`; CPU reference `paint-reference.ts`).

The view does not draw a pole from this byte. The brush also writes the distance to the outline of the cathodes and
of the anodes into a buffer of the renderer, and the view draws each pole from these distances as a lit stud
(ADR 0058; [design.md](design.md), sections 3 and 5). No rule reads that buffer.

### 6.8 Trail saturation K

In the extended model with K ≥ 1, a sensor reads each trail lane as σ_K(t) = t / (1 + t / K) before it weighs it. K
acts on the sensors only: not on the deposit, the diffusion or the scent (ADR 0022, decisions 15 to 17). K is 0 in
every scene.

### 6.9 The slime field

ADR 0055 and ADR 0057. Code: `shaders/slime.wgsl`, `shaders/amount.wgsl`, `gl/glsl/slime.frag`, `gl/glsl/amount.glsl`,
`src/engine/slime.ts`; the brush in `shaders/slime-paint.wgsl` and `gl/glsl/slime-paint.frag`; CPU reference
`src/engine/slime-reference.ts`.

Slime is the layer that a plasmodium leaves on its ground. Only the extended model has the slime field. It is one field
for all strains. It says where a colony was, when it was there last, and how much slime it built there. No rule of the
model reads the field yet, so it changes no run (ADR 0055, decision 1). Only the picture reads it.

- **A cell holds plasm** in a step when the trail of at least one strain of the settings, as the diffusion of that
  step leaves it, is at or above the low level of that strain: T_s ≥ 0.2 · u_s (section 8.1). The test is the same
  with the flow and without it.
- **The stamp.** The field holds one unsigned 32-bit integer S per cell: 0 for a cell without a stamp, else the number
  of a step plus 1. The first step of a run has the number 0. In step k every cell that holds plasm gets S ← k + 1.
  Every other cell keeps its S. A wall and a cell outside the arena never get a stamp: the diffusion leaves no trail
  there (6.3), and every low level is above 0.
- **The life time** L is the setting Slime life time in hours times 1,800 steps, as a whole number (section 3). With
  L = 0 the model has no slime: the pass of the stamps does not run, and the field keeps what it holds.
- **A cell has slime** for a reader in step k while S ≠ 0 and k + 1 − S < L. The age of the slime is k + 1 − S: 1 for
  a cell that held plasm in step k − 1, and 0 for a stamp that the Slime tool wrote since that step. A change of the
  setting acts on all slime at once.
- **The amount** (ADR 0057). The field holds a second whole number A per cell, from 0 to 4,095: how thick the slime
  is that the plasm built there. Only the picture reads it, and it shows A / 4,095 · (1 − age / L): slime gets thinner
  in a straight line until its life time is over. In step k a cell that holds plasm gets, in this order:
  - what is left of its amount, from its stamp before the step: 0 without slime (S = 0, or an age at or above L); A
    for slime of the age 0 or 1; else ⌊A · (L − age) / L⌋, with the age k + 1 − S. So plasm that comes back to old
    slime starts from what the picture showed, and plasm on ground without slime starts from nothing.
  - A ← max(A, min(P, A + 1)). P is the level of the plasm, the largest over the strains of
    clamp((T_s − 0.2 · u_s) / (0.8 · u_s), 0, 1) · 4,095, rounded to the nearest: the share π that the tube body follows
    (8.1).

  Every other cell keeps its A. So the amount grows by 1 per step under a full tube and is full after 4,095 steps,
  2.3 hours. It is never above the level that the plasm had, and it never falls while the cell has slime. A colony
  that only passes leaves little slime, and a tube that stays leaves much. No source gives the rate at which a
  plasmodium builds its slime: the 4,095 steps are a choice of this app, made on pictures (ADR 0057).

- **The front stamp** F of a cell (ADR 0060) is a third whole number, for the picture and for measurements: the
  step, plus 1, at which the growth front reached the cell. In step k a cell that holds plasm and has no slime before
  the step (S = 0, or k + 1 − S ≥ L) gets F ← k + 1. Every other cell keeps its F. So the growth front is the plasm
  that comes onto ground without slime. A cell keeps its front stamp while it has slime, with plasm or without it, and
  plasm that comes back onto slime is no front. F has a meaning only in a cell that has slime, and no rule of the
  model reads it. A stroke of the Slime tool sets F ← 0 in a cell that had no slime: no front reached painted slime.
  An erase and a wall leave F as it is. Clear and a reset set every F to 0.
- **The Slime tool** paints the field, not `env`. Its stroke has the cells of a food stroke (6.7), with the hard edge
  of food. Before step k it gives each open cell of the stroke S ← k + 1. A cell is open when it lies inside the arena
  and holds no wall. Painted slime ages as the slime of a colony does. An erase and a wall set S of their cells to 0,
  so no wall holds a stamp. Clear sets every S to 0. The toolbar has the tool while L > 0.
  The stroke also paints the amount: a cell at the distance d from the middle line of a stroke of the radius r gets
  A ← max(what is left of A, 4,095 · t³ (t (6t − 15) + 10)), rounded to the nearest, with
  t = clamp((r − d + 0.5) / 4, 0, 1). So painted slime rises from the edge of its stroke to the full amount over 4
  cells, without a step in its slope. An erase, a wall and Clear set A to 0 with S.
- **A reset** sets every S and every A to 0. The engine then paints again the strokes of the list that change the field (slime,
  erase, wall), from the first stroke of slime on and in their order, as before the step that comes next: S = 1 after
  a reset. A switch from the Jones model to the extended model does the same. So the painted slime of a scene is new
  at the start of a run (`repaintSlime()` in `src/engine/engine.ts`).
- **The Jones model** has no slime field: a switch to it frees the field with its stamps and its amounts.
- **Memory**: 12 B per cell. The stamps are a storage buffer on WebGPU and a texture of unsigned integers on WebGL2,
  4 B. The amounts are a second buffer on WebGPU, 4 B, and two textures of 2 B on WebGL2, where the pass reads the
  amounts of before a step from one and writes all of them into the other. The front stamps are a third buffer on
  WebGPU and a second texture of unsigned integers on WebGL2, 4 B. The fit of the grid counts them, and 3 B more for
  the maps of the picture, in the extended model with any life time, so the setting changes no grid.
- **A link** made before the setting holds no Slime life time and opens with 0: it has no slime, and it runs as it
  was made (`sanitize()`).

The same setting gives the mark of starved ground its time (8.4). The picture draws the slime as a wet film on the
ground, as thick as the amount says, and a skirt around young ground, by the age of the front stamp;
the rules of both are in [design.md](design.md), section 5.

### 6.10 The territory of each strain

ADR 0068, the rule set of ADR 0065 (decision 1) in the forms of ADR 0067 (decisions 4 and 6 to 9). Code:
`shaders/territory.wgsl`, `gl/glsl/territory.frag`, `gl/glsl/owners.vert`, the lines between `//#if TERRITORY` and
`//#endif` in `shaders/agents.wgsl` and `shaders/growth.wgsl`, and `#if TERRITORY` in `gl/glsl/tools.glsl`,
`agents.frag` and `growth.frag`; `src/engine/territory.ts`; CPU reference `src/engine/territory-reference.ts`.

The territory is the first of the rules of stage 4. They run only while the setting `territory` is on, in the extended
model with growth, and so with one agent per cell, and with the flow (`territoryOn()`). No scene turns them on yet.
Without them no pass of this section runs, and every other pass has the source of the code before, character for
character, so a scene keeps its bytes.

- **The territory** Θ is a set of cells for each strain, one byte per cell with bit s while the cell lies in the
  territory of strain s. It never shrinks.
- **What it does**: an agent moves, comes to life and is born only onto a cell of the territory of its strain (7.2,
  7.6, section 9). A move inside the own cell needs no territory: it goes onto no other cell. A tool puts an agent
  anywhere: inoculate, the cut and an agent under a wall (7.2).
- **The owners** O: after the moves and the births of a step, every cell gets bit s for each alive agent of strain s
  in it. With one agent per cell a cell has one owner at most.
- **The push**, last in a step: a cell joins the territory of every strain that owns it. An open cell outside the
  territory of strain s joins it with the chance 1 − (1 − v)^n, with v = 0.004 and n the number of agents of s among
  its 8 neighbours. For each cell and strain the push draws one number of a stream of its own (7.7), and the cell joins
  if the number lies below the chance of n. The CPU computes the 8 chances once and gives them to the passes as
  float32, in the uniform block of the flow after its sites (`PUSH_CHANCES`, `packTerritory()`). So the territory
  grows faster where more plasm lies at its edge (ADR 0065, finding 4). A cell is open when it lies in the arena and
  holds no wall. The push counts the neighbours across the seam of the periodic grid, and none outside a box or the
  dish. A diagonal neighbour counts only if the two cells beside the corner between it and the cell are not both
  walls, as for a move (7.5) and a birth (section 9); a cell outside a closed arena is no wall here. So the territory
  reaches no cell that an agent cannot enter (ADR 0069).
- **The start territory**: a reset clears the territory. With the start layout food (section 10), each strain gets
  every open cell whose centre lies within √(100 / π) + 3 ≈ 8.64 cells of its start (the disc of its colony and a rim
  of 3 cells), on the periodic grid of the nearest copy, just before the step that places its colony. A strain without
  a start gets none. Every other start layout starts without a territory: the first push gives every alive agent its
  cell.
- **A switch** of the rules restarts the run, also when growth or the flow turns them on or off (`apply()` in
  `src/engine/engine.ts`).
- **Memory**: 3 B per cell. The territory has two copies, because the push writes the next one: on WebGPU textures of
  4 cells per texel (`r32uint`), on WebGL2 targets of one byte per cell (`R8UI`). The owners are a buffer of 4 cells
  per word on WebGPU and a target of one byte per cell on WebGL2.
- **A link** holds the setting only while it is on; a link without it runs without the rules (`sanitize()`).

### 6.11 The sinks of each strain

ADR 0069, the rule set of ADR 0065 (decisions 1, 5 and 8) in the forms of ADR 0067 (decisions 3, 6 to 8 and 10). Code:
`shaders/sinks.wgsl`, `gl/glsl/sinks.frag`, `src/engine/sinks.ts`; CPU reference `src/engine/sinks-reference.ts`.

The sinks are the second of the rules of stage 4 (6.10). They run with the other rules (`territoryOn()`), and no scene
turns them on yet. They find the sinks of the flow of each strain; the pressure, the tubes and the sensors of the agents
read them (8.7).

- **A path** goes from a cell to one of its 8 neighbours that is open, across the seam of the periodic grid, and takes
  a diagonal step only where the two cells beside its corner are not both walls, as a move does (7.5). A cell outside a
  closed arena is no wall here. A cell lies within k steps of cell c when a path of at most k steps from c reaches it;
  c lies within 0 steps.
- **Ground without slime**: an open cell without slime for a reader of step k + 1 (6.9), so after the stamps of step k.
- **A sink** of strain s in step k is a cell that holds an agent of s (the owners, 6.10) and a tube of s (G_s > 0 after
  the update of the step, 8.1), that has room, a free cell of the territory of s within 1 step (a free cell holds no
  agent), and that lies at the edge of the territory of s: an open cell outside it lies within 2 steps. Its weight w
  is 1 if ground without slime lies within 6 steps, else 0.025. Every other cell has the weight 0 for s.
- **The tube of a sink** (ADR 0072): a sink must also lie on a tube that carries flux to it. The tube cells of s that
  a path between 4-neighbours over tube cells of s reaches from the cell, inside the square of 13 × 13 cells around
  it, must include a cell on the edge of the square or a port of s of the step (8.2). A step of such a path crosses
  the seam of the periodic grid. A patch of tube inside that square without a port takes no flux: the flow joins it
  to the network only by the ghost conductance (8.1), and the sinks there would pull its pressure down by tens of
  thousands in a step. Such patches come where the tube body of the first steps crosses 0.05 in pieces.
- **The sink rate** r_s of every cell is the mean of its weight over 100 steps. It counts in steps of 2^-24 as a whole
  number R: in each step R moves toward W = w · 2^24, rounded to the nearest (2^24 for the weight 1, 419,430 for
  0.025), by ⌈|W − R| / 100⌉. So the rate reaches its weight and stays there, the rate of a cell that is no sink comes
  to 0, and every GPU computes the same rate as the CPU. The cell holds the float r = R / 2^24, with a minus sign while
  it is a sink in this step; a reader takes its size.
- **The sums** of strain s after the step: R_s, the rates of the tube cells of s (G_s > 0) in steps of 2^-16, rounded to
  the nearest, ⌊(R + 128) / 256⌋ each; C_s, the tube cells of s; N_s, the sinks of s. R_s is a whole number below 2^40,
  held in two words of 32 bits. Every sum is the same integer in every order of the additions.
- **The state** of strain s after the step: R_s as a float in the unit of the rate, computed as high · 2^16 + low / 2^16
  from the two words, so that each addition rounds once; C_s; N_s; the covered ports P_s, the sites with a port of s in
  this step (8.2); and whether the front of s takes flux: N_s > 0, R_s > 0, and P_s > 0 or C_s > 0. The last three
  lanes hold the budget of the paid births of s, its agents of the front and its paid claims of the step (9.1).
- **The order** (ADR 0067, decision 6): for each strain the pass of the sinks and the pass of its state run after the
  update of its flow and before its pressure. The owners come before them, the push after them, so a sink reads the
  territory of the step.
- **A reset** sets every rate, sum and state to 0, and a new number of strains gives the sinks new buffers.
- **Memory**: 4 B per cell and strain on WebGPU, a buffer that the pass updates in place; on WebGL2 two targets of the
  rates, 8 B, and the pyramid of the sums, 16 / 15 B (section 12).

## 7. The agents

ADR 0007, 0008, 0020, 0022, 0023, 0027, 0038, 0039, 0041. Code: `shaders/agents.wgsl`, `gl/glsl/agents.frag`,
`gl/glsl/tools.glsl`.

The agent pass runs these parts in order for each agent.

### 7.1 Death

1. **Random shrinkage**: an agent alive at the start of the step dies if u < p_remove (the setting Random shrinkage;
   Jones 2010, Fig. 21 uses 0.00025).
2. **Starvation** (flow on): a survivor of strain s dies if u < 0.02 · h² / (D_s² + h²), with h = 0.01 and D_s the flow
   memory of its own strain on its cell from the last step (section 8.5).
3. **The cut and a wall** (while growth runs; ADR 0039): a survivor dies if its position lies within the radius of a
   held cut (the wound of 7.2), or if its cell is a wall at the start of its step (a wall was painted onto it). Growth
   runs while it is on with one agent per cell and Gf > 0 (`P.growth.x` > 0, `packParams()` in `src/engine/pack.ts`).
   Without growth these agents are placed instead (7.2). This test draws no random number.

A dead agent neither moves nor deposits in this step. Whatever killed it, it is a dead agent like any other:
inoculate, respawn (7.2) and a birth (section 9) can bring it back to life, also in the step in which it died, and no
count of alive agents holds it.

### 7.2 Placement by a tool, by the flow or off a wall

A dead agent may be placed instead of moving, and so may an agent that the cut reaches and an agent under a wall
while growth does not run (ADR 0023, ADR 0038; while growth runs these two die, 7.1, ADR 0039). A placed agent makes
no move and no deposit in its step.

- **Inoculate**: a dead agent of the tool's strain is taken with a chance per step of 1 − exp(−rate · Δt), so the
  tool places the same number per second at every frame rate (`inoculateRate()` and `stepChance()` in
  `src/engine/pack.ts`). It goes to
  a uniform point of the brush disc, with a random heading. Its cell must be open, and, with one agent per cell, empty
  at the start of the step.
- **Cut** (without growth): an alive agent whose position lies within the radius of the tool takes the first of 8
  uniform random points of the grid whose cell is open and that lie outside the radius (Jones 2010, Sec. 4.3). It keeps
  its heading. If none fits, it moves as usual.
- **Under a wall** (without growth): an alive agent whose cell is a wall at the start of its step (a wall was painted
  onto it) is placed as the cut places its agents, with or without a tool: it takes the first of 8 uniform random
  points of the grid whose cell is open, and while the cut is held one that also lies outside its radius. It keeps its
  heading. If none fits, it moves as usual (7.5). The points are those of the cut (the stream tool, 7.7): an agent that
  the cut reaches under a wall draws them once.
- **Respawn** (flow on, for every agent that no tool places): a dead agent of strain s draws one uniform point of the
  grid. It comes to life there with the chance 0.2 · (D_s − 0.5) / 0.5 if the cell is open, holds a tube of its own
  strain (B_s ≥ 0.05) and has D_s > 0.5 (section 8.5; ADR 0031). A tube of another strain gives it no life. With one
  agent per cell the cell must also be empty at the start of the step, whatever the strain of the agent in it, and the
  agent claims it like a move (7.6). While the cut is held, a point within its radius (the wound) is no respawn point,
  with and without growth: the agent stays dead and draws again in the next step (ADR 0041). This test draws no random
  number, so every other draw of the stream respawn (7.7) stays as it is. While the rules of stage 4 run, the cell
  must also lie in the territory of the agent's strain (6.10), a test that draws no number either.

### 7.3 Sensing

The agent senses only if the step senses: always sensing first; moving first in every step but step 0.

- The three sensors lie at p_F = p + SO · d(θ), p_L = p + SO · d(θ − SA) and p_R = p + SO · d(θ + SA). The code and the
  tests call the sensor at θ + SA the right one.
- A sensor reads the one cell ⌊p⌋ of its point. Sensor width is one cell; the model has no threshold sMin.
- It reads **blocked** (−1e30) if its cell is outside Ω or a wall, and in the extended model with walls also if a wall
  lies on the line from the agent to the sensor (ADR 0020).
- Otherwise it reads V = Σ_l A[s][l] · σ_K(T_l) + w_F[s] · C_F − w_L[s] · C_L, with σ_K(t) = t without saturation
  (section 6.8). In the Jones model w_F = w_L = A[0][0], the own weight +1 or −1 (section 6.4). So a strain that
  follows its trail turns away from a repellent, and a strain that flees its trail turns toward it.
- While the rules of stage 4 run, it reads V minus the drift times the mean pressure of the flow of its strain (8.7).

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

A move inside the agent's own cell succeeds unless that cell is a wall. An agent whose cell is a wall at the start of
its step dies while growth runs (7.1), and else is placed off the wall instead of moving (7.2). It moves only if none
of its 8 points fits, or, with one agent per cell, after it lost the claim of its point (7.6); then the start cell is
not checked on the way, so it can step out of the wall.

### 7.6 One agent per cell

Jones' rule (Jones 2010, p. 132; ADR 0008). The agents update at the same time, not in Jones' random order, with
claims:

1. **Claim**: each agent senses, turns and claims its target cell with `atomicMax(claims[cell], key)`. A key is unique
   in a step: a bijective hash of the id, the step and the seed. It may claim only an open cell other than its own that
   was empty at the start of the step, with no wall on the way, and while the rules of stage 4 run one of the territory
   of its strain (6.10). A placement (7.2) claims its cell the same way.
2. **Settle**: the agent whose key won moves and deposits. A loser is blocked (7.5). A placement that loses stays dead
   (inoculate, respawn) or stays where it was (cut, under a wall), with its heading, and draws again in the next step.

A cell that an agent leaves in this step stays closed to others until the next step. Without the rule, agents share
cells without a limit.

### 7.7 Random numbers

Every random number comes from a PCG hash of (id, step, seed, stream): rng = pcg(id ^ pcg(step ^ pcg(seed ^ stream))),
then u = (pcg(state) >> 8) / 2^24 (`shaders/common.wgsl`). The streams: steer 0, tool 1 (also an agent under a wall,
7.2), shrink 2, blocked heading 3, growth 4 to 6, start round k 7 + 65536 · k, respawn 8, starve 9, light stops growth
10 (section 9), the push of the territory 11 + 65536 · s for strain s (6.10), which draws with the index of the
cell in place of the id, and the key of a paid birth 12 (9.1); the death in the wound of a cut and under a wall (7.1)
draws no number. So a run is the same
for the same seed on one backend. For one agent and step the streams differ by construction, because pcg is a
bijection. A start round's stream can equal another stream of an agent at a later step: for seeds 0 to 999, start
rounds 0 to 64 and steps below 10^6, this happens at one step in each of 134 (seed, round, stream) cases.

## 8. Flow in the tubes

Extended model only, off by default (ADR 0029). Tero, Kobayashi and Nakagaki 2007 and Tero et al. 2010 on the grid
cells in place of a graph. Code: `shaders/flow.wgsl`, `gl/glsl/flow.frag`, constants in `src/engine/flow.ts`, the
food sites in `src/engine/sites.ts`, a CPU copy of the three passes in `src/engine/flow-reference.ts`.

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

- A site is one painted **food stroke**: a dab, or every segment of one drag together (ADR 0029, decision 17). In the
  edit list a food edit goes on with the stroke of the edit just before it when that edit is food too, with the same
  radius, grid and arena, and the new edit starts exactly where that edit ends; on a periodic grid also where a copy
  of the grid shows that end (`foodStrokes()`). A drag of the brush makes such chains. The rule reads only the list, so
  a link made before it gives the same sites. A new dab exactly at the end of a drag, with the same radius, joins the
  drag; a drag splits where the view, the grid or the radius changed during it, or where it left a closed arena.
- The **cells** of a site are the cells that its segments paint with food, by the rule of the paint passes; its
  **centre** is the start of its first segment, for a dab its centre. A cell that two strokes paint belongs to the one
  whose centre is nearer, on a tie to the one earlier in the list, among all strokes of the list; so two strokes that
  touch stay two sites, and no cell is in two sites. A stroke left without a cell is no site. With more than 64
  strokes that keep a cell, 64 of them spread evenly over those take part, the first one always (`SiteCells`).
- A site is **covered** by the strain while one of its cells is open and holds food and a tube of the strain (B ≥ 0.05
  in the last step). Its **port** is the covered cell nearest its centre, on a tie the one with the lower index
  y · W + x; on a periodic grid the distance is to the nearest copy of the centre. The flux of the strain enters and
  leaves the site at its port, and the roles, the pressure limit and the zero point below read the port. Each step
  finds the ports of every site and strain before the update (`blocks` and `sites` in `flow.wgsl`). Two strains can
  cover the same site, each at a port of its own.
- The roles of the strain in each of the 4 lanes: with fewer than 2 sites that the strain covers, none. With exactly 2,
  the first gives and the other takes. With m ≥ 3, the covered sites are shuffled by a hash, ⌊m/2⌋ give, ⌊m/2⌋ take and
  an odd one rests; lane k draws again at steps where ⌊(t + 75 k) / 300⌋ changes, so every 300 steps, the lanes 75 steps
  apart. The hash is the same for every strain, so strains that cover the same sites draw the same roles.
- A site that gives adds I0 (the setting Flow strength), one that takes removes I0, scaled by a pressure limit h_c: full
  while σ (P_c − P̄) ≤ 0.75 L, then falling linearly to 0 at σ (P_c − P̄) = L, with L = 4096 · I0. c is the port of the
  site, P̄ is the mean pressure, in the lane, at the port of every site that has a role in any lane of the flow of the
  strain, and σ is +1 to give and −1 to take. Two strains that cover the same two sites carry I0 each: a site gives
  every strain that covers it the whole flux, with no share.

### 8.3 The pressure

Kirchhoff's law Σ_n Ĝ_cn (P_c − P_n) = σ_c · I0 · h_c, solved with 16 iterations per step of damped Jacobi with
momentum, in each lane, from the pressure of the last step:

- P* = (Σ_n Ĝ_cn P_n + σ_c I0 h_c) / Σ_n Ĝ_cn; while the rules of stage 4 run, the sources and the sinks of 8.7 add
  q_c to the sum above the line;
- J = P + 0.9 (P* − P);
- P_new = ω J + (1 − ω) P_old, with ω = 2 / (1 + √(1 − 0.99999²)) ≈ 1.991 on cells that conduct, and ω = 1 elsewhere.

P_old is the input of the iteration before. The zero point is the port of the first site with a role in the flow of the
strain, or the first cell of the first site of the list while none has one: the first two iterations of a step
subtract its pressure at the start of the step, the first from its result and the second from its momentum term. That
shifts the whole history and changes no difference.

### 8.4 Flux and adaptation

- Flux of a cell: Q = ½ · Σ_{n ∈ N4} H(G_c, G_n) · |P_c − P_n|, per lane, with G and P of the last step.
- f(Q) = Q^1.8 / (1 + Q^1.8) (Tero et al. 2010, γ = 1.8), averaged over the 4 lanes.
- On a tube, while at least 2 sites had a role in the flow of the strain in the last step (at their ports of that step):
  D ← max(1e-4, D + 0.003 · (f − D)), Tero's dD/dt = f(|Q|) − D at a rate of 0.003 per step. While the rules of
  stage 4 run, a tube adapts so also while the front of its strain took flux in the step before (8.7). On a tube
  without roles, and without that flux, D stays. On ground without a tube: D ← min(0.2, max(D, 1e-4) · (1 + r)). The share r follows the setting Slime
  life time (6.9; ADR 0055, decision 5): r = 0.00002875 · 144 / (the life time in hours), and r = 0.00002875 at a life
  time of 0 (`recoverShare()` in `src/engine/flow.ts`). At the default of 144 hours the factor is 1.00002875, so
  starved ground comes back to 0.2 in about 264,000 steps (ADR 0054). At 18 hours it is 1.00023, the factor of before
  (ADR 0029, decision 19).
- **A starved tube that vanishes leaves starved ground** (ADR 0054). A cell loses its tube in the step in which its
  tube body falls below 0.05. If D < 0.01 after the update of that step, D ← 1e-4. So every cell of ground that a
  starved tube left holds the same mark, the floor of the flow memory, and it is open for births again (D ≥ 0.01,
  section 9) after ln(100) / ln(1 + r) steps: 160,182 at the default. A tube that vanishes with D ≥ 0.01 keeps its D, and a D
  above 0.2 falls to 0.2 in the next step. Before ADR 0054 a starved tube kept its D when it vanished: each cell then
  held a mark of its own depth, and most of the ground opened again after some thousand steps (ADR 0053).

### 8.5 The flow and the agents

An agent follows the flow of its own strain: D and B below are those of the agent's strain (ADR 0031).

- **Starvation** (7.1): the chance 0.02 · h² / (D² + h²) per step, h = 0.01: 2 % at D = 0, 1 % at D = 0.01, 0.005 % at
  D = 0.2.
- **Respawn** (7.2): never for D ≤ 0.5, 20 % per step and dead agent at D = 1 on the cell it draws; never in the wound
  of a held cut.
- **Growth**: an agent does not divide on a cell with D < 0.01, and no child is born onto a cell with D < 0.01
  (section 9).
- The agent and growth passes of step k read D of step k − 1.
- A strain that covers fewer than 2 sites has no flux, and none of its cells adapts (8.4): its agents follow the memory
  that its cells hold. While the rules of stage 4 run, its front can take flux all the same (8.7).

### 8.6 Time scale

30 steps are one minute. The constants give: body 50 steps (1.7 min), adaptation 333 steps (11 min), a tube without flux
falls from D = 0.2 to 0.01 in 998 steps (33 min) while the flow of its strain has two sites with a role, roles 300 steps
(10 min), recovery of starved ground about 264,000 steps (6 days) from the floor to fresh ground, and about 160,000
steps (3.7 days) from the floor to the level 0.01 of the births (8.4; ADR 0054: slime of a large culture is avoided
for up to 6 days, Reid et al. 2013 as Tröger et al. 2024 cite it). These two times are those of the default Slime
life time of 144 hours. They change in proportion to the setting: fresh ground after 1.02 times the life time, and
births after 0.62 times (ADR 0055, decision 5). The time scale, 30 steps per minute, was set so that
these constants give the organism's times (ADR 0029, decision 10; Marbach et al. 2023); see [fidelity.md](fidelity.md),
row 4.

### 8.7 The flow with the rules of stage 4

ADR 0070, the rule set of ADR 0065 (decision 1) in the forms of ADR 0067 (decisions 3, 6, 8 and 9). Code: the lines
between `//#if TERRITORY` and `//#endif` in `shaders/flow.wgsl` and `shaders/agents.wgsl`, and `#if TERRITORY` in
`gl/glsl/flow.frag` and `agents.frag`; CPU reference `sinksAndSources()`, `flowUpdate()` and `drifted()` in
`src/engine/flow-reference.ts`.

While the rules of stage 4 run (6.10), the flow of each strain takes the sinks of that strain (6.11): the growth front
draws flux, and the plasm streams to it. No scene turns the rules on yet. Without them the passes have the source of
the code before, character for character.

- **What the sinks take**: while the front of strain s takes flux in the step (its state, 6.11), its sinks take
  S = 2 · I0 together. Every tube cell c of s (G_s > 0 after the update) takes S · r_c / R_s, with r_c its rate as R_s
  counted it, ⌊(|r| · 2^24 + 128) / 256⌋ / 2^16, and R_s from the state. So the sinks take exactly S, up to the rounding
  of float32 (below 10⁻⁶ of S). A cell that is no sink in the step takes the share of its rate, which falls over about
  100 steps (6.11).
- **What the sources give**: S in equal shares at the ports of the sites that s covers in the step (8.2), and while it
  covers none, S / C_s at each of its C_s tube cells (the colony pays).
- **Kirchhoff's law** of 8.3 takes both in every lane: q_c is what the sources give at c minus what its sinks take. The
  roles of the sites, their flux I0 and their pressure limit stay as they are.
- **The adaptation** of 8.4: a tube adapts also while the front of its strain took flux in the step before (its state
  of that step), as while two sites had a role. A strain without a sink and with fewer than two sites with a role keeps
  its flow memory.
- **The drift**: a sensor of an agent of strain s that is not blocked reads V − δ · (P_0 + P_1 + P_2 + P_3) / 4, with V
  of 7.3 and P_k the pressure of lane k of the flow of s at its cell, as the flow of the step before left it. δ is the
  setting `drift`, a lane per strain of the parameters, as the food weight; one value for all strains now. So the plasm
  streams down the pressure, to the sinks. The drift sets the form of the front (ADR 0065, decision 6): 0 a tree of
  tubes with small heads, 1.25 to 1.5 a tube with a crown, 5 a fan. Its default 1.5 is provisional (ADR 0070).
- **The order** (ADR 0067, decision 6): per strain the update, which reads the state of the step before; the sinks and
  the state of the step; then the pressure, which reads the rates and the state of the step.
- **Memory**: no buffer more. The uniform block of the flow holds S / I0 in a slot after that of the sinks
  (`FLOW_TAKE_SLOT`), and the parameters the drift in a slot after every slot of the code before. The second lane of
  that slot holds the growth of the budget of the paid births (9.1).

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
- **No child onto starved ground** (flow on, ADR 0053): a neighbour with D_s < 0.01, from the last step, is not free.
  The agent picks among the other free neighbours, with the same one draw, and it does not divide when every free
  neighbour is starved. So the rule of starved ground reads two cells: the cell of the parent (ADR 0029, decision 9)
  and the cell of the child. D_s is that of the strain of the parent, which is the strain of the child.
- **Only onto the territory** (rules of stage 4, 6.10): a neighbour outside the territory of the parent's strain is not
  free. The agent picks among the other free neighbours, with the same one draw.
- **The births that the flux pays** (rules of stage 4): after this rule, agents at the rim of the colony claim children
  that the flux of their strain pays (9.1).
- **Light stops growth** (extended model, ADR 0050): the birth onto the picked neighbour m fails with the chance
  G_L · λ(m), G_L the setting Light stops growth and λ the light byte / 255 of m. The agent then makes no claim in this
  step and picks no other neighbour. The draw u is the first of a stream of its own (10), and the birth fails if
  u · 255 < G_L · byte, in f32. No draw is made when G_L · byte is 0, so a run with G_L = 0 or without light keeps its
  bits. The rule reads the cell of the child, not the cell of the parent: a parent in the dark does not divide into
  the light, and a parent on lit ground still divides into the dark. The default is 1. The Jones model does not have
  the rule: it packs G_L = 0 (`packParams()`). A link without the setting runs with 0, as it was made (`sanitize()`).
- **Births**: the winners' births are matched to dead agents of the same strain by rank, in a new random order of the
  cells each step. A birth without a dead agent is dropped. The capacity limits the population.
- **The child**: a uniform random position in its cell, a uniform random heading, no deposit in its step.
- **The cut and a wall**: while growth runs, an alive agent in the wound of a held cut or under a painted wall dies in
  the agent pass (7.1; ADR 0039), and the colony grows back into the wound from its margin by this rule. Growth runs
  while it is on and Gf > 0: with Gf = 0 no child is born, so the cut and a wall place their agents (7.2).

Defaults (Jones 2011): Gf 3, Gw 9, Gmin 1, Gmax 10; Sf 3, Sw 5, Smin 0, Smax 20.

### 9.1 The births that the flux pays

ADR 0071, the rule set of ADR 0065 (decisions 1 and 7) in the form of ADR 0067 (decision 1, `paidBy=rank`). Code: the
lines between `//#if TERRITORY` and `//#endif` in `shaders/growth.wgsl` (`test`, `rank` and `win`), the pass `state`
of `shaders/sinks.wgsl`; PASS 2 with `#if TERRITORY` and PASS 5 of `gl/glsl/growth.frag`, `gl/glsl/paid.vert`, PASS 3
of `gl/glsl/sinks.frag`; `src/engine/paid.ts`; CPU reference `paidClaims()` in `src/engine/growth-reference.ts` and
`nextBudget()` in `paid.ts`.

The paid births are the third of the rules of stage 4 (6.10). They run with the other rules (`territoryOn()`), and no
scene turns them on yet. The flux that the front of a strain takes becomes plasm where it goes: it pays births at the
rim of the colony, in the share of the sink rate of each agent there.

- **The budget** of strain s is a float in its state (6.11). In every step in which the front of s takes flux (6.11),
  it grows by S / 20 = 2 · I0 / 20 births. The CPU computes this number once and gives it to the passes as float32
  (`paidIncrement()`). In a growth step with a budget of at least 1, the paid claims of the step come off it, and it
  becomes at most the number of the agents of the front of the step: min(budget − claims, agents of the front). Then
  it grows as above. A budget below 1 pays nothing and keeps what it has. Each operation rounds to float32 once, so
  both backends and the CPU give the same float. A reset sets it to 0.
- **An agent of the front** of strain s in a growth step is an alive agent of s that is no parent of Jones' rule in
  this step (section 9), whose cell has a sink rate r of s that is not 0 and a flow memory D_s ≥ 0.01, and that lies
  at the rim of the colony: one of its 8 neighbours is open, empty after the moves, and holds no tube body of s
  (B_s < 0.05). The rate, the memory and the body are those of the step before; a sink of that step holds its rate
  with a minus sign (6.11). The test counts the agents of the front of each strain.
- **The key**: an agent of the front with a free neighbour, free as for Jones' rule (open, empty after the moves, not
  starved, in the territory of s, and no diagonal one between two walls), draws u, the first draw of a stream of its
  own (12, 7.7), and gets the key −ln(1 − u) / |r|. Every other agent has no key, which the passes write as the
  largest float32. The passes compute −ln(1 − u) up to u = 1/2 as the series of 2 · atanh(u / (2 − u)) and above it
  as −log(1 − u): so the key is right to a few units in the last place also for a small u, where `log` near 1 may err
  by 2^-21 (WGSL and GLSL).
- **The rank**: the ⌊budget⌋ agents of s with the least keys claim a child; of two agents with the same key the one
  with the smaller id comes first. This is the weighted order of Efraimidis and Spirakis: an agent comes early with odds
  in its sink rate. A GPU lets each agent with a key count the agents of its strain with a smaller key, and stop when
  the count reaches ⌊budget⌋. The ⌊budget⌋ agents with the least keys read every key of their strain.
- **The claim**: an agent below ⌊budget⌋ picks a free neighbour with the draw of Jones' rule (stream 4): among the
  free neighbours without a tube body of s if there is one, so that the child goes out, and else among all of them.
  Light stops the birth as it stops one of Jones' rule (section 9): the agent then makes no claim. It claims the cell
  with its claim key as a parent of Jones' rule does, so the claims of both rules compete for a cell, and the winners
  are born as in section 9. The claims count into the paid claims of the strain, also those that lose their cell.
- **A claim key of 0**: on WebGPU the claim key of one id in 2^32 is 0 in a step. A claim with it cannot be told from
  no claim, so that agent gets no key. On WebGL2 no claim key is 0.
- **The state** of s after the step holds the budget, the agents of the front and the paid claims of the step in its
  last three lanes (6.11); in a step without the growth test the last two are 0.
- **Memory**: 4 B per agent for the keys (`PAID_BYTES_PER_AGENT`): on WebGPU after the state of 4 strains and the
  counts in the buffer of the state of the sinks, by id; on WebGL2 a target of the agents (`R32F`), and the counts a
  target of 2 × 1 texels.

## 10. Start layouts

`shaders/init.wgsl`, `gl/glsl/init.frag`. Every agent draws a heading. The layouts: mixed (uniform; with one agent per
cell a random permutation of the cells), bands (the strains side by side), sectors, colonies (one disc per strain),
ring, center, line (below), empty (every agent dead) and food (every agent dead; for each strain one inoculate step places about 50
agents of the strain on a food of its own, a disc of about 100 cells at half the density of a full sheet: strain A at
the start of the first food stroke of the list (a dab or a whole drag, 8.2), strain B on the second, and so on, and a
strain without such a food starts without agents; ADR 0025, ADR 0032; a start spot takes the place of a food,
below). With one agent per cell,
claim rounds give each alive agent its own cell: 1 round for the mixed layout on a periodic grid or a box, without walls; else 64
(`startRounds()` in `src/engine/pack.ts`); a loser
of the last round starts dead. Without the rule an agent draws again up to 32 times while its cell is not open. With a
capacity above Agents per cell, only the first agents of each strain start alive.

Line (ADR 0047; Tsuda, Jones et al. 2011, p. 11): a vertical strip around the middle column of the grid, 0.75 · H
cells high, and ⌈N / (0.75 · 0.75 · H)⌉ cells wide for the N agents that the buffer holds, at least 1 cell and at most
W. Every draw of an agent is uniform in the strip, so with one agent per cell about 0.75 of its cells hold an agent.

Start spot (ADR 0066; Reid et al. 2012 set a plasmodium on agar without food): a shape of the kind `start` of a scene.
With the layout food, strain k starts at the k-th start spot of the list, in the same disc and with the same step as on
a food, and a strain without a start spot starts on its food as above. A start spot is an edit of the list
(`EnvKind.start`, 7) that paints nothing: no byte of `env`, no outline, no stamp and no amount of slime. The engine
gives a simulation no stroke of one, and both backends would leave one out (`paintsEnv()` and `changesSlime()` in
`src/engine/types.ts`). The sweep keeps it under an erase and a wall: nothing on the grid shows it, so no stroke
clears it. Clear removes it with the rest of the list, and a reset then starts no colony there. A link holds it as it
holds every shape of its scene, by the bit of the shape; no link holds one as a stroke. Its radius is not read. The
scenes Y-maze with slime and Slime everywhere start their colony so: on the middle of the base of the Y-maze, and 1 cm
inside the rim of the dish, opposite the glucose.

While the rules of stage 4 run, the start layout food gives each strain its start territory just before the step
that places its colony (6.10).

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
| `meanWindow`        | w        | cells a side, 3 to 15, odd                                           | 3                 | jones    | 6.1     |
| `foodStrength`      | wProj    | 0 to 0.5                                                             | 0.05              | both     | 6.4     |
| `lightStrength`     | wLight   | 0 to 0.5; Jones: the strength of the repellent                       | 0.05              | both     | 6.4     |
| `electrodeStrength` | wElec    | 0 to 1; 1 is the ±255 of Tsuda, Jones et al. 2011                    | 1                 | both     | 6.4     |
| `lightGrowth`       | G_L      | 0 to 1; 0 is off                                                     | 1                 | extended | 9       |
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
| `drift`             | δ        | weight of the pressure in a sensor, 0 to 5 (the rules of stage 4)    | 1.5               | extended | 8.7     |
| `slimeLife`         | L        | hours of model time, 0 to 240; 0 is no slime                         | 144               | extended | 6.9     |
| `model`             |          | jones, extended                                                      | extended          |          | 2       |
| `stepOrder`         |          | move-first, sense-first                                              | sense-first       | both     | 5       |
| `boundary`          |          | wrap, box, dish                                                      | wrap              | both     | 1, 6.3  |
| `collisions`        |          | one agent per cell, on or off                                        | off               | both     | 7.6     |
| `coveredFood`       |          | on or off                                                            | off               | both     | 6.5     |
| `growth`            |          | on or off (needs one agent per cell)                                 | off               | both     | 9       |
| `flow`              |          | on or off                                                            | off               | extended | 8       |
| `territory`         |          | the rules of stage 4, on or off (they need growth and the flow)      | off               | extended | 6.10    |
| `layout`            |          | section 10                                                           | mixed             | both     | 10      |
| `seed`              |          | integer                                                              | 1                 | both     | 7.7     |
| `resolution`        | W or H   | cells on the long side of a grid shaped like the screen, 256 to 4096 | 1536              | both     | 1       |
| `lattice`           | W × H    | a grid of fixed size in place of `resolution` (ADR 0026)             | none              | both     | 1, 3    |

"Model: both" means the parameter acts in both models with every value of its range. The Jones model requires one
strain, one agent per cell, one diffusion pass and the own weight ±1 (`jonesFits()`), and binds the food weight and the
light weight to the own weight, the scent decay to the strain's decay, the share to 1, and K and the flow to off
(`asJones()`). "Model: jones" means only the Jones model has the parameter: the extended model binds it to its default
(`asExtended()`). A Jones link made before ADR 0044 that holds drawn light opens with `lightStrength` 0: until then drawn
light had no effect in the Jones model (`sanitize()`, the mark `rules` of a link). The Jones model has no slime: it binds
the Slime life time to its default, and its passes get a life time of 0 (`slimeSteps()` in `src/engine/slime.ts`).

`speed`, `exposure`, `bloom`, `style`, `gelColor`, `showScent`, `showTubes`, `showSlime` and `showFront` change only
the view and the playback, not the model. `showTubes` draws the picture of the tubes from the trail and the flow memory of each strain,
and grains that move with the flux of each strain; its rule is in [design.md](design.md), section 5, and in ADR 0034.
`showSlime` draws the slime field as a wet film on the ground; its rule is in the same section, and in ADR 0057.
`showFront` draws a skirt around young ground while growth is on, from the front stamps of section
6.9; its rule is in the same section of design.md, and in ADR 0060.

## 12. The two backends

WebGPU (`*.wgsl`) and WebGL2 (`*.frag`, `*.glsl`) compute the same rules. The GPU tests run every rule on both. They
differ in these points:

- The keys of a claim and of a start round are different hash functions (32 bits on WebGPU, 24 bits on WebGL2). So
  runs with one agent per cell differ between the backends wherever claims conflict.
- The id is a bit field on WebGPU and the texel index on WebGL2. The rules read the same id.
- WebGL2 without float blending has no rule of one agent per cell, so neither the Jones model nor growth: there the
  backends differ in a rule.
- The light byte of a stroke may differ by ±1, a difference in a source.
- The territory (6.10) lies in textures of 4 cells per texel on WebGPU and in targets of one byte per cell on WebGL2,
  and the owners in a buffer that atomics fill and in a target that one point per agent fills. The push draws by the
  index of the cell, which both backends share: from the same territory and the same owners both push alike.
- The sinks (6.11) follow the paths in rows of bits over the 13 × 13 cells around a cell on both backends. WebGPU sums
  the cells of a workgroup of 8 × 8 and adds its sums with atomics; an addition that wraps the low word of R adds 1
  to the high one. WebGL2 sums them in a pyramid of `RGBA32UI` targets per strain over squares of 4 × 4, with the lanes
  R low, R high, C and N; its levels add the carries in the second lane, and the sign of a rate counts N. Both give
  the same integers, and from the same inputs the same rates and the same state as the CPU.
- The flow with the rules of stage 4 (8.7): WebGPU binds the rates and the state of the sinks as storage buffers to the
  update and the pressure, and reads the state in place, so the update of a strain still finds the state of the step
  before. WebGL2 samples the current copy of the state in the update, and the copies of the rates and of the state
  that the step writes in the pressure. The agent pass of WebGPU reads every layer of the pressure in one texture; that
  of WebGL2 samples 16 textures with the 4 pressures, the least that a device has. What the sinks take is a float32 on
  both backends, compared with the CPU to a tolerance, as the flow is.
- The paid births (9.1): WebGPU writes the keys by id after the state of 4 strains and the counts, and counts the
  agents of the front and the paid claims with atomics; its pass `rank` reads the keys in blocks of 16, and `win`
  finds a paid parent by its claim key in a neighbour. WebGL2 writes the keys into a second target of its test of growth, marks the agents of the front and the
  paid parents in their bits (`FRONT`, `PAID` with `GROWS`), so that the points of growth claim and give birth for a
  paid parent as for a parent of Jones' rule, and counts them with points into a target of 2 × 1 texels. A key is a
  float of `log` and a division, so a key of a GPU differs from that of the CPU by a few units in the last place: the
  tests compare the keys to 10⁻⁵ and the rank of the keys of the GPU exactly.

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
| The mean window above 3 × 3 (6.1)       | "the mean window (ADR 0046)": windows 3, 5, 15 in wrap, box and dish with walls; `diffuse-reference.test.ts`                    |
| Mass balance (6.2)                      | "balance mass with deposits"                                                                                                    |
| Edges and walls in each model (6.3)     | "diffuse trail, food and light at the edges and walls as the CPU reference does"                                                |
| Jones' one map (6.4)                    | "keep trail + scent − repellent equal to Jones' one trail map"                                                                  |
| A repellent in the Jones model (6.4)    | "run a repellent in the Jones model as the extended model …"; "move the agents of the Jones model off a repellent source"       |
| Electrodes (6.2, 6.4, 6.7, 10)          | "the electrode tool (ADR 0047)": the bytes, both lanes against the CPU reference, Tsuda's field, covered food, the line         |
| Scent plateau and g (6.4)               | the plateau tests in each order; the scent against a CPU reference                                                              |
| Covered food (6.5)                      | the covered food tests, also WebGL2 without float blending                                                                      |
| Cut in the fields (6.6)                 | the cut clears the chemicals in the extended model only                                                                         |
| K (6.8)                                 | turns with saturation against a CPU reference                                                                                   |
| The slime field (6.9)                   | `slime.gpu.test.ts`: the stamps against the CPU copy; the life time; a reset; the Jones model; `slime-reference.test.ts`        |
| The Slime tool (6.9)                    | `slime.gpu.test.ts`, "the brush": against the CPU copy; erase, wall and Clear; `engine-env.test.ts`: the repaint, the link      |
| The amount of slime (6.9)               | `slime.gpu.test.ts`, "the amount of slime": against the CPU copy, step by step; the brush; a reset                              |
| The film of the slime (design.md, 5)    | `slime.gpu.test.ts`, "the picture": against the CPU copy; no pixel changes with the film off; no byte of the simulation         |
| The look of the electrodes (design.md)  | `electrode.gpu.test.ts`: the picture against the CPU copy; "of the electrode tool": the bytes of the outlines against it        |
| One agent per cell (7.6)                | at most one agent per cell, none lost; determinism                                                                              |
| Tools (7.2)                             | inoculate onto free cells; dead agents only; cut to free cells                                                                  |
| An agent under a wall (7.2, 7.5)        | "agents under a painted wall": each one off the wall at its first open point, with its heading; outside a held cut; beside it   |
| The cut and a wall with growth (7.1)    | "the cut and a painted wall while growth runs": the agents die, none lands in a closed room; placed with Gf 0 or growth off     |
| Respawn and the cut (7.2)               | `flow.gpu.test.ts`, "respawn while the cut is held": no birth in the wound, with and without growth; outside it as before       |
| Growth (9)                              | growth against the CPU copy in each arena; no child between two walls at a corner; intervals; one agent per cell                |
| The territory (6.10, 7.2, 7.6, 9)       | `territory.gpu.test.ts`: moves, respawn and births only onto it, two strains; the owners and the push in each arena; the start  |
| The corner of the push (6.10)           | `territory.gpu.test.ts`: no cell across a thin diagonal wall in 40 steps, both strains; `territory.test.ts`: the CPU copy       |
| The sinks (6.11)                        | `sinks.gpu.test.ts`: rates, sums and state against the CPU copy in each arena with thin walls, the X of walls, births, a carry  |
| The flow with the sinks (8.7)           | `flow-sinks.gpu.test.ts`: memory and pressure against the CPU copy, 2 strains in a dish with walls; a large R; the drift        |
| The paid births (9.1)                   | `paid.gpu.test.ts`: keys, rank, births, budget against the CPU copy, 2 strains, light; ties; budgets above the front, below 1   |
| The start territory (6.10, 10)          | `territory.gpu.test.ts`: the disc in each arena, with walls; `engine-env.test.ts`: the disc of each strain, the restart         |
| No child onto starved ground (9)        | `flow.gpu.test.ts`: a growth step against the CPU copy with the memory of two strains, box and wrap; `growth-reference.test.ts` |
| The mark of starved ground (8.4)        | `flow.gpu.test.ts`: a starved tube that vanishes leaves the floor, a fed one keeps its memory; ground recovers by the factor    |
| The time of the mark (8.4)              | `flow.gpu.test.ts`: eight times the share at a Slime life time of 18 hours; `flow.test.ts`: the share of each life time         |
| Flow (8)                                | `flow.gpu.test.ts`: both passes against the CPU copy, Kirchhoff, the dead end, the pressure limit, starvation and respawn rates |
| Food sites (8.2)                        | `sites.test.ts`: strokes and cells; `flow.gpu.test.ts`: a drag is one site, ports, two strains, touching dabs, an old link      |
| The unit of the trail (8.1)             | `flow.test.ts`: κ, and the levels at Jones' decay; `flow.gpu.test.ts`: a tube on a weak trail that decays fast                  |
| A colony for each strain (10)           | `engine.gpu.test.ts`: three strains in the Foraging maze start two colonies on the two foods                                    |
| A flow per strain (7.1, 7.2, 8, 9)      | `flow.gpu.test.ts`: no flux between two strains; starvation, respawn and growth by the memory of the own strain                 |
| Scale grows with SO                     | the network scale test (Jones 2010, Fig. 10)                                                                                    |

`flow-sinks.gpu.test.ts` tests the flow with the rules of stage 4 (ADR 0070) on both backends: 5 steps of the memory
and the pressure of two strains in a dish with walls against the CPU copy, one with a covered port and one whose tube
cells pay, with a tube that adapts only from the step after the first step with flux; a strain without a sink and with
one site keeps its flow memory; the sinks take S with the rates as R counted them, where their own rates would take
more than twice S; a large R, whose low word wraps; and the turns of 256 agents of both strains down the mean pressure,
with the drift 1.5 and 0. `flow-reference.test.ts` tests that the CPU copy lets the sinks take what the sources give, to
10⁻⁶ of S, also when R is large.

`paid.gpu.test.ts` tests the births that the flux pays (ADR 0071) on both backends, each case one growth step from the
moves of a twin without growth: two colonies of two strains with a tube body under their cores, starved cells, a thin
wall and light, where the keys agree with the CPU copy to 10⁻⁵ and the agents, the budget, the agents of the front and
the paid claims exactly, then a step without the growth test and one without a sink rate; two agents with the same
key, of which the one with the smaller id is paid, with a budget above the agents of the front for the other strain;
a budget below 1, which pays nothing and stays without an agent of the front; and on WebGPU an agent whose claim key
is 0. `paid.test.ts` tests the constants, the key and its odds (Efraimidis and Spirakis), the series of the key in
float32, the budget, and the CPU copy on cases made by hand.

`flow.gpu.test.ts` also tests the flow of each strain (ADR 0031) on both backends: each strain its whole I0 on its own
route between the same foods; the CPU copy for the strains s = 1 to 3 (the second of two, the third and the fourth of
four); a change of the number of strains during a run. For the food sites (ADR 0029, decision 17) it tests on both
backends: a dragged line, held in a link of before, is one site with its port at the covered cell nearest its start; a
strain covers a site from any of its cells, and its port moves to the covered cell nearest the centre; two strains on
the same strokes each carry I0 through cells of their own; two dabs that touch stay two sites; the CPU copy while a port
moves, with food under a wall and at the edge of a tube; a large site in lanes before and after its port, also with two
strains; a change of the sites during a run, also when the list gets shorter; 64 sites of 65 strokes; an erased cell
holds no port. `engine-env.test.ts` holds the engine to the rule: a drag of the brush is one site, a link gives the
sites of its list, and the start layout Food puts each strain on a stroke of its own.

Not tested: the random turn pCD (no test uses pCD > 0) and the rate of random shrinkage. The value of the blocked
heading is checked only beside a wall ("leaves an agent beside the wall to its move").

## 14. Open points in the code

This one is open, not a rule. It was found while this file was written:

- A start round's stream of random numbers can equal another stream at a later step (7.7).

Closed on 2026-11-14: a site was the one cell at the start of a food stroke (8.2). So a strain covered a food dot only
at its centre, and where strains shared a food dot only the strains whose tube held that cell had it as a site (ADR
0031). And a dragged line of food gave a site for every segment of the drag, each with the whole flux. A site is a
stroke with all its cells now, and its port is the covered cell nearest its centre (ADR 0029, decision 17).

Closed on 2026-11-13: respawn (7.2) brought a dead agent of any strain to life, so with the flow a strain appeared that
nobody had inoculated (found by the owner). Every strain has a flow of its own now (ADR 0031). And the flow did
nothing for a strain whose trail stayed below 0.2 deposits, as in the start scene Three strains with one agent per
cell. The levels follow the decay of the strain now (8.1, ADR 0032). A child of the growth rule could land between two
wall cells that touch at a corner, where no move can go (9); it no longer can (ADR 0025, decision 35).

Closed on 2026-11-15: an agent under a wall that was painted onto it was not moved off the wall. It could step out of
it, and deep in a thick wall it stayed there for good, alive, with every move blocked and no deposit. Such an agent is
placed off the wall now, as the cut places its agents (7.2, ADR 0038). And the cut and that rule placed their agents
at random open points of the whole grid also while growth ran. On the Tokyo map these points lay also in the sea
beyond the coast and on starved land, and growth made colonies of them there (ADR 0029, amendment 2026-11-15 (2)).
While growth runs, both kill these agents now, and the colony grows back from the margin of the wound (7.1, 9;
ADR 0039). And respawn drew its point anywhere on the grid, so a dead agent could come to life in the wound of a held
cut. A point in the wound is no respawn point now (7.2, ADR 0041).
