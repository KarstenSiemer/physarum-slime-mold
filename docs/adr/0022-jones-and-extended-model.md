# 0022: Jones and extended model

- Status: accepted (owner decisions, 2026-11-11: a model switch "Jones" and "Erweitert"; "Jones streng": the Jones model
  holds only Jones' published rules; the default changes are open)
- Date: 2026-11-11

## Context

The owner saw that agents barely react to food, even to food close beside a swarm. Measured on `main` (`d245ea3`,
WebGPU, M3 Pro):

- **Short reach.** The scent of food diffuses and decays like the trail (ADR 0007): a 3 × 3 mean and the scent decay
  once per step, and a source of 255 · Food strength per food cell and step. At Scent decay 0.1 the steady scent of a
  dab of the food brush (18 px, 18.3 cells on the 1536 grid of the default settings) is 115 on the dab, 62 at its edge,
  3.7 five cells out and 0.36 nine cells out: it falls to 1/e within 2.0 cells of the edge.
- **A lower decay makes food much stronger.** The steady scent of a food much larger than its spread settles where the
  decay removes what the source adds: s = (1 − d) · (s + source), so s = source · (1 − d) / d. At decay 0.001 that is
  111 times the value at 0.1; on a UI dab 28 to 44 times. The food then pulls in more and more of the network. The help
  text of Scent decay said so.
- **Stacked agents do not see food.** Without the rule of one agent per cell (the default settings, 1 agent per cell)
  agents stack in filaments. The trail at an agent is 1,000 to 7,000 (median 3,422), the median difference between the
  left and the right sensor 1,456, and food adds at most 115. The strongest of three sensors does not turn toward food.
- **Jones' later papers** lower the food source while agents cover it, in two forms (both papers read on
  2026-11-11):
  - Adamatzky and Jones 2010 (Road planning with slime mould, International Journal of Bifurcation and Chaos 20(10),
    doi 10.1142/S0218127410027568, arXiv:0912.3967): food is an area of pixels. Each pixel of the area has its
    projection multiplied by 0.001 if a particle lies in the 3 × 3 neighbourhood around the pixel.
  - Jones and Adamatzky 2014 (Computation of the travelling salesman problem by a shrinking blob, Natural Computing
    13: 1–16, arXiv:1303.4969, Sec. 7.2): food is a node, a point that projects into a 3 × 3 window. It projects 1.275
    units per step, and 0.01275 (1 %) while the 3 × 3 window around the node holds more than 0 agents, "to ensure a
    uniform concentration within the blob".
- The real organism senses food over millimetres to centimetres.
- **The first version of this branch put every scene on "Jones"** and left in both models what the scenes used:
  several strains, light, the separate scent and the sensor check of ADR 0020. The owner then decided that a run
  labelled Jones must hold only Jones' rules (below).

## Options

1. **One switch per paper or rule.** Many switches, and every scene of Jones would need the right set of them.
2. **Change the scent for everyone.** Jones' scenes would no longer run as in his papers.
3. **A model switch** with two values. Jones' published rules belong to "Jones", this app's additions to "Extended". A
   rule of Jones that a scene does not use is an option with Jones' values, off by default.

For the scope of "Jones" (decision 2), two options:

- **A. Jones holds what the scenes use** (the first version of this branch): several strains, light, the scent of its
  own and the sensor check stay in both models, so every scene could run on Jones.
- **B. Jones holds only Jones' published rules**: everything else runs only in Extended, and every scene that uses it
  moves there. At the values of its scene the extended model gives the bytes of the code before, so no scene changes.

## What is Jones and what is not

Read in Jones 2010 (J. Jones, Characteristics of pattern formation and evolution in approximations of Physarum
transport networks, Artificial Life 16(2): 127–153) and in the later papers that ADR 0024 lists. Page numbers are those
of Jones 2010 unless the line names another paper.

**Jones' rules: the Jones model** (`jonesFits()` and `asJones()` in `src/model/params.ts`, `packParams()` in
`src/engine/pack.ts`):

- One population of one kind of agent (p. 132–133). It follows its own trail, or it flees it: "the agent orients itself
  away from the source" (chemorepulsion, Sec. 3.5, p. 142–143). Here: one strain with a weight of +1 or −1 on its own
  trail.
- Three forward sensors at SO, the side ones at ±SA; the turn by RA (Fig. 3, p. 133); a random turn with pCD (Table 1,
  p. 134); a step of SS; a deposit of depT after a successful move only (p. 133).
- One agent per cell (p. 132: "Each grid cell can contain only a single agent"). A blocked agent stays, deposits
  nothing and takes a random heading (p. 133).
- Positions are floats rounded to their cell (p. 132), so a sensor reads the cell its point falls in.
- One 3 × 3 mean per step with the decay decayT (p. 132, Table 1: diffK 3).
- Food goes into the trail map: stimulus pixels "were projected to the chemoattractant layer", with the weight wProj,
  and they "are subject to the same diffusion process" (p. 144). So the food scent decays with decayT, and the agent
  weighs it as its trail.
