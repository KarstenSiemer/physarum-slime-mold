# 0022: Jones and extended model

- Status: accepted (owner decision, 2026-11-11: a model switch "Jones" and "Erweitert"; the default changes are open)
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

## Options

1. **One switch per paper or rule.** Many switches, and every scene of Jones would need the right set of them.
2. **Change the scent for everyone.** Jones' scenes would no longer run as in his papers.
3. **A model switch** with two values. Jones' published rules belong to "Jones", this app's additions to "Extended". A
   rule of Jones that a scene does not use is an option with Jones' values, off by default.

## Decisions

Each decision with its date, who made it, and why.

1. **A model switch "Jones" and "Extended"** (owner, 2026-11-11; the owner calls the second "Erweitert", the app is in
   English). `Settings.model` is `'jones'` or `'extended'` (`MODELS` in `src/model/params.ts`). Reason: the scenes of
   Jones must behave exactly as in his papers. Jones' published rules (the 2010 model, and later rules such as growth
   and shrinkage of 2011 and covered food) go together into one model rather than one switch per paper, and what is not
   Jones' goes into a model of its own. Growth and shrinkage belong to "Jones" when they come, flow reinforcement to
   "Extended".
2. **Every scene, the default settings and every old link run on "Jones"** (owner, 2026-11-11). `sanitize()` loads a
   link without `model` as `'jones'`. Reason: they must keep their bytes, and a link must open as it was made.
3. **Normalised emission is extended only** (owner, 2026-11-11). In the extended model food and light release
   255 · strength · g(d) per cell and step, with g(d) = (d / (1 − d)) / (0.1 / 0.9) (`emissionScale()`), d the scent
   decay. Reason: Jones projects food at a fixed strength into a map with the trail's decay; a source that depends on
   the decay is not his rule. In the Jones model the scent stays as it was at every decay.
4. **g normalises the plateau of a large food, at decay 0.1** (owner brief, 2026-11-11). With g the plateau
   255 · strength · g(d) · (1 − d) / d is 255 · strength · 9 at every decay. Reason: a lower decay should spread the
   scent, not make it stronger, and every scene and the default settings use 0.1, so at 0.1 the extended model gives the
   bytes of the Jones model. g(0.1) is exactly 1: the same float divided by itself.
5. **Light gets the same g** (owner brief, 2026-11-11). Reason: the light repellent lives in the same scent field with
   the same decay (ADR 0007); without g, a lower decay would make light 111 times as strong.
6. **Trail saturation is extended only** (owner, 2026-11-11). Each sensor reads the trail t of each strain as
   t / (1 + t / K) before it weighs the trails (`sense()` in `agents.wgsl`, `agents.frag`). Reason: no paper of Jones
   saturates the trail.
7. **K is one value for all strains, 0 to 1,000 in steps of 1, 0 off** (this branch, 2026-11-11). Reason: one number is
   enough to measure what it does, and the owner decides whether it stays. The range reaches from below the trail of the
   start scene (median 42 to 82 at an agent) to a tenth of the trail of the default settings (median 3,700 at step
   2,000 and 10,700 at step 10,000, K 0). The slider is linear, because a log slider cannot reach 0. The panel shows it
   only in the extended model.
8. **Covered food is a Jones rule, available in both models, off in every scene** (owner, 2026-11-11). Reason: Jones
   published it (Context). Off keeps the scenes' bytes.
9. **Covered food: Jones' form with a fixed window, and a factor per scene, 0.001 by default** (this branch,
   2026-11-11). A food cell releases `coveredFoodFactor` of its scent while the 3 × 3 window around it holds at least
   one alive agent. The switch is "Covered food releases less", and the slider "Covered food factor" (0.0001 to 1) shows
   while it is on. Reasons: both papers use the 3 × 3 window, so it is fixed. Their factors differ (0.001 in 2010, 0.01
   in 2014), and ADR 0024 (decision 1) lets each scene set the values of its own paper, so the factor is a setting that
   links carry. The default is 0.001 of Adamatzky and Jones 2010, because that paper checks each pixel of a food area as
   this code checks each painted food cell; the 2014 paper projects from points. For a food of strength 0.05 the
   covered source is then 0.013 per step (0.13 with 0.01), against 12.75 uncovered. Light has no such rule.
