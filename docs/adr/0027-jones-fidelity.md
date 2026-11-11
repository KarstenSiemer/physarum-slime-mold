# 0027: The model as in Jones' papers: step order, dish, boundaries and the figures' foods

- Status: accepted (owner decisions of 2026-11-11: the scenes of Jones work exactly as in his papers, and the
  corrections apply to both models)
- Date: 2026-11-11

## Context

A fidelity check of 2026-11-11 compared the eight scenes of Jones 2010 (J. Jones, Characteristics of pattern
formation and evolution in approximations of Physarum transport networks, Artificial Life 16(2): 127–153) with the
images of their figures, each on the lattice of its figure (ADR 0026), and with a reference simulator written from the
paper's text. Page numbers are those of Jones 2010 unless a line names another paper. Three scenes matched: the
Transport network (Fig. 4: 8 lacunae at step 4,151, the app 6.4 ± 0.9), the Minimizing network (Fig. 5) and the Turing
stripes (wavelength 16.2 against 15.7 cells, one orientation over 85.5 against 84.6 % of the grid). The others
deviated, each for a cause in this app's model:

- **The order inside a step.** Jones: every agent moves and deposits (the motor stage), then every agent senses and
  turns (the sensory stage), then the trail map diffuses (p. 132–133). This app sensed first, then moved, then
  diffused (`src/engine/sim.ts` at `cf279c4`, lines 611, 631 and 653): its sensors read the map after the diffusion,
  Jones' read it after the moves and before the diffusion. With Jones' order the Turing spots of Fig. 16 form a regular
  array (spacing variation 5.6 % at step 10,000 and 4.4 % at 30,000, against 10.5 % with this app's order; 5.7 % in the
  figure).
- **The dish.** The images of Fig. 18 and 19 show a dish of 0.947 and 0.944 of the lattice's side. The app's dish was
  the side less 2 cells (0.993 on 300 × 300). Jones counts his population over the lattice (%p, p. 134; 45,000 agents
  for %p 50 on 300 × 300, p. 147), so 45,000 agents filled 64.5 % of the app's dish against about 71 % of Jones'. The
  thinner sheet of Shrinking plasmodium (Fig. 21) tore around its middle food in 18 of 31 runs; with Jones' dish in 0
  of 31.
- **Diffusion at the rim.** The app's mean was reflective: at walls and at the rim of a closed arena it averaged over
  the habitable cells only, so no trail left the arena (ADR 0007). Jones' later papers absorb the chemoattractant at the
  edges (Jones 2011, Influences on the formation and evolution of Physarum polycephalum inspired emergent transport
  networks, Natural Computing 10: 1345–1369, p. 1353) and run the mean filter at every lattice site (Jones and
  Adamatzky 2014, arXiv:1303.4969, p. 23; Jones 2015, arXiv:1503.03265, p. 14; Jones, Mayne and Adamatzky 2017,
  arXiv:1511.05862, p. 25). Fig. 18 fits an absorbing rim: the trail fades about 4.5 cells inside it, and no trail
  stays at the rim later. With the reflective rim, Shortest path kept a branch to the rim in 2 of 20 runs; absorbing,
  in 0 of 20. A growing colony coats the walls for the same cause (the growth analysis of 2026-11-11: within 4 cells of
  a wall, 7 % of the open cells, 71 % of the agents at step 15,000 on 16:9, 10.5 % when the walls absorb).
- **The foods.** Fig. 19 shows a square of 60 cells (0.317 of the dish) with foods of about 2.7 cells; the app had
  0.29 of the dish with foods of 4 cells, and a ring stayed in 10 of 20 runs. Fig. 21 shows 19 foods; the app had 8.
  Fig. 18 puts its foods 51 cells left and right of the middle; the app 57.6.

Jones' sequential order of the agents (p. 133) against this app's synchronous claims (ADR 0008) is a real difference,
but with the four corrections above no figure needs it (the fidelity check). It stays the documented difference of
ADR 0008.

The owner's rule of 2026-11-11: the scenes of Jones work exactly as in his papers ("Jones-Presets … genau so wie aus
seinen Papers"), and a deviation from Jones means there is an error somewhere. Asked whether the corrections also
apply to the extended model, the owner decided on 2026-11-11: "Ja, beide Modelle" (yes, both models). The reason
given: the extended model is Jones plus this app's additions; the step order and the reflective walls are not intended
additions, and the reflective walls make a growing colony coat the walls.

## Decisions

Each decision with its date, who made it, and why.

### Step order

1. **Jones' order of a step, in both models and on both backends** (owner, 2026-11-11). Every agent moves and
   deposits, then every agent senses and turns, then the map diffuses and decays (p. 132–133).