- The habitable area and obstacles of the data map (p. 131, Table 1); a periodic boundary (Table 1) or a closed arena
  such as his dish. Agents start at random unoccupied habitable cells (p. 132), or at start points of the data map
  (Table 1): the start layouts.
- Shrinkage: each agent dies with a fixed chance per step (Fig. 21, p. 147, 0.00025).
- The wound: the agents in it go to random places outside it (p. 148). The trail stays.
- Later papers: covered food (Adamatzky and Jones 2010, arXiv:0912.3967, p. 6; Jones and Adamatzky 2014,
  arXiv:1303.4969, Sec. 7.2), built here. Growth and shrinkage windows (Jones 2011; Adamatzky and Jones 2010; Jones and
  Adamatzky 2014; Jones 2015; Jones, Mayne and Adamatzky 2017), built on 2026-11-11 (ADR 0025): in both models, off in
  every scene. The turn toward the larger side when the front sensor reads least (2014 to 2017), 5 × 5 and 7 × 7 means
  (2010 road paper, 2017), light that dampens each sensor (2017, ADR 0024, decision 7) and the coverage-gated
  repellent of obstacles (Jones 2015): Jones' rules, not built yet. They come into the Jones model with Jones' values,
  and with the 2010 behaviour as their default (ADR 0024).

**This app's readings where Jones leaves a choice** (in both models):

- A sensor whose cell is a wall or lies outside a closed arena reads `BLOCKED` (ADR 0007): Jones does not say what it
  reads.
- A move checks the cells on its way for walls (ADR 0019): the habitable area for steps that cross more than one cell.
- The agents update in parallel, with claims for the rule of one agent per cell (ADR 0008); Jones picks them in random
  order (p. 133).
- The cut tool takes the agents out while it is held, with a round brush; Jones cut a square and kept agents out until
  all were placed (p. 148).

**Not Jones: the extended model only**:

- Several strains and the table of how each weighs the trails of the others (Fogleman 2020; Jenson 2019), and the
  population share of each strain.
- Light that releases a repellent scent (this app; ADR 0007). Jones' light (2017) dampens what a sensor reads; Jones
  2015 lets obstacles release a repellent only while no agent covers them, and a permanent repellent failed there.
- A scent decay of its own and a food weight or light weight per strain, which decouple the scent from the trail
  (ADR 0007).
- Agents that share a cell: no rule of one agent per cell (Jenson, Fogleman).
- No diffusion, or more than one 3 × 3 mean per step (Fogleman uses 2): not Jones' 5 × 5 or 7 × 7 mean.
- Sensors that walls block on the way (ADR 0020): the owner's rule for the Maze, not Jones'.
- A cut that also clears the trail and the scent of the wound (this app).
- The normalised emission and trail saturation (decisions 4 to 9).

**The separate scent field is Jones' one map.** For one strain the GPU keeps the trail and the food scent in two fields.
Both take their sources in the first pass, the same means over the same habitable cells, and the same factor
`1 − decayT`: the operations are linear, so trail + scent is Jones' map exactly, and the sensor reads
`w · trail + w · scent = w · map` with the strain's own weight w. In float32 the two sums round apart: a GPU test
(`sim.gpu.test.ts`, "keep trail + scent equal to Jones' one trail map") steps a float64 CPU reference of the one map
with the deposits of the GPU's agents, 40 steps in a box with a wall, on a periodic grid with chemorepulsion and in a
dish, and finds trail + scent within 1e-5 of it on both backends. So the implementation stays (decision 3).

## Decisions

Each decision with its date, who made it, and why.

1. **A model switch "Jones" and "Extended"** (owner, 2026-11-11; the owner calls the second "Erweitert", the app is in
   English). `Settings.model` is `'jones'` or `'extended'` (`MODELS` in `src/model/params.ts`). Reason: the scenes of
   Jones must behave exactly as in his papers. Jones' published rules (the 2010 model, and later rules such as growth
   and shrinkage of 2011 and covered food) go together into one model rather than one switch per paper, and what is not
   Jones' goes into a model of its own. Growth and shrinkage belong to "Jones" when they come, flow reinforcement to
   "Extended".
2. **The Jones model holds only Jones' published rules** (owner, 2026-11-11, "Jones streng", option B). Everything this
   app added runs only in the extended model, which is Jones' rules and this app's additions. The list above is the
   line. This replaces the first version's decisions that every scene and the default settings run on Jones and that
   several strains, light, the separate scent and the sensor check stay in both models (option A). Reason: a run
   labelled Jones must be Jones.
3. **The Jones model binds what Jones has no setting for** (this branch, 2026-11-11). `constrain()` gives it the
   strain's decay as the scent decay and the strain's own weight as its food weight, and sets trail saturation 0, the
   light strength and the light weight to their defaults. `packParams()` packs Jones' map whatever the settings hold:
   that scent decay and food weight, no light source, a light weight of 0, K 0, and a cut that keeps the chemicals
   (`tool2.z`, `diffuse.wgsl`). Reason: the panel, the link and the GPU must all hold Jones' values, and a value Jones
   does not have must not reach his run by another way. The separate scent field stays: it is Jones' map (above).