10. **Covered food counts the agents after the step's moves** (this branch, 2026-11-11). Reason: Jones checks the
    window in every step of his scheduler; on the GPU the positions after the moves are the ones the diffusion pass of
    the same step can read. Collision mode keeps these counts anyway (ADR 0008). Without it, WebGPU runs the pass
    `occupy` into the same buffers, and WebGL2 draws one point per agent into the collision target, or without float
    blending into an 8-bit target `presence`. That target is 1 byte per cell more in `BYTES_PER_CELL_HALF_FLOAT`
    (110 → 111), so the memory fit counts it.
11. **The new code is built only where it runs** (this branch, 2026-11-11). The saturation and covered food are override
    constants in WGSL (`SATURATE`, `COVERED`) and `#define`s in GLSL. The passes with them are built at their first use
    (`Kernels.saturated`, `Kernels.covered`, `Programs.saturated`, `Programs.covered`) and run only while K > 0 in the
    extended model or covered food is on. Reason: a check built into a pass but never run changed the float rounding on
    an M3 Pro (ADR 0020), and the passes without the new code must keep the bytes of the code before.
12. **What stays in both models** (this branch, 2026-11-11): several strains with the attraction table, light, walls
    that block sensors (ADR 0020), the separate scent fields (ADR 0007) and the rule of one agent per cell. Reason: the
    scenes that use them run on "Jones" and must keep their bytes (decision 2).
13. **Where the switch sits in the panel** (this branch, 2026-11-11): "Model" in the Scene section, beside the rule of
    one agent per cell; "Covered food releases less" with "Covered food factor", and "Trail saturation", in the
    Environment section. Reason: the model is a choice of rules like the rule of one agent per cell, and the options
    act on food and sensing.
14. **For tests only**, `Sim.readScent()` reads the scent, and `Simulation.create` takes a diffusion source as it takes
    an agent source (this branch, 2026-11-11). Reason: the tests compare the scent with a CPU reference, and the shipped
    passes with the sources without the new code.

## Open for the owner

See `TODO.md` (M2):

- Whether the default settings or the start scene should use the extended model, K or a lower scent decay. This branch
  changes no default and no scene. The measurements are below.
- Whether the extended model should normalise to the plateau of a large food (decision 4), which makes a small food
  weaker at a low decay (below).
- Whether covered food stays exact without the rule of one agent per cell, where its occupancy pass costs time (below),
  or counts only the agents that moved, which misses agents that a wall blocked.
- Whether "Jones" should also hide what Jones never had (light, several strains). That would change the scenes that
  use them, against decision 2.

## Consequences

- **The scenes keep their bytes.** Offline check (not a test in the repository): a scratch GPU test built every scene
  and the default settings as the app does (canvas 1512 × 945, dpr 1), ran 500 steps from seed 7 and wrote the SHA-256
  of the agents, the trail, the scent and `env`. `main` (`d245ea3`) gave the same digests twice, and this code gave
  them on WebGPU and WebGL2 (M3 Pro), for all 14 scenes and the default settings. The same scenes switched to the
  extended model (K = 0, decay 0.1) gave the same digests too. A temporary mutation that switched the saturating code
  on in every agent pass changed them, so the check sees a change.
- **Tests** (`sim.gpu.test.ts`, both backends): the shipped passes against the sources with the saturation and covered
  food cut out (the bytes of agents, trail and scent are the same in the Jones model and in the extended model with
  K = 0 at decay 0.1, and differ with K or covered food); the scent of food and light against a CPU reference in both
  models at decays 0.1, 0.01 and 0.001 (within 1e-4); food on every cell at those decays against
  s_n = source · (1 − d) · (1 − (1 − d)^n) / d (within 1e-4); covered food against a CPU reference of one step, with and
  without the rule of one agent per cell, and on WebGL2 without float blending; and the turn of every agent of two
  strains on a random trail against a CPU reference of `sense()` and `steer()` with K. Each test failed under a
  temporary mutation of the code it checks.