2. **The textures hold the map as the agents sense it** (this branch, 2026-11-11). A step of the GPU senses and turns
   for the moves of the step before, moves, then diffuses and decays the map, and its last diffusion pass adds the
   deposits and the food and light of this step's moves (`diffuse.wgsl`, `diffuse.frag`: the sources moved from the
   first pass, before the mean, to the last pass, after the decay). The sensors of the next step read exactly Jones'
   map after the motor stage: the last diffusion plus the new deposits. Options: (a) the fidelity check's patch for
   WebGPU: the claim pass reads the trail texture of before the last diffusion plus `counts` and `env` of the last
   step, and `counts` is cleared between `claim` and `settle`; (b) a third pass that senses after the moves; (c) this
   one. (a) works only with one diffusion pass (with two, the second pass overwrites the texture it needs) and with the
   rule of one agent per cell (without it, `advance` senses and deposits in one pass, so it would read the counts it
   writes), and it repeats covered food and the cut in every sensor. (b) costs a pass over all agents. (c) adds no
   pass, no texture and no read in a sensor, works for every number of diffusion passes, with and without the rule,
   and keeps covered food, the cut, light, trail saturation and the sensor walk of ADR 0020 where they were. Reason:
   the correct order at no cost.
3. **The first step after a reset moves without sensing** (this branch, 2026-11-11; `sensesFirst()` in
   `agents.wgsl` and `agents.frag`). Jones' first step moves with the start heading; a step here senses for the moves
   before it, and the first step has none. Without this an agent would sense the empty map once: a sensor in a wall or
   outside the arena would turn it, and the random turn pCD would draw. Reason: Jones' first step exactly. Tests that
   write a trail and agents to see one sensing step now run a first step before (`pastFirstStep()` in
   `sim.gpu.test.ts`).
4. **Food and light enter with the deposits, before the sensors** (this branch, 2026-11-11). Jones projects the stimuli
   into the trail map (p. 144) but does not say where in the step. They enter where the deposits enter, after the step's
   diffusion, so the sensors read them with the deposits. The fidelity check measured the scenes with this choice.
   Covered food counts the agents after the step's moves, as before (ADR 0022, decision 20).
5. **The normalised emission keeps the plateau of a large food at every decay** (this branch, 2026-11-11, from ADR 0022
   decision 13). With Jones' order the scent of a large food settles where s = (1 − d) · s + source, so s = source / d,
   not source · (1 − d) / d. `emissionScale()` (`src/model/params.ts`) is now d / 0.1, so the plateau is 255 · strength
   · 10 at every decay. It is exactly 1 at 0.1 as before, so no scene changes by it. Outside a static food the scent of
   Jones' order equals the scent of the old order: with Q = s − source the new step is Q′ = (1 − d) · M(Q + source),
   the old one. So the old factor would have kept the scent outside a food as it was and let the plateau vary by
   0.9 / (1 − d) (−10 % at decay 0.001); the new factor keeps the plateau and makes the scent outside a food
   (1 − d) / 0.9 of before (+11 % at decay 0.001). Decision 13 names the plateau, so the plateau it is. Owner question
   (below).

### Dish

6. **Every dish is 0.945 of the grid's short side, in both models** (owner, 2026-11-11, with the rule above; the fidelity
   check measured 0.947 in Fig. 18 and 0.944 in Fig. 19, so 0.945 lies between them). `DISH_FILL` in `common.wgsl`,
   `common.glsl`, `render.wgsl`, `view.glsl` and `src/engine/brush.ts` (`dishRadius()`), which the sweep, the brush,
   the CPU paint reference and the tests use; `render.frag` takes it from `view.glsl`. A unit test (`pack.test.ts`,
   "the dish") checks that every shader holds the same value and that no rim of the old formula is left. Before, the
   rim lay at half the short side less 1 cell (ADR 0019). Options the check listed: 0.945 for every dish; 0.92; 0.945
   only on Jones' lattices; the old dish with density 0.6 for Shrinking plasmodium. The owner's rule decides: a dish is
   Jones' dish, whatever grid it runs on.
7. **The agent count stays Jones' %p of the square around the dish** (this branch, 2026-11-11; `agentCount()`,
   unchanged). Jones counts his population over the lattice (p. 134), and 45,000 agents for %p 50 on 300 × 300 (p. 147)
   is the count of Fig. 21. In Jones' dish they fill 71 % of the cells (64.5 % of the old dish). The food positions
   keep their frame, the short side (ADR 0019), so no food moves with the rim, and a link keeps its strokes in that
   frame. A stroke of an old link that reached past 0.945 of the side now paints only its cells inside the new rim.
8. **64 claim rounds at the start** (this branch, 2026-11-11; `START_ROUNDS` in `src/engine/pack.ts`, before 32).
   Jones starts every agent on a free cell (p. 132). In a claim round a waiting agent finds a free cell with about the
   share of the free cells, so N · f^n of N agents still wait after n rounds at the filled share f. At 71 % and 32
   rounds, 0 to 2 of Shrinking plasmodium's 45,000 agents started dead in 15 of 61 seeds on WebGPU and 13 of 61 on
   WebGL2 (seeds 0 to 60); with 64 rounds none in 61 seeds on either backend. A round is one claim and one settle pass
   over the agents at a reset, only in an arena with the rule that is not a periodic or box grid with the mixed layout
   and no walls. A GPU test starts Shrinking plasmodium with seed 6, which left 2 agents dead with 32 rounds.