4. **Settings that Jones has only one value for make a Jones model Extended** (this branch, 2026-11-11):
   `jonesFits()` asks for one strain with weight +1 or −1 on its own trail, the rule of one agent per cell and one
   diffusion pass. `constrain()` turns a Jones model without them into the extended model, for links and changes alike.
   Reason: these values change the run, so dropping them would run another scene than the one that was made.
5. **Links** (this branch, 2026-11-11; for links without `model` replaced by decision 24). `constrain()` applies
   decisions 3 and 4 to every link, so a Jones link with K, light or a scent decay of its own holds Jones' values, and
   one with several strains or without the rule opens with Extended. The first version read a link without `model` as
   Jones' and then constrained it; the review found that this opened old links of the Maze and of Fleeing light as
   Jones (decision 24). K is rounded to its whole steps: a link with K 1e-300
   passed the clamp, picked the saturating passes and packed as 0 in float32, so t / (1 + t / 0) gave NaN in every lane
   with t = 0 and no agent turned, while the panel showed K 0. `trailSaturation()` also treats a K below 1 as off.
6. **The panel offers only Jones' settings in the Jones model** (this branch, 2026-11-11): one strain without Add strain,
   share, food weight or light weight; the rule checked and locked; no Diffusion passes, Light strength, Scent decay or
   Trail saturation; no Light tool. Covered food and its factor, Food strength and Shrinkage stay. The choice "Model"
   sits in the Scene section. In the extended model its own settings Scent decay and Trail saturation show directly
   below the choice, so a switch to it shows what it adds; Light strength and Diffusion passes show in Environment. The
   scene card shows "Only Jones' rules" or "Jones plus this app's rules". Reason: what the user can set is what the
   model has.
7. **A switch to Jones keeps strain A** (this branch, 2026-11-11): `toJones()` keeps strain A with weight ±1 on its own
   trail, switches the rule on, sets one diffusion pass and binds the rest (decision 3). A notice says what went. A
   switch to Extended changes no value. Reason: a switch must not leave a Jones label on a run that is not Jones', and
   the user sees what changed. After Extended, K 30 and back to Jones the scene is the scene again, and the link holds
   no K: the review found the card "changed" and `trailSaturation: 30` in the link of a plain Jones run. The notice
   names every value that went (decision 28).
8. **Light in the Jones model** (this branch, 2026-11-11): no Light tool, and painted light stays painted but has no
   effect (source and weight 0). Reason: no paper of Jones has light that releases a repellent (list above). Light that
   a scene or the user painted in Extended acts again when the user switches back, with the default Light strength
   and Light avoidance: the Jones model sets them to their defaults (decision 3), and the notice of the switch says so
   (decision 28). The panel says that drawn light has no effect (decision 29).
9. **Walls in the Jones model** (this branch, 2026-11-11): the sensors read their own cell only; moves still check the
   cells on their way. Reason: ADR 0020 was the owner's decision for the Maze, which is not Jones' scene; Jones does not
   say what a sensor behind a wall reads. No scene of Jones has walls, so none changes.
10. **Every scene by its source** (this branch, 2026-11-11, from decision 2):

    | Scene                | Source                                   | Model    | Why                                        |
    | -------------------- | ---------------------------------------- | -------- | ------------------------------------------ |
    | Three strains        | this app (start scene)                   | Extended | three strains, no rule, 2 diffusion passes |
    | Two strains          | this app                                 | Extended | two strains, no rule                       |
    | Transport network    | Jones 2010, Fig. 4                       | Jones    |                                            |
    | Minimizing network   | Jones 2010, Fig. 5                       | Jones    |                                            |
    | Turing spots         | Jones 2010, Fig. 16                      | Jones    | chemorepulsion: weight −1                  |
    | Turing stripes       | Jones 2010, Fig. 16                      | Jones    | chemorepulsion: weight −1                  |
    | Shortest path        | Jones 2010, Fig. 18                      | Jones    |                                            |
    | Steiner tree         | Jones 2010, Fig. 19                      | Jones    |                                            |
    | Shrinking plasmodium | Jones 2010, Fig. 21                      | Jones    | food positions are this app's choice       |
    | Wound healing        | Jones 2010, Fig. 22                      | Jones    | the cut tool, see below                    |
    | Fleeing light        | this app                                 | Extended | light that releases a repellent            |
    | Maze                 | Nakagaki et al. 2000, values of this app | Extended | sensors that walls block (ADR 0020)        |
    | Cyclones             | Fogleman 2020                            | Extended | several strains, no rule                   |
    | Dunes                | Fogleman 2020                            | Extended | several strains, no rule                   |
    | Dot grid             | Fogleman 2020                            | Extended | several strains, no rule                   |
    | Default settings     | this app                                 | Extended | no rule, 1 agent per cell                  |

    The scenes of Jones held one value that is not his: the repelling scenes weighed food with +1 against −1 on their
    own trail. They paint no food, so their food weight is now −1 (`jones()` in `src/model/presets.ts`) with the same
    bytes. Wound healing asks the user to cut: in the Jones model the cut now keeps the trail, as Jones' did (decision
    3), and its text says so. The default settings move to Extended without a new value: the owner's question whether
    they get K or another scent decay stays open (TODO.md).