- **Plateau.** A disc of food of radius 300 on 1024 × 1024 cells, Food strength 0.05, after 20 / d steps, on both
  backends: the extended model gave 114.750, 114.748 and 114.736 at decays 0.1, 0.01 and 0.001 (theory 114.75, within
  1.3e-4); the Jones model 114.75, 1,262.2 and 12,736.
- **A dab is not a large food.** Normalised to the plateau of a large food, a small food releases less at a low decay.
  The UI dab on the 1536 grid (steady state, both backends alike):

  | Model, decay    | On the dab | Edge  | +5 cells | +9 cells | +20 cells | 1/e length | 1/10 length |
  | --------------- | ---------- | ----- | -------- | -------- | --------- | ---------- | ----------- |
  | Both, 0.1       | 115        | 62    | 3.7      | 0.36     | 0.001     | 2.0        | 4.2         |
  | Jones, 0.01     | 1,129      | 557   | 212      | 98       | 12        | 5.2        | 11.9        |
  | Jones, 0.001    | 5,056      | 3,101 | 2,126    | 1,594    | 743       | 13.7       | 33.4        |
  | Extended, 0.01  | 103        | 51    | 19       | 9.0      | 1.1       | 5.2        | 11.9        |
  | Extended, 0.003 | 75         | 40    | 23       | 14       | 4.3       | 8.7        | 20.6        |
  | Extended, 0.001 | 46         | 28    | 19       | 14       | 6.7       | 13.7       | 33.4        |

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
  | Transport network | Jones, decay 0.1       | 10 of 10             | 25 of 40     | 0.25 %                          |
  | Transport network | Extended, 0.01         | 10 of 10             | 40 of 40     | 1.5 %                           |
  | Transport network | Extended, 0.003        | 10 of 10             | 40 of 40     | 1.6 %                           |
  | Transport network | Extended, 0.001        | 10 of 10             | 40 of 40     | 1.6 %                           |
  | Default settings  | Jones, decay 0.1       | 3 of 10              | 17 of 40     | 0.29 %                          |
  | Default settings  | Extended, K 0, 0.01    | 4 of 10              | 26 of 40     | 0.53 %                          |
  | Default settings  | Extended, K 0, 0.003   | 6 of 10              | 28 of 40     | 0.39 %                          |
  | Default settings  | Extended, K 30, 0.1    | 9 of 10              | 24 of 40     | 6.9 %                           |
  | Default settings  | Extended, K 30, 0.01   | 9 of 10              | 33 of 40     | 8.1 %                           |
  | Default settings  | Extended, K 30, 0.003  | 10 of 10             | 30 of 40     | 5.5 %                           |
  | Default settings  | Extended, K 100, 0.1   | 8 of 10              | 19 of 40     | 2.1 %                           |
  | Default settings  | Extended, K 100, 0.01  | 5 of 10              | 23 of 40     | 1.2 %                           |
  | Default settings  | Extended, K 100, 0.003 | 5 of 10              | 22 of 40     | 0.95 %                          |

  In the Transport network the seed criterion holds already in the Jones model: without food almost no agent comes near
  the sites, so one reached dab is enough. Per dab, the Jones model at decay 0.1 reaches 25 of 40 and leaves the others
  untouched, and every lower decay of the extended model reaches all 40 and fills their rings, one agent per cell. In
  the default settings only K 30 meets the criterion, and there each dab holds 5 to 8 % of all agents, so four dabs take
  a fifth to a third of the network. K 100 holds 1 to 2 % per dab and meets it in 5 to 8 seeds of 10. With K 100 a
  lower decay helps less, because the normalised scent at the dab's edge is weaker (62 at 0.1, 40 at 0.003).

- **Covered food in the same experiment** (factor 0.001). In the Transport network it keeps the reach and lowers the
  pile-up: the extended model at 0.003 reached 40 of 40 dabs with 1.1 % of all agents per ring (1.6 % without), the
  Jones model 23 of 40 (25 without). In the default settings it does not stop food from taking the network: with K 30 at 0.003 each ring
  held 9.4 % of all agents (5.5 % without), with K 100 0.69 % (0.95 %), and the Jones model passed 2 seeds of 10 (3
  without). Agents stacked on a dab hold each other there by their own trail, so a dab that releases almost nothing
  keeps them.
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