11. **Backends without the rule run Jones' scenes on Extended** (this branch, 2026-11-11). `setScene()` and
    `ruleUnavailable()` give the scene and the scene's base the extended model with the rule off, so the card shows no
    change, and the notice says so. Reason: the Jones model always has the rule.
12. **Normalised emission is extended only** (owner, 2026-11-11). In the extended model food and light release
    255 · strength · g(d) per cell and step, with g(d) = (d / (1 − d)) / (0.1 / 0.9) (`emissionScale()`), d the scent
    decay. Reason: Jones projects food at a fixed strength into a map with the trail's decay; a source that depends on
    the decay is not his rule.
13. **g normalises the plateau of a large food, at decay 0.1** (owner brief, 2026-11-11). With g the plateau
    255 · strength · g(d) · (1 − d) / d is 255 · strength · 9 at every decay. Reason: a lower decay should spread the
    scent, not make it stronger, and every scene and the default settings use 0.1, so at 0.1 the extended model gives the
    bytes of the Jones model. g(0.1) is exactly 1: the same float divided by itself.
14. **Light gets the same g** (owner brief, 2026-11-11). Reason: the light repellent lives in the same scent field with
    the same decay (ADR 0007); without g, a lower decay would make light 111 times as strong.
15. **Trail saturation is extended only** (owner, 2026-11-11). Each sensor reads the trail t of each strain as
    t / (1 + t / K) before it weighs the trails (`sense()` in `agents.wgsl`, `agents.frag`). Reason: no paper of Jones
    saturates the trail.
16. **K is one value for all strains, 0 to 1,000 in steps of 1, 0 off** (this branch, 2026-11-11). Reason: one number is
    enough to measure what it does, and the owner decides whether it stays. The range reaches from below the trail of
    the start scene (median 42 to 82 at an agent) to a tenth of the trail of the default settings (median 3,700 at step
    2,000 and 10,700 at step 10,000, K 0). The slider is linear, because a log slider cannot reach 0.
17. **K draws straight paths along the grid axes out of food, and stays as it is** (this branch, 2026-11-11). The review
    saw them at K 30. A study with 10 seeds (default settings, extended, decay 0.003, 4 UI dabs, WebGPU; WebGL2 gave the
    same bytes) measured the rank of the cross of rays at 0°, 90°, 180° and 270° among 90 crosses by the trail on them
    out to 80 cells (0.5: no preference): 0.86 at K 30, 0.57 at K 0 and 0.48 without food. Diagonals are not preferred.
    Cause: Jones' sensors read the cell their point falls in (p. 132). For a heading within about 2° of an axis, the
    front and both side sensors (9 cells ahead, and 8.3 ahead and 3.4 to the side) fall in one column in a fifth to a
    third of all positions. Such an agent moves almost exactly one cell per step, so this lasts for hundreds of steps.
    It then compares only across the filament and keeps going out: in 92 % of its steps, against 78 % with the front
    sensor one column farther out. K decides it, because it shrinks the trail difference between the front and the best
    side sensor from 200 to 1,500 (K 0) to 0.25 to 1.4 (K 30, medians). Exact ties of sensors are not the cause: a
    float32 replay of 7,059,361 decisions near dabs matched the GPU in all but 0.0001 % and found no step that kept its
    heading on a tie of three sensors, and a shader that turns at random on a tie kept the spokes. Reason to keep: the
    cell rule is Jones' rule, and the passes are right. A random offset of the sensors in each step would remove the
    preference (axis rank 0.39 to 0.57); that would be a new extended rule, not measured for food reach (open below).
18. **Covered food is a Jones rule, available in both models, off in every scene** (owner, 2026-11-11). Reason: Jones
    published it (Context). In the Jones model it always runs with the rule of one agent per cell, as in both papers.
    In the extended model without the rule, agents stack on a food and hold each other there by their own trail, so
    covered food gathers more agents there (Consequences), and its help says so and what it costs.
19. **Covered food: Jones' form with a fixed window, and a factor per scene, 0.001 by default** (this branch,
    2026-11-11). A food cell releases `coveredFoodFactor` of its scent while the 3 × 3 window around it holds at least
    one alive agent. The switch is "Covered food releases less", and the slider "Covered food factor" (0.0001 to 1)
    shows while it is on. Reasons: both papers use the 3 × 3 window, so it is fixed. Their factors differ (0.001 in
    2010, 0.01 in 2014), and ADR 0024 (decision 1) lets each scene set the values of its own paper, so the factor is a
    setting that links carry. The default is 0.001 of Adamatzky and Jones 2010, because that paper checks each pixel of
    a food area as this code checks each painted food cell; the 2014 paper projects from points. For a food of strength
    0.05 the covered source is then 0.013 per step (0.13 with 0.01), against 12.75 uncovered. Light has no such rule.
20. **Covered food counts the agents after the step's moves** (this branch, 2026-11-11). Reason: Jones checks the window
    in every step of his scheduler; on the GPU the positions after the moves are the ones the diffusion pass of the same
    step can read. Collision mode keeps these counts anyway (ADR 0008). Without it, WebGPU runs the pass `occupy` into
    the same buffers, and WebGL2 draws one point per agent into the collision target, or without float blending into an
    8-bit target `presence`.
21. **The memory fit counts `presence` only while covered food is on** (this branch, 2026-11-11):
    `COVERED_BYTES_PER_CELL_HALF_FLOAT` (1 B) on top of `BYTES_PER_CELL_HALF_FLOAT` (110 B, as on `main`), via
    `Backend.coveredBytesPerCell`; `GlSim.update()` frees the target when covered food goes off. Reason: the first
    version counted 111 B always, so on WebGL2 without float blending 413 combinations of scene, device memory and aspect
    got a smaller grid than on `main` (review), also with covered food off. Covered food switched on can lower the grid,
    which rebuilds the simulation as every other lowered grid does (`Engine.apply()`).
22. **The new code is built only where it runs** (this branch, 2026-11-11). The saturation and covered food are
    override constants in WGSL (`SATURATE`, `COVERED`) and `#define`s in GLSL. The passes with them are built at their
    first use (`Kernels.saturated`, `Kernels.covered`, `Programs.saturated`, `Programs.covered`; `agentsProgram()` and
    `diffuseProgram()` in `gl/programs.ts` add the defines, the agent tools of ADR 0023 included) and run only while
    K ≥ 1 in the extended model or covered food is on. Reason: a check built into a pass but never run changed the float
    rounding on an M3 Pro (ADR 0020), and the passes without the new code must keep the bytes of the code before.
23. **For tests only**, `Sim.readScent()` reads the scent, and `Simulation.create` takes a diffusion source as it takes
    an agent source (this branch, 2026-11-11). Reason: the tests compare the scent with a CPU reference, and the shipped
    passes with the sources without the new code.

### Review of the settings and the panel of the strict model (2026-11-11)

The settings and panel logic of decisions 2 to 8 had e2e tests only. A review against the owner rule of 2026-11-11 (a
run labelled Jones is always Jones; a switch to Jones drops the extended values and says what went; a switch to
Extended keeps Jones' values; an old link opens as Jones only if it fits, else Extended) found the defects below. Each
decision has unit tests in `state.test.ts`, `params.test.ts` and `url.test.ts`, and each test failed under a temporary
mutation of its code (the pull request lists them).

24. **A link from before the model switch opens as Jones only if the Jones model runs it as it was made** (this branch,
    2026-11-11, from the owner rule). `sanitize(raw, drawn)` reads a link without a valid `model` as Extended, and as
    Jones only if `runsAsJones()` holds: the link fits (decision 4), holds no K, and has no walls, no light with an
    effect, and no food with a source unless the strain weighs it as its own trail and the scent decay is the strain's
    decay. `drawn` is what the link's drawing holds (`kindsOf()` in `src/model/link.ts`), so `decodeLink()` reads the
    drawing before the settings. Reason: the code before the switch ran every link with this app's additions, as the
    extended model does at Scent decay 0.1. Decision 5 read such a link as Jones whenever decision 4 held and bound the
    rest. So an old link of the Maze opened as Jones, whose sensors do not check walls on their way (decision 9). An old
    link of Fleeing light opened as Jones with Light strength 0.05 instead of 0.2, so its light had no effect. The scene
    card said "changed" for both, and an old link of a scene of Jones with food and a scent decay of its own lost that
    decay. Now the old link of every scene opens with the scene's model, and the card shows no change (test). What a
    value without effect changes is nothing: without food and light the scent is 0, so an old link of Turing spots
    (food weight +1 before the switch, trail weight −1) opens as Jones. Links with a model do not change: a link that
    claims Jones holds Jones' values (decisions 3 and 4), its walls are Jones' obstacles, and its light has no effect.
25. **The selected tool is one that the model offers** (this branch, 2026-11-11). `fitTool()` in
    `src/ui/state.svelte.ts` selects Move when the model has no such tool. `setScene()` (a preset and Reload scene),
    `openLink()`, `setModel()`, `adopt()` and `ruleUnavailable()` call it. Reason: the first version reset the Light
    tool only in the switch and in `adopt()`, which App.svelte calls only when `constrain()` changes the settings. A
    scene of Jones chosen with the Light tool kept that tool: the toolbar showed no tool selected, and a drag painted
    light into the Jones run.
26. **Scent decay has the range of the strain's Decay: 0.0001 to 0.9** (this branch, 2026-11-11). Reason: the Jones
    model sets the scent decay to the strain's decay (decision 3), whose range starts at 0.0001, and a switch to
    Extended keeps it (decision 7). With the old minimum of 0.001, a strain decay of 0.0005 in Jones ran in Extended with
    a scent decay of 0.0005, but the slider could not show it, and the link clamped it to 0.001: the receiver ran
    another scent.
27. **The Jones model sets the population share of its strain to 1** (this branch, 2026-11-11, `asJones()`). Reason:
    one population has no share (list above), and the panel shows none in the Jones model. After Extended, Add strain,
    a share of 0.5 for strain A and back to Jones, the card said "changed" for a run equal to the scene, and no control
    in the panel could undo it. One strain gets all agents at every share, so no scene changes.
28. **The notice of the switch to Jones names every value it changed** (this branch, 2026-11-11, `jonesChanges()`):
    the strains and the agents that share a cell that it removed, and every number that differs before and after
    `toJones()`, with its old and new value: Agents per cell, Diffusion passes, Scent decay (with the reason: the Decay
    of strain A), Trail saturation, Light strength, the weight of strain A on its own trail, Food attraction and Light
    avoidance. With walls on the canvas it also says that they stop agents but do not block sensors (decision 9). It
    shows for at least 10 s, 0.3 s per word. Reason: the owner rule "says what went". The first list missed Light
    strength, the weights of strain A and the cap of Agents per cell, and for 0 diffusion passes it said "more than one
    diffusion pass".
29. **The panel says that drawn light has no effect in the Jones model** (this branch, 2026-11-11). Below the model
    choice, while the food, light and walls hold light (`lightDrawn()`): "The light on the canvas has no effect in the
    Jones model. To remove it, use the Erase tool. To use it, select Extended." Reason: the review asked whether light
    that stays drawn without effect is clear. It was not: the notice of the switch goes after 10 s, and a link of the
    Jones model with light opens without a notice.
30. **The help says that Extended also differs from Jones at a cut** (this branch, 2026-11-11). The help of Model and
    Learn → The model now say "until you paint a wall or use the Cut tool", and the help lists all of Extended's
    rules: also agents that share a cell, no diffusion, and a Cut that also removes the trail. Reason: the extended
    model's cut clears the trail and the scent (decision 3), and Wound healing asks the user to cut.
31. **A held agent tool acts only while it is selected** (this branch, 2026-11-11; the agent tools of ADR 0023). In
    App.svelte the hold applies Inoculate or Cut only while one of the two is selected, and it follows the pointer also
    while another tool is selected. Reason: the review asked what a switch during a hold does. A switch of the model
    changes no held tool, because both models have Inoculate and Cut: it selects strain A for Inoculate, and the cut
    then keeps or clears the chemicals as the new model does. But a key can select another tool during the hold, and
    since the first agent tools (before this branch) the hold then went on inoculating under that tool, for example
    under Move or Food.
32. **Two models, no third model "Fogleman"** (owner, 2026-11-12, "Ja, zwei Modelle", on the coordinator's
    recommendation). The owner asked whether the selector could offer three models, Jones, Fogleman and Extended, so that
    every scene can be tried with another model. Reason: Fogleman's program has no food, light or walls. What it adds to
    Jones' rules is in the extended model already: several strains with the table of how each weighs the trails of the
    others, agents that share a cell, and two 3 × 3 means per step. The scenes of Fogleman run on the extended model with
    his values (`fogleman()` in `src/model/presets.ts`: no food or light, trail saturation 0) and sense first, as his code
    does (ADR 0027). A model "Fogleman" would therefore copy the extended model, or it would have to switch food off,
    and a scene of Jones on it would only show agents that ignore the food. Trying a scene with other rules works in
    every scene already: Model (Jones or Extended) and Step order (move first, Jones 2010; sense first, Jones 2011 and
    Fogleman) are both in the panel. Not checked: the app's rules against Fogleman's Go code line by line; checked are
    his values, which the presets copy exactly (ADR 0006), and the scenes' bytes against `main` in either step order.

## Open for the owner

See `TODO.md` (M2):

- Whether the default settings or the start scene should use K or a lower scent decay. This branch sets neither; the
  default settings now run on Extended at the values they had. The measurements are below.
- Whether the extended model should normalise to the plateau of a large food (decision 13), which makes a small food
  weaker at a low decay (below).
- Whether covered food stays exact without the rule of one agent per cell, where its occupancy pass costs time (below),
  or counts only the agents that moved, which misses agents that a wall blocked.
- Whether K should get a random offset of the sensors in each step, so that its straight paths out of food lose their
  preference for the grid axes (decision 17).
- Old links that set a scent decay other than 0.1 open in Extended (decision 24), which scales their food and light by
  g(d): their scent is weaker than when they were made. No model keeps the old unscaled, decoupled scent.

## Consequences

- **The scenes keep their bytes.** Offline check (not a test in the repository): a scratch GPU test built the default
  settings and all 15 presets as the app does (`Engine.create` and `Engine.load` on a canvas of 1512 × 945, dpr 1), ran
  500 steps from seed 7 and wrote the SHA-256 of the agents (by id), the trail, the scent and `env`. The reference is
  #26 (`2805b71`, merged into `main` as `2c355b7` with the same source tree), whose wrap fixes changed some scenes
  against the `main` before it (ADR 0023). This code gave the reference's digests for all 16 on WebGPU, WebGL2 and WebGL2 without float
  blending (M3 Pro), with the Jones scenes on Jones and the rest on Extended. The scenes of Jones switched to Extended
  gave them too. The first version of this branch passed the same check on `main` (`d245ea3`) for 14 scenes and the
  default settings, and a temporary mutation that switched the saturating code on in every agent pass changed them.
- **Tests** (`sim.gpu.test.ts`, both backends): the shipped passes against the sources with the saturation and covered
  food cut out, in both models, with K 0, and with a K that reached a Jones model past `sanitize()`; trail + scent
  against a CPU reference of Jones' one map; the sensors check walls only in the extended model; the cut keeps the
  chemicals only in the Jones model; the scent of food and light against a CPU reference in both models at decays 0.1,
  0.01 and 0.001 (within 1e-4); food on every cell at those decays against
  s_n = source · (1 − d) · (1 − (1 − d)^n) / d (within 1e-4); covered food against a CPU reference of one step, with
  and without the rule, with food across both seams of the periodic grid, light on food and dead agents, and on WebGL2
  without float blending; and the turn of every agent of two strains on a random trail against a CPU reference of
  `sense()` and `steer()` with K, with and without a wall. Unit tests: `params.test.ts` (the Jones model's links,
  `jonesFits()` for each weight, rule and diffusion, `constrain()` on 2,000 random settings, `toJones()` on every scene,
  `runsAsJones()`, the share and the range of Scent decay, K's steps), `state.test.ts` (`setModel()` both ways and its
  notice, `toolsFor()`, the tool after a preset, Reload scene, a link and `adopt()`, the scene flag after a switch and
  back, `lightDrawn()`, the old link of every scene), `url.test.ts` (old links by what their drawing holds, links that
  claim Jones), `pack.test.ts`, `presets.test.ts`, `sizing.test.ts`. e2e: `ui.spec.ts` (the Jones panel, the Light tool
  after a preset and the switch, the line about drawn light, the held agent tool).
- **Plateau.** A disc of food of radius 300 on 1024 × 1024 cells, Food strength 0.05, after 20 / d steps, on both
  backends: the extended model gave 114.750, 114.748 and 114.736 at decays 0.1, 0.01 and 0.001 (theory 114.75, within
  1.3e-4); with a source that does not depend on the decay (the Jones model, where d is the strain's decay) 114.75,
  1,262.2 and 12,736.
- **A dab is not a large food.** Normalised to the plateau of a large food, a small food releases less at a low decay.
  The UI dab on the 1536 grid (steady state, both backends alike):

  | Model, decay     | On the dab | Edge  | +5 cells | +9 cells | +20 cells | 1/e length | 1/10 length |
  | ---------------- | ---------- | ----- | -------- | -------- | --------- | ---------- | ----------- |
  | Both, 0.1        | 115        | 62    | 3.7      | 0.36     | 0.001     | 2.0        | 4.2         |
  | Jones, 0.01 (*)  | 1,129      | 557   | 212      | 98       | 12        | 5.2        | 11.9        |
  | Jones, 0.001 (*) | 5,056      | 3,101 | 2,126    | 1,594    | 743       | 13.7       | 33.4        |
  | Extended, 0.01   | 103        | 51    | 19       | 9.0      | 1.1       | 5.2        | 11.9        |
  | Extended, 0.003  | 75         | 40    | 23       | 14       | 4.3       | 8.7        | 20.6        |
  | Extended, 0.001  | 46         | 28    | 19       | 14       | 6.7       | 13.7       | 33.4        |

  (*) Measured as an unscaled source with that scent decay. In the Jones model of decision 2 the scent decays with the
  strain's decay, so these rows are the Jones model at a strain decay of 0.01 or 0.001, which also changes the trail.
  The lengths count from the edge of the dab to where the scent falls to 1/e or 1/10 of its value at the edge. They do
  not depend on the model. The 1/e length is one sensor distance (9 cells) at decay 0.003 (8.7 cells; 8.2 on the 1024
  grid), the 1/10 length at about 0.02.

- **Food in a running network** (the A2 experiment of the measurement, 10 seeds, WebGPU, M3 Pro). Per seed, the network
  runs 2,000 steps; then up to 4 UI dabs go where the nearest dense trail (a quarter of the median trail at the agents)
  lies 20 ± 1 cells from the dab's edge, and it runs 2,000 steps more. The ring is the disc of radius r + 10 around a
  dab; its agents over steps 1,000 to 2,000 count against the same network without food (same seed, same steps). A seed
  passes when its rings hold at least 3 times the agents of the control; a dab counts as reached when its own ring
  does, with 1 added to both counts.

  | Scene             | Model, K, decay        | Seeds with ratio ≥ 3 | Dabs reached | Agents in a ring (share of all) |
  | ----------------- | ---------------------- | -------------------- | ------------ | ------------------------------- |
  | Transport network | Jones (decay 0.1)      | 10 of 10             | 25 of 40     | 0.25 %                          |
  | Transport network | Extended, 0.01         | 10 of 10             | 40 of 40     | 1.5 %                           |
  | Transport network | Extended, 0.003        | 10 of 10             | 40 of 40     | 1.6 %                           |
  | Transport network | Extended, 0.001        | 10 of 10             | 40 of 40     | 1.6 %                           |
  | Default settings  | K 0, decay 0.1 (main)  | 3 of 10              | 17 of 40     | 0.29 %                          |
  | Default settings  | Extended, K 0, 0.01    | 4 of 10              | 26 of 40     | 0.53 %                          |
  | Default settings  | Extended, K 0, 0.003   | 6 of 10              | 28 of 40     | 0.39 %                          |
  | Default settings  | Extended, K 30, 0.1    | 9 of 10              | 24 of 40     | 6.9 %                           |
  | Default settings  | Extended, K 30, 0.01   | 9 of 10              | 33 of 40     | 8.1 %                           |
  | Default settings  | Extended, K 30, 0.003  | 10 of 10             | 30 of 40     | 5.5 %                           |
  | Default settings  | Extended, K 100, 0.1   | 8 of 10              | 19 of 40     | 2.1 %                           |
  | Default settings  | Extended, K 100, 0.01  | 5 of 10              | 23 of 40     | 1.2 %                           |
  | Default settings  | Extended, K 100, 0.003 | 5 of 10              | 22 of 40     | 0.95 %                          |

  The default settings ran without the rule, so their rows "K 0, decay 0.1" are the extended model at its values of
  `main`, which give the bytes of `main`. In the Transport network the seed criterion holds already in the Jones model: without food almost no agent comes near
  the sites, so one reached dab is enough. Per dab, the Jones model at decay 0.1 reaches 25 of 40 and leaves the others
  untouched, and every lower decay of the extended model reaches all 40 and fills their rings, one agent per cell. In
  the default settings only K 30 meets the criterion, and there each dab holds 5 to 8 % of all agents, so four dabs take
  a fifth to a third of the network. K 100 holds 1 to 2 % per dab and meets it in 5 to 8 seeds of 10. With K 100 a
  lower decay helps less, because the normalised scent at the dab's edge is weaker (62 at 0.1, 40 at 0.003).

- **Covered food in the same experiment** (factor 0.001). In the Transport network it keeps the reach and lowers the
  pile-up: the extended model at 0.003 reached 40 of 40 dabs with 1.1 % of all agents per ring (1.6 % without), the
  Jones model 23 of 40 (25 without). In the default settings, without the rule, it does not stop food from taking the
  network: with K 30 at 0.003 each ring held 9.4 % of all agents (5.5 % without), with K 100 0.69 % (0.95 %), and at
  K 0, decay 0.1 2 seeds of 10 passed (3 without). The review found the same for seed 7 (WebGPU, 2,000 steps after the
  dabs): the four rings held 21.2 % of all agents without covered food and 36.0 % with it. Agents stacked on a dab hold
  each other there by their own trail, so a dab that releases almost nothing keeps them.
- **What K does without food.** With one strain t / (1 + t / K) grows with t, so the strongest sensor stays the
  strongest, and K changes no turn but by float rounding at ties. The default settings (seed 7, WebGPU) kept their
  pattern for K from 0 to 1,000: at step 2,000 57 to 67 agents per occupied cell, 97 to 98 % of the agents in cells of
  10 or more, a median trail at an agent of 3,280 to 3,710 and a correlation half-width of 6 cells; at step 10,000 69 to
  180 agents per occupied cell and 7 to 11 cells (K 0: 144 and 10), one run each, with no trend in K. The
  start scene (three strains that flee each other) kept its pattern too: at step 10,000 7.4 to 8.0 agents per occupied
  cell (K 0: 8.0), mean dark run 31.8 to 37.5 cells (37.4), half-width 5 to 6 (5). Its trail at an agent is low (median
  42 to 82), so K above 100 hardly acts there.
- **Cost**, paired in one page (WebGPU and WebGL2, M3 Pro): the same simulation with twelve UI dabs, switched block by
  block between the Jones model, K = 100 and covered food, 12 rounds of 200 steps each; median ms per step:

  | Backend | Scene (agents)                       | Jones | K 100 | Covered food |
  | ------- | ------------------------------------ | ----- | ----- | ------------ |
  | WebGPU  | Default settings (1,474,560)         | 2.60  | 2.71  | 3.22         |
  | WebGPU  | Three strains (4,423,680)            | 7.17  | 7.01  | 9.40         |
  | WebGPU  | Transport network (98,304, the rule) | 1.27  | 1.27  | 1.26         |
  | WebGL2  | Default settings (1,474,560)         | 8.87  | 8.45  | 14.24        |
  | WebGL2  | Three strains (4,194,304)            | 39.2  | 41.5  | 62.0         |
  | WebGL2  | Transport network (98,304, the rule) | 1.55  | 1.56  | 1.65         |

  K costs nothing that shows above the spread of the blocks (WebGPU ±0.15 ms, WebGL2 ±2.3 ms). Covered food costs
  without the rule of one agent per cell, where the occupancy needs a pass of its own: 0.6 and 2.2 ms per step on
  WebGPU, 5.4 and 23 ms on WebGL2, which draws a point per agent. At 120 steps per second the app runs 2 steps per
  frame. With the rule the occupancy is there already, and covered food costs nothing measurable. It is off in every
  scene.
